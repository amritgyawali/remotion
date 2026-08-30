'use client'

/**
 * A very small WebGL2 layer, shared by the two tools that cannot afford to
 * touch pixels one at a time.
 *
 * Everything else in `frame-ops.ts` is drawn with the 2D canvas API, which the
 * browser already accelerates, and the one CPU pixel loop that survives there
 * (`applySharpen`) is opt-in precisely because it is the slow one. A film-look
 * lookup table and an alpha composite are both per-pixel and unavoidable, so
 * they run as fragment shaders instead: a 33-cube lookup costs one hardware
 * trilinear fetch rather than eight array reads and twelve multiplies, and a
 * 1080p frame stays inside a millisecond or two instead of a hundred.
 *
 * One canvas and one context are shared by every caller and resized to
 * whatever the current frame needs. Contexts are a scarce resource - a browser
 * will start dropping the oldest one after a handful - and a render loop that
 * created one per frame would lose its own context halfway through the clip.
 *
 * Every entry point returns `null` rather than throwing when WebGL2 is
 * missing or the context has been lost. Both callers have a working CPU path;
 * a machine without a GPU should render slowly, not fail.
 */

export type GlSurface = {
	canvas: OffscreenCanvas
	gl: WebGL2RenderingContext
	/** Sizes the drawing buffer and the viewport to match the frame. */
	resize(width: number, height: number): void
	/** Compiles once per `key`; later calls hand back the cached program. */
	program(key: string, fragmentSource: string): GlProgram | null
	/** Draws the full-screen triangle pair the vertex shader expects. */
	drawQuad(program: GlProgram): void
}

export type GlProgram = {
	handle: WebGLProgram
	uniform(name: string): WebGLUniformLocation | null
}

const VERTEX_SOURCE = `#version 300 es
in vec2 aPosition;
out vec2 vUv;
void main() {
	// The result is read back with drawImage onto a 2D canvas, whose origin is
	// the top-left, while clip space counts upward. Flipping v here keeps the
	// picture the right way up without an extra copy or UNPACK_FLIP_Y.
	vUv = vec2(aPosition.x * 0.5 + 0.5, 0.5 - aPosition.y * 0.5);
	gl_Position = vec4(aPosition, 0.0, 1.0);
}
`

type SurfaceState = {
	surface: GlSurface
	programs: Map<string, GlProgram>
	quad: WebGLBuffer
	vao: WebGLVertexArrayObject
}

let state: SurfaceState | null = null
/** Set when a context is lost, so we stop handing out a dead surface. */
let unavailable = false

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
	const shader = gl.createShader(type)
	if (!shader) return null
	gl.shaderSource(shader, source)
	gl.compileShader(shader)
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		// A shader that will not compile is a bug in this repository, not a
		// user's problem - log it and let the caller fall back to the CPU.
		console.error('[webgl] shader failed to compile:', gl.getShaderInfoLog(shader))
		gl.deleteShader(shader)
		return null
	}
	return shader
}

function buildSurface(): SurfaceState | null {
	if (typeof OffscreenCanvas === 'undefined') return null
	let canvas: OffscreenCanvas
	try {
		canvas = new OffscreenCanvas(2, 2)
	} catch {
		return null
	}
	const gl = canvas.getContext('webgl2', {
		alpha: true,
		antialias: false,
		depth: false,
		stencil: false,
		premultipliedAlpha: false,
		preserveDrawingBuffer: false,
		powerPreference: 'high-performance',
	}) as WebGL2RenderingContext | null
	if (!gl) return null

	canvas.addEventListener('webglcontextlost', (event) => {
		event.preventDefault()
		unavailable = true
		state = null
	})

	const quad = gl.createBuffer()
	const vao = gl.createVertexArray()
	if (!quad || !vao) return null
	gl.bindVertexArray(vao)
	gl.bindBuffer(gl.ARRAY_BUFFER, quad)
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
	gl.enableVertexAttribArray(0)
	gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
	gl.bindVertexArray(null)

	// LUT rows are 33 texels of RGB8 - 99 bytes - so the default 4-byte row
	// alignment would read three bytes of the next row into every row.
	gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
	gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
	gl.disable(gl.DEPTH_TEST)
	gl.disable(gl.BLEND)

	const programs = new Map<string, GlProgram>()

	const surface: GlSurface = {
		canvas,
		gl,
		resize(width, height) {
			const w = Math.max(1, Math.round(width))
			const h = Math.max(1, Math.round(height))
			if (canvas.width !== w || canvas.height !== h) {
				canvas.width = w
				canvas.height = h
			}
			gl.viewport(0, 0, w, h)
		},
		program(key, fragmentSource) {
			const cached = programs.get(key)
			if (cached) return cached

			const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SOURCE)
			const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource)
			if (!vertex || !fragment) return null

			const handle = gl.createProgram()
			if (!handle) return null
			gl.attachShader(handle, vertex)
			gl.attachShader(handle, fragment)
			gl.bindAttribLocation(handle, 0, 'aPosition')
			gl.linkProgram(handle)
			gl.deleteShader(vertex)
			gl.deleteShader(fragment)
			if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) {
				console.error('[webgl] program failed to link:', gl.getProgramInfoLog(handle))
				gl.deleteProgram(handle)
				return null
			}

			const locations = new Map<string, WebGLUniformLocation | null>()
			const compiled: GlProgram = {
				handle,
				uniform(name) {
					if (!locations.has(name)) locations.set(name, gl.getUniformLocation(handle, name))
					return locations.get(name) ?? null
				},
			}
			programs.set(key, compiled)
			return compiled
		},
		drawQuad(program) {
			gl.useProgram(program.handle)
			gl.bindVertexArray(vao)
			gl.drawArrays(gl.TRIANGLES, 0, 3)
			gl.bindVertexArray(null)
		},
	}

	return { surface, programs, quad, vao }
}

/** The shared context, or `null` on a machine that cannot give us one. */
export function acquireGlSurface(): GlSurface | null {
	if (unavailable) return null
	if (state && state.surface.gl.isContextLost()) {
		unavailable = true
		state = null
		return null
	}
	state ??= buildSurface()
	if (!state) {
		unavailable = true
		return null
	}
	return state.surface
}

export type TextureOptions = {
	/** `false` for masks and lookup data that must not be smoothed */
	linear?: boolean
}

/** Creates a 2D texture set up for full-frame sampling. */
export function createTexture2D(gl: WebGL2RenderingContext, options: TextureOptions = {}): WebGLTexture | null {
	const texture = gl.createTexture()
	if (!texture) return null
	const filter = options.linear === false ? gl.NEAREST : gl.LINEAR
	gl.bindTexture(gl.TEXTURE_2D, texture)
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter)
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter)
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
	return texture
}

/** Uploads a canvas, bitmap or video frame into `texture` on `unit`. */
export function uploadTexture2D(
	gl: WebGL2RenderingContext,
	unit: number,
	texture: WebGLTexture,
	source: TexImageSource,
): void {
	gl.activeTexture(gl.TEXTURE0 + unit)
	gl.bindTexture(gl.TEXTURE_2D, texture)
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
}

/** Uploads a flat RGBA byte buffer, for the 1x1 stand-ins unused samplers need. */
export function uploadPixels2D(
	gl: WebGL2RenderingContext,
	unit: number,
	texture: WebGLTexture,
	width: number,
	height: number,
	pixels: Uint8Array,
): void {
	gl.activeTexture(gl.TEXTURE0 + unit)
	gl.bindTexture(gl.TEXTURE_2D, texture)
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
}

/** Creates the 3D texture a baked colour cube lives in. */
export function createTexture3D(gl: WebGL2RenderingContext): WebGLTexture | null {
	const texture = gl.createTexture()
	if (!texture) return null
	gl.bindTexture(gl.TEXTURE_3D, texture)
	gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
	gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
	gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
	gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
	gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
	return texture
}

/** Uploads an RGB8 cube of `size` cells per axis. */
export function uploadLut3D(
	gl: WebGL2RenderingContext,
	unit: number,
	texture: WebGLTexture,
	size: number,
	data: Uint8Array,
): void {
	gl.activeTexture(gl.TEXTURE0 + unit)
	gl.bindTexture(gl.TEXTURE_3D, texture)
	gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB8, size, size, size, 0, gl.RGB, gl.UNSIGNED_BYTE, data)
}
