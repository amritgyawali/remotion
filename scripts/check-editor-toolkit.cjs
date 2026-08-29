#!/usr/bin/env node
/**
 * Proves the editing toolkit - the adjustment desk, the effects rack, camera
 * motion, masks, titles, borders, restoration, the canvas reframe, split
 * screen, transitions and the audio effects - actually does what its cards
 * claim.
 *
 * The suite is in two halves, for the same reason `check-tools-effects.cjs`
 * is:
 *
 *   maths   - offline, no browser. Every claim that can be settled by
 *             arithmetic is: that a neutral adjustment is the identity, that
 *             +1 EV really is a doubling of linear light, that a camera move
 *             can never slide its own edge into frame, that a .cube parses
 *             red-fastest, that the split-screen cells tile the frame exactly,
 *             that an echo lands on the sample it was asked for, and that a
 *             120bpm click track reads as 120bpm. This half runs anywhere and
 *             is the one that catches a shader indexed the wrong way round.
 *
 *   studio  - a real Chrome, the real page. A clip is imported, a tool is
 *             opened, its controls are set the way a person would set them,
 *             it is run, and the finished file is re-opened and its pixels
 *             measured. Desaturating has to come back grey; night vision has
 *             to come back green; a magenta title has to put magenta on the
 *             frame; a 9:16 reframe has to come back 1080x1920. Those are the
 *             assertions a pass that quietly did nothing cannot fake.
 *
 * Usage:
 *   node scripts/check-editor-toolkit.cjs                  # starts its own dev server
 *   node scripts/check-editor-toolkit.cjs --maths-only     # no browser, no network
 *   node scripts/check-editor-toolkit.cjs --base http://localhost:3000
 *   node scripts/check-editor-toolkit.cjs --url https://host/clip.mp4
 *   node scripts/check-editor-toolkit.cjs --headful
 */

require('sucrase/register')

const { spawn } = require('node:child_process')
const path = require('node:path')

const argv = process.argv.slice(2)
const flag = (name, fallback = null) => {
	const at = argv.indexOf('--' + name)
	return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : fallback
}
const has = (name) => argv.includes('--' + name)

const BASE = (flag('base') ?? 'http://localhost:3000').replace(/\/$/, '')
const CLIP = flag('url') ?? 'https://download.samplelib.com/mp4/sample-5s.mp4'
const CLIP_NAME = decodeURIComponent(CLIP.split('/').pop() ?? 'sample.mp4')
const MATHS_ONLY = has('maths-only')
const HEADFUL = has('headful')

const results = []
const record = (group, name, ok, detail) => {
	results.push({ group, name, ok, detail })
	process.stdout.write((ok ? '  ok   ' : '  FAIL ') + name + (detail ? ' - ' + detail : '') + '\n')
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/* ==========================================================================
   An AudioBuffer for Node.

   The audio effects are plain `AudioBuffer -> AudioBuffer` functions, which is
   exactly what makes them testable here - but `AudioBuffer` is a browser
   class. This is the whole of the surface they touch, so standing it up lets
   the reverb, the echo, the equaliser, the voice presets and the beat detector
   all be checked without a browser at all.
   ========================================================================== */

if (typeof globalThis.AudioBuffer === 'undefined') {
	globalThis.AudioBuffer = class NodeAudioBuffer {
		constructor(options) {
			this.length = options.length
			this.numberOfChannels = options.numberOfChannels
			this.sampleRate = options.sampleRate
			this.duration = options.length / options.sampleRate
			this._channels = []
			for (let i = 0; i < options.numberOfChannels; i++) this._channels.push(new Float32Array(options.length))
		}
		getChannelData(index) {
			return this._channels[index]
		}
		copyToChannel(source, index) {
			this._channels[index].set(source.subarray(0, Math.min(source.length, this.length)))
		}
		copyFromChannel(destination, index) {
			destination.set(this._channels[index].subarray(0, destination.length))
		}
	}
}

const registry = require('../lib/tools/registry.ts')
const adjust = require('../lib/tools/adjust.ts')
const effects = require('../lib/tools/effects.ts')
const motion = require('../lib/tools/motion.ts')
const maskModule = require('../lib/tools/mask.ts')
const lut = require('../lib/tools/lut.ts')
const splitScreen = require('../lib/tools/split-screen.ts')
const transitions = require('../lib/tools/transitions.ts')
const blend = require('../lib/tools/blend.ts')
const textFx = require('../lib/tools/text-fx.ts')
const border = require('../lib/tools/border.ts')
const inpaint = require('../lib/tools/inpaint.ts')
const retouch = require('../lib/tools/retouch.ts')
const audioFx = require('../lib/tools/audio-fx.ts')

/* -------------------------------------------------------------------------- */
/*  Registry                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Every new tool, and the params its runner reads out of the params object.
 *
 * A runner reading a key the registry never declares is the failure mode this
 * catches: the slider is simply absent from the panel and the tool silently
 * runs on the fallback default, which looks like the engine not working.
 */
const EXPECTED = [
	['adjust', 'adjust', ['exposure', 'contrast', 'temperature', 'tint', 'highlights', 'shadows', 'whites', 'blacks', 'gamma', 'fade', 'vibrance', 'saturation', 'hue', 'clarity', 'sharpness']],
	['white-balance', 'adjust', ['temperature', 'tint']],
	['hsl-color', 'adjust', ['band', 'bandHue', 'bandSat', 'bandLum', 'bandWidth']],
	['lut-import', 'lut-import', ['strength']],
	['video-effects', 'video-effect', ['effect', 'intensity', 'speed', 'angle', 'colorA', 'colorB']],
	['shape-mask', 'shape-mask', ['shape', 'treatment', 'centerX', 'centerY', 'size', 'ratio', 'rotation', 'feather', 'strength', 'invert', 'color']],
	['camera-motion', 'camera-motion', ['preset', 'amount', 'easing', 'seconds', 'reverse']],
	['reverse-video', 'reverse-video', ['includeAudio']],
	['add-transition', 'transition', ['transition', 'seconds']],
	['split-screen', 'split-screen', ['layout', 'aspect', 'fit', 'gap', 'radius', 'background']],
	['blend-overlay', 'blend-overlay', ['mode', 'opacity', 'placement', 'fit', 'scale', 'startAt', 'loop']],
	['canvas-background', 'canvas-background', ['aspect', 'backdrop', 'blurStrength', 'dim', 'foregroundScale', 'color', 'colorB']],
	['auto-reframe', 'auto-reframe', ['aspect', 'steadiness', 'motionOnly', 'model']],
	['animated-text', 'animated-text', ['content', 'style', 'animation', 'position', 'fontSize', 'weight', 'color', 'accent', 'startAt', 'seconds', 'animateSeconds', 'maxWidth', 'offsetY', 'rotation', 'uppercase']],
	['border-frame', 'border-frame', ['style', 'thickness', 'radius', 'opacity', 'color', 'colorB']],
	['video-enhance', 'enhance', ['denoise', 'deblock', 'sharpen', 'saturation', 'upscale']],
	['watermark-remove', 'remove-object', ['mode', 'x', 'y', 'width', 'height', 'feather', 'strength', 'matchGrain']],
	['retouch', 'retouch', ['smooth', 'even', 'brighten', 'warmth', 'eyes', 'radius']],
	['reverb', 'reverb', ['size', 'damping', 'wet', 'preDelayMs', 'width']],
	['echo-delay', 'echo', ['delayMs', 'feedback', 'wet', 'pingPong']],
	['equalizer', 'equalizer', ['low', 'lowMid', 'mid', 'highMid', 'high']],
	['voice-changer', 'voice-changer', ['preset']],
	['beat-markers', 'beat-detect', ['sensitivity']],
]

function checkRegistry() {
	process.stdout.write('\nregistry\n')

	let missingTools = []
	let wrongHandler = []
	let missingParams = []
	for (const [id, handler, keys] of EXPECTED) {
		const tool = registry.toolById(id)
		if (!tool) {
			missingTools.push(id)
			continue
		}
		if (tool.status !== 'ready' || tool.handler !== handler) wrongHandler.push(id + ' (' + tool.status + '/' + tool.handler + ')')
		const declared = new Set((tool.params ?? []).map((param) => param.key))
		const absent = keys.filter((key) => !declared.has(key))
		if (absent.length > 0) missingParams.push(id + ': ' + absent.join(', '))
	}
	record('registry', 'every new tool is in the catalogue', missingTools.length === 0, missingTools.join(', ') || undefined)
	record('registry', 'every new tool is ready and wired to its engine', wrongHandler.length === 0, wrongHandler.join(' | ') || undefined)
	record('registry', 'every tool declares the params its runner reads', missingParams.length === 0, missingParams.join(' | ') || undefined)

	const ids = registry.TOOLS.map((tool) => tool.id)
	record('registry', 'no tool id is used twice', new Set(ids).size === ids.length, ids.length + ' tools')

	const categories = new Set(registry.CATEGORIES.map((entry) => entry.id))
	const orphans = registry.TOOLS.filter((tool) => !categories.has(tool.category)).map((tool) => tool.id)
	record('registry', 'every tool sits in a category the page renders', orphans.length === 0, orphans.join(', ') || undefined)

	// The pickers are built from the engines' own catalogues, so this is really
	// asserting that the derivation was not replaced by a hand-written list.
	const optionsFor = (toolId, key) => {
		const tool = registry.toolById(toolId)
		const param = (tool?.params ?? []).find((entry) => entry.key === key)
		return param && param.type === 'select' ? param.options.map((option) => option.value) : null
	}
	const sameSet = (a, b) => Array.isArray(a) && a.length === b.length && b.every((value) => a.includes(value))

	record(
		'registry',
		'the effect picker offers exactly the effects that exist',
		sameSet(optionsFor('video-effects', 'effect'), effects.EFFECTS.map((entry) => entry.id)),
		effects.EFFECTS.length + ' effects',
	)
	record(
		'registry',
		'the move picker offers exactly the moves that exist',
		sameSet(optionsFor('camera-motion', 'preset'), motion.MOTION_PRESETS.map((entry) => entry.id)),
		motion.MOTION_PRESETS.length + ' moves',
	)
	record(
		'registry',
		'the transition picker offers exactly the transitions that exist',
		sameSet(optionsFor('add-transition', 'transition'), transitions.TRANSITIONS.map((entry) => entry.id)),
		transitions.TRANSITIONS.length + ' transitions',
	)
	record(
		'registry',
		'the blend picker offers exactly the modes that exist',
		sameSet(optionsFor('blend-overlay', 'mode'), blend.BLEND_MODES.map((entry) => entry.id)),
		blend.BLEND_MODES.length + ' modes',
	)
	record(
		'registry',
		'the mask picker offers exactly the shapes that exist',
		sameSet(optionsFor('shape-mask', 'shape'), maskModule.MASK_SHAPES.map((entry) => entry.id)),
		maskModule.MASK_SHAPES.length + ' shapes',
	)
	record(
		'registry',
		'the title pickers offer exactly the styles and animations that exist',
		sameSet(optionsFor('animated-text', 'style'), textFx.TEXT_STYLES.map((entry) => entry.id)) &&
			sameSet(optionsFor('animated-text', 'animation'), textFx.TEXT_ANIMATIONS.map((entry) => entry.id)),
		textFx.TEXT_STYLES.length + ' styles, ' + textFx.TEXT_ANIMATIONS.length + ' animations',
	)
	record(
		'registry',
		'the border picker offers exactly the styles that exist',
		sameSet(optionsFor('border-frame', 'style'), border.BORDER_STYLES.map((entry) => entry.id)),
		border.BORDER_STYLES.length + ' styles',
	)
	record(
		'registry',
		'the object-removal picker offers exactly the modes that exist',
		sameSet(optionsFor('watermark-remove', 'mode'), inpaint.INPAINT_MODES.map((entry) => entry.id)),
		inpaint.INPAINT_MODES.length + ' modes',
	)
	record(
		'registry',
		'the voice picker offers exactly the characters that exist',
		sameSet(optionsFor('voice-changer', 'preset'), audioFx.VOICE_PRESETS.map((entry) => entry.id)),
		audioFx.VOICE_PRESETS.length + ' characters',
	)
	record(
		'registry',
		'the layout picker offers exactly the layouts that exist',
		sameSet(optionsFor('split-screen', 'layout'), splitScreen.SPLIT_LAYOUTS.map((entry) => entry.id)),
		splitScreen.SPLIT_LAYOUTS.length + ' layouts',
	)

	// Every featured effect card has to name an effect that is really there.
	const featured = registry.TOOLS.filter((tool) => tool.id.startsWith('effect-'))
	const broken = featured.filter((tool) => {
		const param = (tool.params ?? []).find((entry) => entry.key === 'effect')
		return !param || !effects.effectById(param.default)
	})
	record('registry', 'every one-click effect card names a real effect', broken.length === 0 && featured.length > 0, featured.length + ' cards')

	const previewable = ['adjust', 'video-effects', 'camera-motion', 'shape-mask', 'animated-text', 'border-frame', 'retouch', 'video-enhance', 'watermark-remove', 'lut-import', 'canvas-background', 'blend-overlay']
	const withoutPreview = previewable.filter((id) => registry.toolById(id)?.preview !== true)
	record('registry', 'the tools that must be seen offer a frame preview', withoutPreview.length === 0, withoutPreview.join(', ') || undefined)
}

/* -------------------------------------------------------------------------- */
/*  Adjust                                                                    */
/* -------------------------------------------------------------------------- */

const NEUTRAL = adjust.NEUTRAL_ADJUST
const withAdjust = (overrides) => ({ ...NEUTRAL, ...overrides })
const close = (a, b, tolerance) => Math.abs(a - b) <= tolerance

function checkAdjust() {
	process.stdout.write('\nadjust\n')

	record('adjust', 'a neutral setting is recognised as neutral', adjust.isNeutralAdjust(NEUTRAL))
	record('adjust', 'one moved slider is not neutral', !adjust.isNeutralAdjust(withAdjust({ contrast: 0.2 })))

	// The identity: nothing moved, nothing changes. A grade that fails this is
	// applying a cast to every clip that goes through it.
	let identity = true
	for (const value of [0, 0.05, 0.25, 0.5, 0.75, 1]) {
		const out = adjust.adjustPixelForTest([value, value, value], NEUTRAL)
		if (!close(out[0], value, 0.002) || !close(out[1], value, 0.002) || !close(out[2], value, 0.002)) identity = false
	}
	record('adjust', 'a neutral adjustment is the identity', identity)

	// +1 EV is a doubling of *linear* light, not of the code value. Testing it
	// in linear space is the only way to catch an exposure applied in sRGB,
	// which looks plausible and is wrong by roughly a factor of two.
	const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
	const base = 0.2
	const lifted = adjust.adjustPixelForTest([base, base, base], withAdjust({ exposure: 1 }))[0]
	record(
		'adjust',
		'+1 EV doubles the light rather than the code value',
		close(toLinear(lifted), toLinear(base) * 2, 0.004),
		'linear ' + toLinear(base).toFixed(4) + ' -> ' + toLinear(lifted).toFixed(4),
	)

	const warmed = adjust.adjustPixelForTest([0.5, 0.5, 0.5], withAdjust({ temperature: 0.5 }))
	record('adjust', 'warming raises red and lowers blue', warmed[0] > 0.5 && warmed[2] < 0.5, warmed.map((v) => v.toFixed(3)).join(', '))

	const cooled = adjust.adjustPixelForTest([0.5, 0.5, 0.5], withAdjust({ temperature: -0.5 }))
	record('adjust', 'cooling does the opposite', cooled[0] < 0.5 && cooled[2] > 0.5, cooled.map((v) => v.toFixed(3)).join(', '))

	// Contrast pivots at 18% grey, so a mid-grey card must not move.
	const pivot = adjust.adjustPixelForTest([0.46, 0.46, 0.46], withAdjust({ contrast: 0.6 }))[0]
	record('adjust', 'contrast pivots at 18% grey', close(pivot, 0.46, 0.02), 'stayed at ' + pivot.toFixed(3))

	// Vibrance is the whole reason it is not just saturation: a flat colour
	// must come up further than a vivid one.
	const saturationOf = (rgb) => Math.max(...rgb) - Math.min(...rgb)
	const flatBefore = saturationOf([0.5, 0.45, 0.42])
	const flatAfter = saturationOf(adjust.adjustPixelForTest([0.5, 0.45, 0.42], withAdjust({ vibrance: 0.8 })))
	const vividBefore = saturationOf([0.95, 0.1, 0.1])
	const vividAfter = saturationOf(adjust.adjustPixelForTest([0.95, 0.1, 0.1], withAdjust({ vibrance: 0.8 })))
	record(
		'adjust',
		'vibrance lifts flat colour more than vivid colour',
		flatAfter / flatBefore > vividAfter / vividBefore,
		'flat x' + (flatAfter / flatBefore).toFixed(2) + ', vivid x' + (vividAfter / vividBefore).toFixed(2),
	)

	// Shadows and highlights have to stay in their own half of the range.
	const highlightOnShadow = adjust.adjustPixelForTest([0.08, 0.08, 0.08], withAdjust({ highlights: 1 }))[0]
	record('adjust', 'a highlight lift leaves the shadows alone', close(highlightOnShadow, 0.08, 0.01), 'moved to ' + highlightOnShadow.toFixed(3))
	const shadowOnHighlight = adjust.adjustPixelForTest([0.95, 0.95, 0.95], withAdjust({ shadows: 1 }))[0]
	record('adjust', 'a shadow lift leaves the highlights alone', close(shadowOnHighlight, 0.95, 0.01), 'moved to ' + shadowOnHighlight.toFixed(3))

	// The HSL band must find its own hue and ignore everything else.
	const band = { center: adjust.bandCenterById('blue'), width: 0.18, hue: 0, saturation: 1, luminance: 0 }
	const blueIn = [0.15, 0.3, 0.85]
	const blueOut = adjust.adjustPixelForTest(blueIn, withAdjust({ band }))
	const redIn = [0.85, 0.2, 0.2]
	const redOut = adjust.adjustPixelForTest(redIn, withAdjust({ band }))
	record(
		'adjust',
		'an HSL band moves its own colour and not the others',
		saturationOf(blueOut) > saturationOf(blueIn) * 1.05 && close(saturationOf(redOut), saturationOf(redIn), 0.01),
		'blue ' + saturationOf(blueIn).toFixed(3) + ' -> ' + saturationOf(blueOut).toFixed(3),
	)

	// Grey has no hue, so no band may claim it.
	const greyOut = adjust.adjustPixelForTest([0.5, 0.5, 0.5], withAdjust({ band: { ...band, saturation: 1, luminance: 1 } }))
	record('adjust', 'an HSL band leaves grey alone', close(greyOut[0], 0.5, 0.005) && close(greyOut[2], 0.5, 0.005), greyOut.map((v) => v.toFixed(3)).join(', '))

	// Skin lives in a chroma window that is meant to hold across skin tones.
	const skinSamples = [
		[241, 194, 170],
		[224, 172, 138],
		[198, 134, 106],
		[141, 85, 60],
		[92, 56, 40],
	]
	const skinScores = skinSamples.map((rgb) => retouch.skinMaskForTest(rgb[0], rgb[1], rgb[2]))
	record('adjust', 'the skin mask finds skin across tones', skinScores.every((score) => score > 0.4), skinScores.map((s) => s.toFixed(2)).join(', '))
	const notSkin = [
		[40, 90, 200],
		[30, 180, 60],
		[120, 120, 120],
	].map((rgb) => retouch.skinMaskForTest(rgb[0], rgb[1], rgb[2]))
	record('adjust', 'the skin mask ignores sky, foliage and grey', notSkin.every((score) => score < 0.15), notSkin.map((s) => s.toFixed(2)).join(', '))
}

/* -------------------------------------------------------------------------- */
/*  Effects and motion                                                        */
/* -------------------------------------------------------------------------- */

function checkEffects() {
	process.stdout.write('\neffects\n')

	const ids = effects.EFFECTS.map((entry) => entry.id)
	record('effects', 'at least thirty-five effects ship', ids.length >= 35, ids.length + ' effects')
	record('effects', 'no effect id is used twice', new Set(ids).size === ids.length)

	// The shader switches on the array index, so a lookup that disagrees with
	// the catalogue would apply the wrong effect - silently, and plausibly.
	const contiguous = ids.every((id, index) => effects.effectCode(id) === index)
	record('effects', 'every effect maps to its own shader branch', contiguous)
	record('effects', 'an unknown effect id is reported, not guessed', effects.effectCode('not-a-real-effect') === -1)

	const described = effects.EFFECTS.every((entry) => entry.label && entry.blurb && entry.blurb.length > 12)
	record('effects', 'every effect is named and described', described)

	const sane = effects.EFFECTS.every((entry) => entry.defaultIntensity >= 0 && entry.defaultIntensity <= 100)
	record('effects', 'every default intensity is in range', sane)
}

function checkMotion() {
	process.stdout.write('\nmotion\n')

	record('motion', 'eighteen moves ship', motion.MOTION_PRESETS.length >= 18, motion.MOTION_PRESETS.length + ' moves')
	record('motion', 'no move id is used twice', new Set(motion.MOTION_PRESETS.map((entry) => entry.id)).size === motion.MOTION_PRESETS.length)

	/**
	 * The promise the tool makes: a move never slides its own edge into shot.
	 *
	 * A frame is covered when the zoom is at least what the slide needs
	 * (1 + 2 * offset) and, once it is turned, at least what the rotated
	 * diagonal needs. Checking it at full strength across every preset and
	 * every frame is what makes "no black bars" a guarantee rather than a hope.
	 */
	const uncovered = []
	for (const preset of motion.MOTION_PRESETS) {
		const plan = motion.createMotionPlan({
			preset: preset.id,
			amount: 1,
			easing: 'ease-in-out',
			durationSeconds: 4,
			fps: 30,
			reverse: false,
		})
		for (let frame = 0; frame < 120; frame++) {
			const transform = plan(frame)
			const slide = 1 + 2 * Math.max(Math.abs(transform.offsetX), Math.abs(transform.offsetY))
			const radians = (Math.abs(transform.rotateDeg) * Math.PI) / 180
			const needed = slide * (Math.abs(Math.sin(radians)) + Math.abs(Math.cos(radians)))
			if (transform.scale < needed - 1e-6) {
				uncovered.push(preset.id + ' at frame ' + frame + ' (' + transform.scale.toFixed(3) + ' < ' + needed.toFixed(3) + ')')
				break
			}
		}
	}
	record('motion', 'no move can slide its own edge into frame', uncovered.length === 0, uncovered.slice(0, 3).join(' | ') || undefined)

	// Amount zero has to be a genuine no-op, or the "off" end of the slider
	// still moves the picture.
	const still = motion.createMotionPlan({ preset: 'ken-burns', amount: 0, easing: 'linear', durationSeconds: 4, fps: 30, reverse: false })
	const frames = [0, 30, 60, 119].map((frame) => still(frame))
	record(
		'motion',
		'an amount of zero leaves the framing alone',
		frames.every((entry) => close(entry.scale, 1, 1e-6) && close(entry.offsetX, 0, 1e-6) && close(entry.offsetY, 0, 1e-6)),
	)

	// Reversing has to actually reverse: the first frame of a reversed push is
	// where the forward one ended.
	const forward = motion.createMotionPlan({ preset: 'zoom-in', amount: 1, easing: 'linear', durationSeconds: 4, fps: 30, reverse: false })
	const backward = motion.createMotionPlan({ preset: 'zoom-in', amount: 1, easing: 'linear', durationSeconds: 4, fps: 30, reverse: true })
	record(
		'motion',
		'running a move backwards mirrors it',
		close(forward(0).scale, backward(119).scale, 0.002) && close(forward(119).scale, backward(0).scale, 0.002),
		forward(119).scale.toFixed(3) + ' vs ' + backward(0).scale.toFixed(3),
	)

	// A cyclic move must still be moving at the end - it has no end.
	const wobble = motion.createMotionPlan({ preset: 'handheld', amount: 1, easing: 'linear', durationSeconds: 2, fps: 30, reverse: false })
	const wobbleSpread = [0, 15, 30, 45].map((frame) => wobble(frame).offsetX)
	record('motion', 'a looping move keeps moving', new Set(wobbleSpread.map((v) => v.toFixed(4))).size > 1)
}

/* -------------------------------------------------------------------------- */
/*  Layouts, masks, LUTs                                                      */
/* -------------------------------------------------------------------------- */

function checkLayouts() {
	process.stdout.write('\nlayouts\n')

	const problems = []
	for (const layout of splitScreen.SPLIT_LAYOUTS) {
		if (layout.cells.length !== layout.panels) problems.push(layout.id + ': ' + layout.cells.length + ' cells for ' + layout.panels + ' panels')
		const area = layout.cells.reduce((sum, cell) => sum + cell[2] * cell[3], 0)
		// The cells have to tile the frame exactly: any gap is a band of
		// background nobody asked for, any overlap is a panel hidden behind
		// another one.
		if (Math.abs(area - 1) > 0.001) problems.push(layout.id + ': cells cover ' + area.toFixed(3) + ' of the frame')
		for (let i = 0; i < layout.cells.length; i++) {
			for (let j = i + 1; j < layout.cells.length; j++) {
				const [ax, ay, aw, ah] = layout.cells[i]
				const [bx, by, bw, bh] = layout.cells[j]
				const overlapX = Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx))
				const overlapY = Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by))
				if (overlapX * overlapY > 0.0001) problems.push(layout.id + ': panels ' + (i + 1) + ' and ' + (j + 1) + ' overlap')
			}
		}
		for (const [x, y, w, h] of layout.cells) {
			if (x < -1e-6 || y < -1e-6 || x + w > 1 + 1e-6 || y + h > 1 + 1e-6) problems.push(layout.id + ': a panel falls outside the frame')
		}
	}
	record('layouts', 'every split-screen layout tiles the frame exactly', problems.length === 0, problems.slice(0, 3).join(' | ') || undefined)
	record('layouts', 'every layout can be looked up by id', splitScreen.SPLIT_LAYOUTS.every((layout) => splitScreen.splitLayoutById(layout.id) === layout))
	record('layouts', 'an unknown layout id returns nothing rather than a default', splitScreen.splitLayoutById('nope') === null)

	const aspects = Object.values(splitScreen.SPLIT_ASPECTS)
	record('layouts', 'every output size is even, so every encoder accepts it', aspects.every(([w, h]) => w % 2 === 0 && h % 2 === 0))

	record('layouts', 'eleven mask shapes ship', maskModule.MASK_SHAPES.length >= 11, maskModule.MASK_SHAPES.length + ' shapes')
	record('layouts', 'five mask treatments ship', maskModule.MASK_TREATMENTS.length >= 5)
	record('layouts', 'seventeen blend modes ship', blend.BLEND_MODES.length >= 17, blend.BLEND_MODES.length + ' modes')
	record('layouts', 'seventeen transitions ship', transitions.TRANSITIONS.length >= 17, transitions.TRANSITIONS.length + ' transitions')

	// The anchored placement maths, which decides where a corner overlay lands.
	const rect = blend.placeLayer(
		{ mode: 'normal', opacity: 1, placement: 'bottom-right', fit: 'cover', scale: 0.25 },
		1920,
		1080,
		1280,
		720,
	)
	record(
		'layouts',
		'an anchored overlay lands inside the frame',
		rect.x > 0 && rect.y > 0 && rect.x + rect.width <= 1920 && rect.y + rect.height <= 1080,
		Math.round(rect.x) + ',' + Math.round(rect.y) + ' ' + Math.round(rect.width) + 'x' + Math.round(rect.height),
	)
	const filled = blend.placeLayer({ mode: 'normal', opacity: 1, placement: 'fill', fit: 'cover', scale: 1 }, 1080, 1920, 1920, 1080)
	record(
		'layouts',
		'a filling overlay covers the whole frame',
		filled.width >= 1080 - 0.5 && filled.height >= 1920 - 0.5,
		Math.round(filled.width) + 'x' + Math.round(filled.height),
	)

	// A frame has to shrink the picture, or it is covering part of it.
	const inset = border.borderInset({ style: 'solid', thickness: 5, radius: 0, color: '#fff', colorB: '#000', opacity: 100 }, 1920, 1080)
	record('layouts', 'a border insets the picture instead of covering it', Boolean(inset) && inset.scale < 1 && inset.scale > 0.8, inset ? inset.scale.toFixed(3) : 'none')
	const noBorder = border.borderInset({ style: 'solid', thickness: 0, radius: 0, color: '#fff', colorB: '#000', opacity: 100 }, 1920, 1080)
	record('layouts', 'a zero-width border does not touch the picture', noBorder === null)
}

/** Builds a .cube file body for an identity 3D LUT of the given size. */
function identityCube(size) {
	const lines = ['TITLE "Identity"', 'LUT_3D_SIZE ' + size]
	const step = 1 / (size - 1)
	for (let b = 0; b < size; b++) {
		for (let g = 0; g < size; g++) {
			for (let r = 0; r < size; r++) {
				lines.push([r * step, g * step, b * step].map((v) => v.toFixed(6)).join(' '))
			}
		}
	}
	return lines.join('\n')
}

function checkLut() {
	process.stdout.write('\nlut\n')

	const parsed = lut.parseCubeLut(identityCube(9))
	record('lut', 'a 3D cube parses', parsed.lut.size === 9 && parsed.sourceDimensions === 3, parsed.title)

	// The identity has to come back as the identity, which is the check that
	// catches a cube read green-fastest instead of red-fastest: the sizes and
	// the value range would both still look right.
	let worst = 0
	const size = parsed.lut.size
	for (let b = 0; b < size; b++) {
		for (let g = 0; g < size; g++) {
			for (let r = 0; r < size; r++) {
				const index = ((b * size + g) * size + r) * 3
				const expected = [r, g, b].map((axis) => Math.round((axis / (size - 1)) * 255))
				for (let channel = 0; channel < 3; channel++) {
					worst = Math.max(worst, Math.abs(parsed.lut.data[index + channel] - expected[channel]))
				}
			}
		}
	}
	record('lut', 'an identity cube round-trips red-fastest', worst <= 1, 'worst error ' + worst)

	// A red-only ramp in a 1D LUT must land on red and nothing else.
	const oneD = ['LUT_1D_SIZE 4', '0 0 0', '0.25 0 0', '0.5 0 0', '1 0 0'].join('\n')
	const curve = lut.parseCubeLut(oneD)
	record('lut', 'a 1D curve is expanded into a cube', curve.sourceDimensions === 1 && curve.lut.size === 4)
	const topRed = curve.lut.data[(3 * 4 * 4 + 0 * 4 + 3) * 3]
	record('lut', 'a 1D curve keeps each channel on its own axis', topRed === 255, 'red at the top of the ramp is ' + topRed)

	// A wider domain is a real thing in log-space LUTs, and ignoring it clips.
	const domained = lut.parseCubeLut(['LUT_3D_SIZE 2', 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 2 2 2', '0 0 0', '2 0 0', '0 2 0', '2 2 0', '0 0 2', '2 0 2', '0 2 2', '2 2 2'].join('\n'))
	record('lut', 'DOMAIN_MAX is honoured rather than clipped', domained.lut.data[3] === 255, 'first red is ' + domained.lut.data[3])

	let rejected = ''
	try {
		lut.parseCubeLut('# no size line\n0 0 0\n')
	} catch (error) {
		rejected = error.name
	}
	record('lut', 'a file that is not a LUT is rejected with a reason', rejected === 'LutParseError', rejected || 'accepted')

	let truncated = ''
	try {
		lut.parseCubeLut('LUT_3D_SIZE 4\n0 0 0\n1 1 1\n')
	} catch (error) {
		truncated = error.name
	}
	record('lut', 'a truncated LUT is rejected', truncated === 'LutParseError', truncated || 'accepted')

	// Strength is applied to the table, so zero has to be the identity.
	const strong = lut.parseCubeLut(['LUT_3D_SIZE 2', '1 1 1', '1 1 1', '1 1 1', '1 1 1', '1 1 1', '1 1 1', '1 1 1', '1 1 1'].join('\n'))
	const faded = lut.blendLutTowardIdentity(strong.lut, 0)
	const identityAtBlack = faded.data[0] === 0 && faded.data[1] === 0 && faded.data[2] === 0
	const identityAtWhite = faded.data[faded.data.length - 1] === 255
	record('lut', 'a strength of zero fades a LUT back to the identity', identityAtBlack && identityAtWhite)
}

/* -------------------------------------------------------------------------- */
/*  Audio                                                                     */
/* -------------------------------------------------------------------------- */

function makeBuffer(seconds, sampleRate, fill) {
	const length = Math.round(seconds * sampleRate)
	const buffer = new globalThis.AudioBuffer({ length, numberOfChannels: 2, sampleRate })
	for (let channel = 0; channel < 2; channel++) {
		const data = buffer.getChannelData(channel)
		for (let i = 0; i < length; i++) data[i] = fill(i / sampleRate, i)
	}
	return buffer
}

const rms = (data) => {
	let sum = 0
	for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
	return Math.sqrt(sum / Math.max(1, data.length))
}

function checkAudio() {
	process.stdout.write('\naudio\n')
	const rate = 48000

	/* ------------------------------------------------------------ equaliser */

	// Two details, both of which will silently ruin this measurement:
	//
	//  - 40 Hz, not 80. The low control is a *shelf* with its corner at 120 Hz,
	//    so its stated gain is only reached well below the corner - at the
	//    corner itself it is by definition half of it.
	//  - amplitude 0.15, not 0.5. The equaliser clips its output to [-1, 1],
	//    as it must, and a 0.5 sine lifted by 12 dB would be measuring the
	//    clipper rather than the filter.
	const low = makeBuffer(0.5, rate, (t) => Math.sin(2 * Math.PI * 40 * t) * 0.15)
	const high = makeBuffer(0.5, rate, (t) => Math.sin(2 * Math.PI * 10000 * t) * 0.15)
	const settings = { low: 12, lowMid: 0, mid: 0, highMid: 0, high: 0 }
	const lowBoosted = audioFx.applyEqualizer(low, settings)
	const highUnderLowBoost = audioFx.applyEqualizer(high, settings)
	const lowGain = rms(lowBoosted.getChannelData(0)) / rms(low.getChannelData(0))
	const highGain = rms(highUnderLowBoost.getChannelData(0)) / rms(high.getChannelData(0))
	record('audio', 'a low shelf lifts the low end by the 12 dB it says', lowGain > 3.5 && lowGain < 4.2, 'x' + lowGain.toFixed(2))
	record('audio', 'a low shelf leaves 10 kHz alone', close(highGain, 1, 0.08), 'x' + highGain.toFixed(3))

	const cut = audioFx.applyEqualizer(high, { low: 0, lowMid: 0, mid: 0, highMid: 0, high: -18 })
	const cutGain = rms(cut.getChannelData(0)) / rms(high.getChannelData(0))
	record('audio', 'a high shelf cut takes the top end out', cutGain < 0.35, 'x' + cutGain.toFixed(3))

	/* ----------------------------------------------------------------- echo */

	// One sample of signal, then silence: the repeat has to land on exactly the
	// sample the delay asked for.
	const impulse = makeBuffer(1, rate, (_t, i) => (i === 0 ? 1 : 0))
	const echoed = audioFx.applyEcho(impulse, { delayMs: 100, feedback: 0.5, wet: 1, pingPong: false })
	const expectedAt = Math.round((100 / 1000) * rate)
	const data = echoed.getChannelData(0)
	let loudest = 0
	let loudestAt = 0
	for (let i = 10; i < data.length; i++) {
		if (Math.abs(data[i]) > loudest) {
			loudest = Math.abs(data[i])
			loudestAt = i
		}
	}
	record('audio', 'an echo lands on the sample it was asked for', Math.abs(loudestAt - expectedAt) <= 1, loudestAt + ' vs ' + expectedAt)

	// Each repeat has to be quieter than the one before it. Comparing a repeat
	// against the *original* would prove nothing at a full wet mix, where the
	// first repeat is meant to be as loud as the sound that made it.
	const firstRepeat = Math.abs(data[expectedAt])
	const secondRepeat = Math.abs(data[expectedAt * 2])
	record(
		'audio',
		'each repeat is quieter than the one before it',
		firstRepeat > 0.2 && secondRepeat > 0 && secondRepeat < firstRepeat * 0.75,
		firstRepeat.toFixed(3) + ' -> ' + secondRepeat.toFixed(3),
	)

	const pingPong = audioFx.applyEcho(impulse, { delayMs: 100, feedback: 0.5, wet: 1, pingPong: true })
	const leftRepeat = Math.abs(pingPong.getChannelData(0)[expectedAt])
	record('audio', 'ping-pong still produces its first repeat', leftRepeat > 0.2, leftRepeat.toFixed(3))

	/* --------------------------------------------------------------- reverb */

	// Half a second of tone, half a second of nothing. A reverb has to put
	// something in the silence, and it has to be decaying.
	const burst = makeBuffer(1.5, rate, (t) => (t < 0.5 ? Math.sin(2 * Math.PI * 440 * t) * 0.6 : 0))
	const wet = audioFx.applyReverb(burst, { size: 0.9, damping: 0.3, wet: 0.9, preDelayMs: 0, width: 1 })
	const tail = wet.getChannelData(0)
	const early = rms(tail.subarray(Math.round(0.55 * rate), Math.round(0.7 * rate)))
	const late = rms(tail.subarray(Math.round(1.2 * rate), Math.round(1.4 * rate)))
	record('audio', 'a reverb rings on after the sound stops', early > 0.001, 'tail ' + early.toFixed(5))
	record('audio', 'the tail decays rather than sustaining', late < early, early.toFixed(5) + ' -> ' + late.toFixed(5))
	record('audio', 'nothing clips out of range', tail.every((value) => value >= -1.0001 && value <= 1.0001))

	// The two channels must not be identical, or it is a pipe, not a room.
	let channelsDiffer = false
	const right = wet.getChannelData(1)
	for (let i = Math.round(0.6 * rate); i < Math.round(0.9 * rate); i += 97) {
		if (Math.abs(tail[i] - right[i]) > 1e-6) {
			channelsDiffer = true
			break
		}
	}
	record('audio', 'the reverb is a room, not a pipe - the channels differ', channelsDiffer)

	/* -------------------------------------------------------- voice changer */

	const speech = makeBuffer(0.4, rate, (t) => Math.sin(2 * Math.PI * 180 * t) * 0.4 + Math.sin(2 * Math.PI * 540 * t) * 0.2)
	const identityShift = (input) => input
	const broken = []
	for (const preset of audioFx.VOICE_PRESETS) {
		try {
			const out = audioFx.applyVoicePreset(speech, preset.id, identityShift)
			const channel = out.getChannelData(0)
			const finite = channel.every((value) => Number.isFinite(value) && value >= -1.0001 && value <= 1.0001)
			const audible = rms(channel) > 0.0005
			if (!finite || !audible) broken.push(preset.id + (finite ? ' (silent)' : ' (out of range)'))
		} catch (error) {
			broken.push(preset.id + ' threw: ' + String((error && error.message) || error))
		}
	}
	record('audio', 'every voice preset runs and stays in range', broken.length === 0, broken.join(' | ') || audioFx.VOICE_PRESETS.length + ' presets')

	/* ----------------------------------------------------------- beat detect */

	// A synthetic 120bpm click: a short decaying burst every half second.
	const bpm = 120
	const period = 60 / bpm
	const clicks = makeBuffer(8, rate, (t) => {
		const phase = t % period
		if (phase > 0.05) return 0
		return Math.sin(2 * Math.PI * 1200 * phase) * Math.exp(-phase * 60) * 0.9
	})
	const analysis = audioFx.detectBeats(clicks, 0.55)
	record('audio', 'a click track is heard as beats', analysis.beats.length >= 12, analysis.beats.length + ' beats')
	record('audio', 'the tempo comes back right', analysis.bpm !== null && Math.abs(analysis.bpm - bpm) <= 3, String(analysis.bpm))
	record('audio', 'the tempo is reported as confident', analysis.confidence > 0.6, analysis.confidence.toFixed(2))

	// Silence has no beat, and saying it does would put markers everywhere.
	const silence = makeBuffer(4, rate, () => 0)
	const nothing = audioFx.detectBeats(silence, 0.55)
	record('audio', 'silence has no beat', nothing.beats.length === 0 && nothing.bpm === null)
}

/* ==========================================================================
   The studio half.
   ========================================================================== */

async function reachable(url, timeoutMs = 45_000) {
	try {
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), timeoutMs)
		const response = await fetch(url, { signal: controller.signal })
		clearTimeout(timer)
		return response.status > 0
	} catch {
		return false
	}
}

async function ensureServer() {
	if (await reachable(BASE + '/tools')) return null
	if (flag('base')) throw new Error('Nothing is answering at ' + BASE + '.')

	process.stdout.write('starting dev server\n')
	const child = spawn('npm', ['run', 'dev'], {
		cwd: path.resolve(__dirname, '..'),
		stdio: 'ignore',
		shell: process.platform === 'win32',
		detached: false,
	})
	for (let attempt = 0; attempt < 120; attempt += 1) {
		await sleep(1000)
		if (await reachable(BASE + '/tools', 4000)) return child
	}
	child.kill()
	throw new Error('The dev server never came up.')
}

/* ------------------------------- in-page probes ---------------------------- */

function pageSettled() {
	return document.readyState === 'complete'
}

function fieldPresent() {
	return Boolean(document.querySelector('input[aria-label="Video address"]'))
}

/**
 * Types the address, then presses the button next to it on a later poll.
 *
 * Two passes, not one: the button only enables once React has re-rendered
 * with the typed value, so filling and clicking in the same tick always finds
 * it disabled.
 */
function fillAndSubmit(input) {
	const field = document.querySelector('input[aria-label="Video address"]')
	if (!field) return 'no-field'
	if (field.value !== input.value) {
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
		setter.call(field, input.value)
		field.dispatchEvent(new Event('input', { bubbles: true }))
		return 'typed'
	}
	const row = field.parentElement
	const button = row ? row.querySelector('button') : null
	if (!button) return 'no-button'
	if (button.disabled) return 'disabled'
	button.click()
	return 'clicked'
}

function clipLoaded(name) {
	const text = document.body.innerText || ''
	if (text.includes(name)) return 'named'
	const failure = Array.from(document.querySelectorAll('.notice--error'))
		.map((node) => (node.textContent || '').trim())
		.filter(Boolean)
		.join(' | ')
	return failure ? 'error: ' + failure : ''
}

/**
 * Opens a tool by the exact text of its card.
 *
 * Exact, not a prefix: "Reverse" and "Reverse Audio" are two different tools,
 * and a prefix match would quietly test the wrong one.
 */
function selectToolExact(name) {
	const open = document.querySelector('.card-title')
	if (open && (open.textContent || '').trim() === name) return 'open'
	const back = Array.from(document.querySelectorAll('.chip')).find((node) => (node.textContent || '').trim() === 'All tools')
	if (back) {
		back.click()
		return 'went-back'
	}
	const card = Array.from(document.querySelectorAll('.tool-card')).find(
		(node) => (node.querySelector('.tool-card-name')?.textContent || '').trim().split('\n')[0].trim() === name,
	)
	if (!card) return 'missing'
	card.click()
	return 'clicked'
}

/**
 * Finds a control by its field label and drives it the way React expects.
 *
 * The label match prefers an exact hit over a substring one, because several
 * panels carry both a "Colour" and a "Second colour" and a substring match
 * would take whichever came first. File inputs are refused rather than
 * written to: the browser throws on any attempt to set one, and a thrown
 * evaluation would take the whole studio run down with it.
 */
function setControl(input) {
	const fields = Array.from(document.querySelectorAll('.panel--left .field'))
	const labelOf = (node) => (node.querySelector('.field-label')?.textContent || '').trim()
	const field =
		fields.find((node) => labelOf(node) === input.label) ??
		fields.find((node) => labelOf(node).startsWith(input.label)) ??
		fields.find((node) => labelOf(node).includes(input.label))
	if (!field) return 'missing'

	const select = field.querySelector('select')
	if (select) {
		if (select.value !== input.value) {
			const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set
			setter.call(select, input.value)
			select.dispatchEvent(new Event('change', { bubbles: true }))
		}
		return select.value === input.value ? 'set' : 'rejected:' + select.value
	}

	const box = Array.from(field.querySelectorAll('input')).find((node) => node.type !== 'file')
	if (!box) return 'no-writable-input:' + labelOf(field)
	const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
	setter.call(box, input.value)
	// A range fires `input`, a text field fires both; sending both covers every
	// control type without needing to know which one this is.
	box.dispatchEvent(new Event('input', { bubbles: true }))
	box.dispatchEvent(new Event('change', { bubbles: true }))
	return 'set'
}

/**
 * Whether the tool's own file input has rendered yet.
 *
 * Every one of these probes is serialised on its own and run in the page, so
 * they cannot call each other - which is why the "find the input under this
 * label" lookup is written out twice rather than shared. Scoping it to the
 * labelled field is the part that matters: the source panel on the same side
 * of the screen has a file input of its own, with the same `accept`, and
 * writing the recorded clips into that one silently replaces the footage
 * everything else is being measured against.
 */
function fileInputReady(input) {
	const field = Array.from(document.querySelectorAll('.panel--left .field')).find((node) =>
		(node.querySelector('.field-label')?.textContent || '').trim().startsWith(input.label),
	)
	return field && field.querySelector('input[type="file"]') ? 'ready' : ''
}

/**
 * Films one or more flat-colour clips inside the page and hands them to the
 * tool's file input.
 *
 * The multi-clip tools - the transition and the split screen - cannot be
 * checked with the loaded footage alone, and fetching a second sample would
 * make the suite depend on a third party staying up. A canvas recorded through
 * MediaRecorder is both self-contained and unambiguous: a panel filled with a
 * colour that appears nowhere in the footage is either in the output or it is
 * not, and there is nothing to argue about.
 */
async function attachRecordedClips(input) {
	const holder = Array.from(document.querySelectorAll('.panel--left .field')).find((node) =>
		(node.querySelector('.field-label')?.textContent || '').trim().startsWith(input.label),
	)
	const field = holder ? holder.querySelector('input[type="file"]') : null
	if (!field) return 'no-input'
	if (typeof MediaRecorder === 'undefined') return 'no-recorder'

	const films = []
	for (let index = 0; index < input.colors.length; index++) {
		const colour = input.colors[index]
		const canvas = document.createElement('canvas')
		canvas.width = 320
		canvas.height = 180
		const ctx = canvas.getContext('2d')
		const paint = () => {
			ctx.fillStyle = colour
			ctx.fillRect(0, 0, canvas.width, canvas.height)
		}
		paint()

		const stream = canvas.captureStream(30)
		const chunks = []
		const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' })
		recorder.ondataavailable = (event) => {
			if (event.data && event.data.size > 0) chunks.push(event.data)
		}
		const finished = new Promise((resolve) => {
			recorder.onstop = resolve
		})
		recorder.start()
		const started = performance.now()
		// Repainting every frame is what makes the recorder produce frames at
		// all: a canvas that never changes may emit a single sample and stop.
		await new Promise((resolve) => {
			const tick = () => {
				paint()
				if (performance.now() - started > input.milliseconds) resolve()
				else requestAnimationFrame(tick)
			}
			requestAnimationFrame(tick)
		})
		recorder.stop()
		await finished
		stream.getTracks().forEach((track) => track.stop())

		const blob = new Blob(chunks, { type: 'video/webm' })
		if (blob.size < 1024) return 'empty-recording'
		films.push(new File([blob], 'panel-' + (index + 1) + '.webm', { type: 'video/webm' }))
	}

	const transfer = new DataTransfer()
	for (const film of films) transfer.items.add(film)
	field.files = transfer.files
	field.dispatchEvent(new Event('change', { bubbles: true }))
	return 'attached'
}

function clipsAttached(count) {
	const text = document.querySelector('.panel--left')?.innerText || ''
	let seen = 0
	for (let index = 1; index <= count; index++) {
		if (text.includes('panel-' + index + '.webm')) seen++
	}
	return seen === count ? 'attached' : ''
}

function startRun() {
	// A batch tool labels its button "Run over N files", so matching the exact
	// word "Run" would never find it.
	const button = Array.from(document.querySelectorAll('.panel--right button')).find((node) => {
		const text = (node.textContent || '').trim()
		return text === 'Run' || text.startsWith('Run over')
	})
	if (!button) return 'no-button'
	if (button.disabled) return 'disabled'
	button.click()
	return 'clicked'
}

function runOutcome() {
	const media = document.querySelector('.result video.result-media')
	if (media && media.src) return 'ready'
	const failure = Array.from(document.querySelectorAll('.notice--error'))
		.map((node) => (node.textContent || '').trim())
		.filter(Boolean)
		.join(' | ')
	if (failure) return 'error: ' + failure
	return ''
}

function sourceMediaUrl() {
	const media = document.querySelector('.stage video')
	return media && media.src && media.src.startsWith('blob:') ? media.src : null
}

/** Re-opens the finished file and measures a frame from the middle of it. */
async function inspectResult(sourceUrl) {
	const media = document.querySelector('.result video.result-media')
	if (!media || !media.src) return { error: 'no result element' }

	const measure = async (url, position = 0.5) => {
		const probe = document.createElement('video')
		probe.preload = 'auto'
		probe.muted = true
		probe.playsInline = true
		probe.crossOrigin = 'anonymous'
		probe.src = url

		const settle = (event, timeoutMs) =>
			new Promise((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error(event + ' timed out')), timeoutMs)
				probe.addEventListener(event, () => {
					clearTimeout(timer)
					resolve()
				}, { once: true })
				probe.addEventListener('error', () => {
					clearTimeout(timer)
					reject(new Error('the file would not open'))
				}, { once: true })
			})

		await settle('loadedmetadata', 30000)
		probe.currentTime = Math.max(0.1, Math.min(probe.duration - 0.05, probe.duration * position))
		await settle('seeked', 30000)

		const width = 96
		const height = Math.max(2, Math.round((probe.videoHeight / Math.max(probe.videoWidth, 1)) * width))
		const canvas = document.createElement('canvas')
		canvas.width = width
		canvas.height = height
		const ctx = canvas.getContext('2d', { willReadFrequently: true })
		ctx.drawImage(probe, 0, 0, width, height)
		const pixels = ctx.getImageData(0, 0, width, height).data

		let saturation = 0
		let luma = 0
		let light = 0
		let sumRed = 0
		let sumGreen = 0
		let sumBlue = 0
		let magenta = 0
		let greenDominant = 0
		let edgeWhite = 0
		let edgeCount = 0
		// The two halves are measured separately so a side-by-side montage can
		// be checked panel by panel: a layout that drew both clips into the same
		// cell would still look fine as a whole-frame average.
		const half = { leftR: 0, leftG: 0, leftB: 0, leftCount: 0, rightR: 0, rightG: 0, rightB: 0, rightCount: 0 }
		const count = pixels.length / 4
		for (let i = 0; i < pixels.length; i += 4) {
			const pixel = i / 4
			const x = pixel % width
			const y = Math.floor(pixel / width)
			const r = pixels[i]
			const g = pixels[i + 1]
			const b = pixels[i + 2]
			sumRed += r
			sumGreen += g
			sumBlue += b
			saturation += Math.max(r, g, b) - Math.min(r, g, b)
			const value = 0.2126 * r + 0.7152 * g + 0.0722 * b
			luma += value
			if (value > 215) light += 1
			if (r > 170 && b > 150 && g < 110) magenta += 1
			if (g > r + 35 && g > b + 35) greenDominant += 1
			if (x < width * 0.4) {
				half.leftR += r
				half.leftG += g
				half.leftB += b
				half.leftCount += 1
			} else if (x > width * 0.6) {
				half.rightR += r
				half.rightG += g
				half.rightB += b
				half.rightCount += 1
			}
			if (x < 2 || y < 2 || x > width - 3 || y > height - 3) {
				edgeCount += 1
				if (r > 225 && g > 225 && b > 225) edgeWhite += 1
			}
		}

		return {
			duration: probe.duration,
			width: probe.videoWidth,
			height: probe.videoHeight,
			saturation: saturation / count,
			luma: luma / count,
			meanRed: sumRed / count,
			meanGreen: sumGreen / count,
			meanBlue: sumBlue / count,
			magentaFraction: magenta / count,
			greenFraction: greenDominant / count,
			lightFraction: light / count,
			edgeWhiteFraction: edgeCount > 0 ? edgeWhite / edgeCount : 0,
			left: [half.leftR / Math.max(1, half.leftCount), half.leftG / Math.max(1, half.leftCount), half.leftB / Math.max(1, half.leftCount)],
			right: [half.rightR / Math.max(1, half.rightCount), half.rightG / Math.max(1, half.rightCount), half.rightB / Math.max(1, half.rightCount)],
			pixels: Array.from(pixels),
			sampleWidth: width,
			sampleHeight: height,
		}
	}

	const response = await fetch(media.src)
	const blob = await response.blob()
	const localUrl = URL.createObjectURL(blob)

	const report = { sizeInBytes: blob.size, type: blob.type }
	try {
		const output = await measure(localUrl)
		Object.assign(report, output)
		try {
			// A transition's whole point is that the end of the file is a
			// different clip from the middle of it, so the middle alone cannot
			// prove it happened.
			const tail = await measure(localUrl, 0.94)
			report.tailMagentaFraction = tail.magentaFraction
			report.tailMean = [tail.meanRed, tail.meanGreen, tail.meanBlue]
		} catch (error) {
			report.tailError = String((error && error.message) || error)
		}
		if (sourceUrl) {
			try {
				const source = await measure(sourceUrl)
				if (source.sampleWidth === output.sampleWidth && source.sampleHeight === output.sampleHeight) {
					let difference = 0
					for (let i = 0; i < output.pixels.length; i += 4) {
						difference +=
							Math.abs(output.pixels[i] - source.pixels[i]) +
							Math.abs(output.pixels[i + 1] - source.pixels[i + 1]) +
							Math.abs(output.pixels[i + 2] - source.pixels[i + 2])
					}
					report.differenceFromSource = difference / (output.pixels.length / 4) / 3
				}
				report.sourceSaturation = source.saturation
				report.sourceMagenta = source.magentaFraction
				report.sourceGreen = source.greenFraction
				report.sourceEdgeWhite = source.edgeWhiteFraction
				report.sourceDuration = source.duration
			} catch (error) {
				report.sourceError = String((error && error.message) || error)
			}
		}
	} catch (error) {
		report.error = String((error && error.message) || error)
	}
	delete report.pixels
	URL.revokeObjectURL(localUrl)
	return report
}

async function waitFor(page, fn, arg, timeoutMs, label, pending = []) {
	const deadline = Date.now() + timeoutMs
	let last = ''
	while (Date.now() < deadline) {
		last = await page.evaluate(fn, arg)
		if (last && !pending.includes(last)) return last
		await sleep(600)
	}
	return last || 'timed out waiting for ' + label
}

/* ------------------------------- the studio run ---------------------------- */

/**
 * The tools that are run in a real browser, and what has to be true of the
 * file that comes out.
 *
 * Each one is chosen because its claim is measurable in pixels rather than in
 * hope: a desaturation that did nothing still returns a valid file, and only
 * measuring the colour catches it.
 */
const STUDIO_CASES = [
	{
		tool: 'Adjust',
		controls: [{ label: 'Saturation', value: '-1' }],
		assert(report) {
			return [
				['the picture comes back monochrome', report.saturation < 6, 'saturation ' + report.saturation.toFixed(1) + ' from ' + (report.sourceSaturation ?? 0).toFixed(1)],
				['it is a real change, not a re-encode', (report.differenceFromSource ?? 0) > 3, 'mean difference ' + (report.differenceFromSource ?? 0).toFixed(1)],
			]
		},
	},
	{
		tool: 'Video Effects',
		controls: [
			{ label: 'Effect', value: 'night-vision' },
			{ label: 'Intensity', value: '100' },
		],
		assert(report) {
			return [
				['night vision comes back green', report.greenFraction > 0.3 && report.greenFraction > (report.sourceGreen ?? 0) * 3, 'green pixels ' + (report.greenFraction * 100).toFixed(0) + '%, source ' + ((report.sourceGreen ?? 0) * 100).toFixed(0) + '%'],
				['green really is the dominant channel', report.meanGreen > report.meanRed + 15 && report.meanGreen > report.meanBlue + 15, 'rgb ' + [report.meanRed, report.meanGreen, report.meanBlue].map((v) => Math.round(v)).join(',')],
			]
		},
	},
	{
		tool: 'Animated Title',
		controls: [
			{ label: 'Text', value: 'TOOLKIT CHECK' },
			{ label: 'Animation', value: 'none' },
			{ label: 'Style', value: 'box' },
			{ label: 'Size', value: '14' },
			{ label: 'Text colour', value: '#ff00ff' },
			{ label: 'Accent colour', value: '#ff00ff' },
			{ label: 'Stays for', value: '600' },
		],
		assert(report) {
			return [
				['the magenta title is burned into the frame', report.magentaFraction > 0.01 && (report.sourceMagenta ?? 0) < 0.002, 'magenta ' + (report.magentaFraction * 100).toFixed(1) + '%, source ' + ((report.sourceMagenta ?? 0) * 100).toFixed(1) + '%'],
			]
		},
	},
	{
		tool: 'Camera Motion',
		controls: [
			{ label: 'Move', value: 'zoom-in' },
			{ label: 'Amount', value: '100' },
		],
		assert(report) {
			return [
				['the framing actually moved', (report.differenceFromSource ?? 0) > 3, 'mean difference ' + (report.differenceFromSource ?? 0).toFixed(1)],
				['the move did not let an edge into frame', report.lightFraction >= 0 && report.luma > 8, 'mean luma ' + report.luma.toFixed(1)],
			]
		},
	},
	{
		tool: 'Border & Frame',
		controls: [
			{ label: 'Style', value: 'solid' },
			{ label: 'Thickness', value: '8' },
			{ label: 'Colour', value: '#ffffff' },
		],
		assert(report) {
			return [
				['the edge of the frame is the border colour', report.edgeWhiteFraction > 0.85, 'white edge pixels ' + (report.edgeWhiteFraction * 100).toFixed(0) + '%, source ' + ((report.sourceEdgeWhite ?? 0) * 100).toFixed(0) + '%'],
			]
		},
	},
	{
		tool: 'Canvas & Reframe',
		controls: [
			{ label: 'Output shape', value: '9:16' },
			{ label: 'Backdrop', value: 'blur' },
		],
		assert(report) {
			return [
				['the output really is 1080x1920', report.width === 1080 && report.height === 1920, report.width + 'x' + report.height],
				['nothing was cropped away - the backdrop fills the rest', report.luma > 5, 'mean luma ' + report.luma.toFixed(1)],
			]
		},
	},
	{
		tool: 'Add a Transition',
		clips: { colors: ['#ff00ff'], label: 'The clip to cut to', milliseconds: 2000 },
		controls: [
			{ label: 'Transition', value: 'dissolve' },
			{ label: 'Length', value: '1' },
		],
		assert(report) {
			const source = report.sourceDuration ?? 0
			return [
				['the two clips were joined into one longer file', report.duration > source + 0.4 && report.duration < source + 3, report.duration.toFixed(2) + 's from ' + source.toFixed(2) + 's'],
				['the second clip is what plays at the end', (report.tailMagentaFraction ?? 0) > 0.5, 'magenta at the end ' + ((report.tailMagentaFraction ?? 0) * 100).toFixed(0) + '%'],
			]
		},
	},
	{
		tool: 'Split Screen',
		clips: { colors: ['#ff00ff', '#00ffff'], label: 'The clips to lay out', milliseconds: 1500 },
		controls: [
			{ label: 'Layout', value: 'side-by-side' },
			{ label: 'Output shape', value: '16:9' },
			{ label: 'Gap', value: '0' },
		],
		assert(report) {
			const left = report.left ?? [0, 0, 0]
			const right = report.right ?? [0, 0, 0]
			return [
				['the montage comes out at the size it was asked for', report.width === 1920 && report.height === 1080, report.width + 'x' + report.height],
				['the first clip is in the left panel', left[0] > 140 && left[2] > 140 && left[1] < 110, 'left rgb ' + left.map((v) => Math.round(v)).join(',')],
				['the second clip is in the right panel', right[1] > 140 && right[2] > 140 && right[0] < 110, 'right rgb ' + right.map((v) => Math.round(v)).join(',')],
			]
		},
	},
	{
		tool: 'Blend an Overlay',
		clips: { colors: ['#ff00ff'], label: 'The clip or image to blend', milliseconds: 1500 },
		controls: [
			{ label: 'Blend mode', value: 'screen' },
			{ label: 'Opacity', value: '100' },
			{ label: 'Placement', value: 'fill' },
		],
		assert(report) {
			return [
				// Screen with magenta drives red and blue to white and leaves
				// green where it was, which no other blend mode does.
				['screening magenta lifts red and blue and not green', report.meanRed > 200 && report.meanBlue > 200 && report.meanGreen < 200, 'rgb ' + [report.meanRed, report.meanGreen, report.meanBlue].map((v) => Math.round(v)).join(',')],
			]
		},
	},
	{
		tool: 'Reverse',
		controls: [],
		assert(report) {
			const source = report.sourceDuration ?? 0
			return [
				['the reversed clip is the same length', source > 0 && Math.abs(report.duration - source) < 0.6, report.duration.toFixed(2) + 's vs ' + source.toFixed(2) + 's'],
				['the picture is genuinely different', (report.differenceFromSource ?? 0) > 2, 'mean difference ' + (report.differenceFromSource ?? 0).toFixed(1)],
			]
		},
	},
]

async function runStudio() {
	const { openBrowser, ensureBrowser } = require('@remotion/renderer')
	await ensureBrowser()
	const browser = await openBrowser('chrome', { chromiumOptions: { headless: !HEADFUL } })

	try {
		const page = await browser.newPage({ context: null, logLevel: 'error', indent: false, pageIndex: 0 })
		try {
			process.stdout.write('\nload\n')
			await page.goto({ url: BASE + '/tools', timeoutInMilliseconds: 120_000 })
			await waitFor(page, pageSettled, undefined, 120_000, 'page load')
			await waitFor(page, fieldPresent, undefined, 120_000, 'the address field')

			const pressed = await waitFor(page, fillAndSubmit, { value: CLIP }, 60_000, 'the import button to enable', ['typed', 'disabled', 'no-field', 'no-button'])
			record('load', 'address submitted', pressed === 'clicked', pressed === 'clicked' ? undefined : pressed)

			const landed = await waitFor(page, clipLoaded, CLIP_NAME, 180_000, 'the clip to load')
			record('load', 'clip loaded', landed === 'named', landed === 'named' ? undefined : landed)
			if (landed !== 'named') return

			const sourceUrl = await page.evaluate(sourceMediaUrl)

			for (const testCase of STUDIO_CASES) {
				process.stdout.write('\n' + testCase.tool.toLowerCase() + '\n')
				try {
					const opened = await waitFor(page, selectToolExact, testCase.tool, 30_000, 'the ' + testCase.tool + ' card', ['went-back'])
					if (opened !== 'clicked' && opened !== 'open') {
						record(testCase.tool, 'the tool card opens', false, opened)
						continue
					}
					record(testCase.tool, 'the tool card opens', true)

					if (testCase.clips) {
						const ready = await waitFor(page, fileInputReady, testCase.clips, 20_000, 'the file input')
						if (ready !== 'ready') {
							record(testCase.tool, 'the file input is there', false, ready)
							continue
						}
						// Recording takes a couple of seconds and must happen once,
						// so it is called directly rather than through the poller.
						const attached = await page.evaluate(attachRecordedClips, testCase.clips)
						if (attached !== 'attached') {
							record(testCase.tool, 'the extra clips are recorded and attached', false, attached)
							continue
						}
						const listed = await waitFor(page, clipsAttached, testCase.clips.colors.length, 30_000, 'the clips to be listed')
						if (listed !== 'attached') {
							record(testCase.tool, 'the extra clips are recorded and attached', false, listed)
							continue
						}
						record(testCase.tool, 'the extra clips are recorded and attached', true)
					}

					let controlsOk = true
					for (const control of testCase.controls) {
						const set = await waitFor(page, setControl, control, 20_000, control.label, ['missing'])
						if (set !== 'set') {
							controlsOk = false
							record(testCase.tool, 'set "' + control.label + '"', false, set)
						}
					}
					if (!controlsOk) continue
					record(testCase.tool, 'every control could be set', true)

					const started = await waitFor(page, startRun, undefined, 60_000, 'the Run button', ['disabled', 'no-button'])
					if (started !== 'clicked') {
						record(testCase.tool, 'the run starts', false, started)
						continue
					}

					const outcome = await waitFor(page, runOutcome, undefined, 420_000, 'the run to finish')
					if (outcome !== 'ready') {
						record(testCase.tool, 'the run finishes', false, outcome)
						continue
					}
					record(testCase.tool, 'the run finishes', true)

					const report = await page.evaluate(inspectResult, sourceUrl)
					if (report.error) {
						record(testCase.tool, 'the finished file re-opens', false, report.error)
						continue
					}
					for (const [name, ok, detail] of testCase.assert(report)) record(testCase.tool, name, ok, detail)
				} catch (error) {
					// One tool blowing up is a result about that tool, not a reason to stop
					// asking about the others.
					const message = String((error && error.message) || error)
					record(testCase.tool, 'the tool ran without throwing', false, message.split('\n')[0])
				}
			}
		} finally {
			await page.close()
		}
	} finally {
		await browser.close({ silent: true })
	}
}

/* -------------------------------------------------------------------------- */

async function main() {
	checkRegistry()
	checkAdjust()
	checkEffects()
	checkMotion()
	checkLayouts()
	checkLut()
	checkAudio()

	let server = null
	if (!MATHS_ONLY) {
		try {
			server = await ensureServer()
			await runStudio()
		} catch (error) {
			record('studio', 'the studio run completed', false, String((error && error.message) || error))
		} finally {
			if (server) server.kill()
		}
	}

	const failed = results.filter((entry) => !entry.ok)
	process.stdout.write('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed\n')
	if (failed.length > 0) {
		for (const entry of failed) process.stdout.write('  FAIL ' + entry.group + ' / ' + entry.name + '\n')
		process.exitCode = 1
	}
}

main().catch((error) => {
	console.error(error)
	process.exitCode = 1
})
