/**
 * Static analysis of an uploaded project, with nothing loaded to do it.
 *
 * This is deliberately separate from the compiler: the compiler pulls in every
 * package an uploaded file may import - Remotion, three.js, the media
 * components - and none of that is needed to read source text. Keeping the
 * audit importable on its own is what lets the check scripts assert these
 * warnings in plain Node, and the warnings are the studio's main line of
 * defence against a composition that previews correctly and then exports wrong.
 */

import { extname } from './path-utils'
import type { SourceFile } from './types'

/** Every pack the deployed app serves from public/assets. */
const STUDIO_KIT_PATH = /^[`'"]assets\/(?:3d|audio|visual|texture|fonts)\/v1\//

/** The same packs, matched against a bare path rather than a quoted literal. */
const STUDIO_KIT_BARE = /^assets\/(?:3d|audio|visual|texture|fonts)\/v1\//

/** Any `assets/...` string in the file, whether or not staticFile() wraps it. */
const ASSET_LITERAL = /[`'"](assets\/[^`'"\n]+)[`'"]/g

function staticFileCallsOutsideStudioKit(code: string): boolean {
	const calls = [...code.matchAll(/staticFile\s*\(\s*([^\r\n)]*)\)/g)]
	if (calls.length === 0) return true

	return calls.some((match) => {
		const argument = match[1].trim()
		if (STUDIO_KIT_PATH.test(argument)) return false
		// A quoted path that is not one of the packs is exactly what this warning
		// is for.
		if (/^[`'"]/.test(argument)) return true

		/**
		 * A computed path - `staticFile(event.src)`, which is how the subtitle
		 * tool schedules its sound effects. The call itself cannot be judged, so
		 * the asset strings the file carries are: a file whose every asset path
		 * belongs to the kit is not reaching outside it, and warning about it
		 * would put a permanent, wrong notice on every captioned video.
		 */
		const literals = [...code.matchAll(ASSET_LITERAL)].map((asset) => asset[1])
		return literals.length === 0 || !literals.every((path) => STUDIO_KIT_BARE.test(path))
	})
}

/**
 * Comments in these files are documentation for the next AI edit and routinely
 * quote the very patterns the checks below look for ("never use useFrame()").
 * Analysing the stripped source keeps every warning about real code.
 */
function stripComments(code: string): string {
	return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
}

/** Static source analysis - surfaces things the browser engine cannot do. */
export function analyzeSources(files: SourceFile[]): string[] {
	const warnings = new Set<string>()
	const code = stripComments(
		files
			.filter((f) => ['.ts', '.tsx', '.js', '.jsx'].includes(extname(f.path)))
			.map((f) => f.contents)
			.join('\n'),
	)

	const usesStaticFiles = /staticFile\s*\(/.test(code)
	const onlyReferencesStudioKit =
		usesStaticFiles &&
		/staticFile\s*\(\s*[`'"]assets\/(?:3d|audio|visual|texture|fonts)\/v1\//.test(code) &&
		!staticFileCallsOutsideStudioKit(code)
	if (usesStaticFiles && !onlyReferencesStudioKit) {
		warnings.add(
			'This project uses staticFile() outside the built-in asset kit. Files from an uploaded public/ folder are not included, so add those assets to the deployed app or use reachable URLs.',
		)
	}
	if (
		/<\s*(Audio|Html5Audio)[\s/>]/.test(code) &&
		/import\s*{[^}]*\b(?:Audio|Html5Audio)\b[^}]*}\s*from\s*['"]remotion['"]/.test(code)
	) {
		warnings.add(
			'For audio in browser exports, import <Audio> from @remotion/media instead of the legacy remotion Audio/Html5Audio component.',
		)
	}
	// <Video> from @remotion/media is decoded by Remotion's web renderer, which
	// is exactly the supported path - only the legacy remotion/OffthreadVideo
	// tags fall back to the DOM screenshot renderer.
	const mediaVideoImported =
		/import\s*{[^}]*\bVideo\b[^}]*}\s*from\s*['"]@remotion\/media['"]/.test(code)
	if (/<\s*(Video|OffthreadVideo)[\s/>]/.test(code) && !mediaVideoImported) {
		warnings.add(
			'Video layers may not rasterise reliably in the legacy browser path. Use @remotion/media or the server renderer for media-heavy projects.',
		)
	}
	if (/calculateMetadata/.test(code)) {
		warnings.add(
			'calculateMetadata() is not executed in the browser preview. Adjust the size and duration manually if they look wrong.',
		)
	}
	if (/from\s+['"]@remotion\/(three|gif)['"]/.test(code)) {
		warnings.add(
			'Advanced canvas packages are supported by the browser renderer, but 3D and animated GIF layers can be demanding at 2x. Use Max/1x first, then 2x or the server renderer on capable hardware.',
		)
	}
	if (/(?:@remotion\/three|@react-three\/fiber)/.test(code) && /\buseFrame\s*\(/.test(code)) {
		warnings.add(
			'3D animation must use useCurrentFrame(), not React Three Fiber useFrame(), so preview, seeking and exports stay deterministic.',
		)
	}
	if (/GLTFLoader/.test(code) && /\buseLoader\s*\(/.test(code)) {
		warnings.add(
			'Load GLB models through GLTFLoader with delayRender()/continueRender(), not useLoader() alone, so Remotion waits for parsing before it captures a frame.',
		)
	}
	if (/GLTFLoader/.test(code) && (!/\bdelayRender\s*\(/.test(code) || !/\bcontinueRender\s*\(/.test(code))) {
		warnings.add(
			'GLB loading must be wrapped in delayRender()/continueRender() so preview, browser export and server rendering wait for the model.',
		)
	}
	// The browser exporter serialises inline SVG. A tag sized only by CSS has no
	// intrinsic size once serialised and is rasterised at the wrong scale, which
	// silently shifts or crops that layer in the exported file.
	const svgTags = code.match(/<svg\b[^>]*>/g) ?? []
	if (svgTags.some((tag) => !/\bwidth[=\s]/.test(tag) || !/\bheight[=\s]/.test(tag))) {
		warnings.add(
			'Give every inline <svg> explicit width and height attributes (not only CSS). Without them, browser exports rasterise the SVG at the wrong scale.',
		)
	}
	// The browser exporter rasterises <img>/<canvas>/SVG and CSS gradients, but
	// not url() background layers, so those vanish from the file.
	if (/background(?:-image)?\s*:\s*[^;'"`]*url\(/i.test(code) || /backgroundImage\s*:\s*[`'"][^`'"]*url\(/i.test(code)) {
		warnings.add(
			'Images used as CSS background-image: url(...) are not drawn in browser exports. Render them with <Img> from remotion instead, or use the server renderer.',
		)
	}
	// Browser exports copy the WebGL canvas after the frame is composited, which
	// only keeps pixels when the drawing buffer is preserved.
	if (/<\s*ThreeCanvas\b/.test(code) && !/preserveDrawingBuffer\s*:\s*true/.test(code)) {
		warnings.add(
			'Add gl={{preserveDrawingBuffer: true}} to <ThreeCanvas>. Without it, browser exports capture an empty 3D canvas even though the preview looks correct.',
		)
	}
	const threeCanvasTags = code.match(/<\s*ThreeCanvas\b[\s\S]*?>/g) ?? []
	if (threeCanvasTags.some((tag) => !/\bwidth\s*=/.test(tag) || !/\bheight\s*=/.test(tag))) {
		warnings.add(
			'Give every <ThreeCanvas> explicit width and height props from useVideoConfig() so the render surface matches the composition.',
		)
	}
	if (
		threeCanvasTags.length > 0 &&
		!/<\s*(?:ambientLight|directionalLight|hemisphereLight|pointLight|spotLight|rectAreaLight)\b/.test(code)
	) {
		warnings.add(
			'Add intentional lighting inside <ThreeCanvas>; GLB materials may render black without a light source or environment.',
		)
	}
	if (/@react-three\/fiber/.test(code) && /<\s*Canvas\b/.test(code)) {
		warnings.add(
			'Wrap 3D scenes in <ThreeCanvas> from @remotion/three instead of React Three Fiber <Canvas> so frame rendering stays synchronized.',
		)
	}
	return [...warnings]
}
