/**
 * AI MASTER TEMPLATE - a complete, single-file Remotion handoff.
 *
 * HOW THE USER USES THIS FILE
 * 1. Download this file from Remotion Video Studio.
 * 2. Attach it to an AI coding assistant together with your video idea.
 * 3. Tell the AI your topic, audience, goal, platform, duration, visual style,
 *    exact wording, call to action, assets, and anything to include or avoid.
 * 4. Ask the AI to follow the contract below and return ONE complete .tsx file.
 * 5. Upload the returned file to Remotion Video Studio, preview it, and render.
 *
 * COPY-PASTE PROMPT FOR THE USER
 * "Follow the AI EDITING CONTRACT in the attached file. Build a [duration]
 * [platform/aspect ratio] video about [topic] for [audience]. The goal is
 * [goal]. Use a [tone/style] visual direction. Include [must-haves], avoid
 * [things to avoid], and end with [CTA]. Return one complete runnable .tsx
 * file, not a diff or explanation."
 *
 * --------------------------------------------------------------------------
 * AI EDITING CONTRACT - AI MUST READ BEFORE CHANGING THIS FILE
 * --------------------------------------------------------------------------
 * [AI: EDIT] Treat the user's prompt as the source of truth. Infer tasteful
 * defaults when details are missing instead of stopping at placeholders.
 *
 * [AI: EDIT] Rewrite the WHOLE creative execution for the requested subject:
 * concept, script, scene order, visuals, colors, typography, animation, camera,
 * lighting, materials, sound, and timing. Do not only replace the demo text or
 * preserve this look by default. Preserve wording the user marks as exact.
 *
 * [AI: EDIT] Replace BRIEF, THEME, TIMELINE, and every scene component below.
 * You may add/remove scene components, SVG, charts, diagrams, or CSS artwork.
 * Make the visual language specific to the user's interest and instructions.
 * Use the embedded VISUAL KIT as a reliable starting vocabulary, then extend
 * its React Three Fiber meshes, inline SVG paths, or procedural shapes when the
 * subject needs something more specific. Never settle for text floating on an
 * empty background.

 * [AI: EDIT] VISUAL TRUTH IS A HARD REQUIREMENT. Before writing scenes, extract
 * every important concrete noun, action, relationship, comparison, and claim
 * from the user's request and final script into VISUAL_PROOF_PLAN. Each phrase
 * must have a recognizable focal object plus an action or state that proves the
 * words on the same frames. A label, emoji, generic cube, badge, particles, or
 * decorative icon does not count as proof. If the user says "sun", show an
 * unmistakable dimensional sun with a sphere, corona/rays, emitted light, and
 * environmental response. If the user says "tree", show a dimensional tree
 * with trunk, branches, layered canopy, depth, lighting, and ground shadow. If
 * they say the sun warms the tree, visibly cast light from sun to tree and make
 * the leaves respond. Verbs must happen; numbers need honest charts or visible
 * quantities; comparisons need simultaneously legible before/after states.
 * With every text layer hidden, a viewer must still identify the subject and
 * understand the main story. Never keep a demo visual that fails this test.
 *
 * [AI: KEEP] Return one self-contained TSX file with no TODOs, pseudocode,
 * missing pieces, diffs, or explanatory prose. Keep every helper in this file.
 *
 * [AI: KEEP] Imports supported by this studio are: react, remotion,
 * @remotion/player, @remotion/shapes, @remotion/paths, @remotion/noise,
 * @remotion/motion-blur, @remotion/transitions and its bundled transitions,
 * @remotion/media, @remotion/media-utils, @remotion/gif, @remotion/fonts,
 * @remotion/three, @react-three/fiber, and three. Do not invent npm packages.
 * Do not use Tailwind or framer-motion.

 * [AI: KEEP] Real 3D must live inside <ThreeCanvas width={width}
 * height={height} gl={{antialias: true, preserveDrawingBuffer: true}}> with
 * ambient plus directional/point lighting. preserveDrawingBuffer is required:
 * without it browser exports capture an empty canvas. Animate every
 * mesh, camera, material, and light from useCurrentFrame(); never use useFrame()
 * or self-running shaders. Prefer procedural meshes so the one-file handoff has
 * no missing model. If genuine 3D does not improve the story, use the lighter
 * SVG/DOM depth kit. Keep a graceful, subject-faithful 2D fallback rather than
 * replacing a missing object with generic geometry.
 *
 * [AI: KEEP] Prefer DOM, CSS, and inline SVG. This studio ships a built-in pack
 * that stays available after this file is re-uploaded here:
 *   /assets/visual/v1/   editable SVG icons, arrows, objects, geometry
 *   /assets/texture/v1/  grain, paper, halftone, scanlines, vignette, light
 *                        leaks, glow/bokeh/spark/smoke sprites, matcaps, and
 *                        equirectangular environment maps (see TEXTURE_KIT)
 *   /assets/fonts/v1/    10 self-hosted OFL families (see FONT_KIT)
 *   /assets/audio/v1/    8 music beds and 20 sound effects (see SOUND_LIBRARY)
 * A single file does not carry any other public/ folder, so do not invent local
 * asset paths. Use a remote asset only when the user supplied a reliable URL.
 * Never load a font from Google Fonts or any other URL at render time.
 *
 * [AI: EDIT] TYPOGRAPHY IS HALF THE DESIGN. Pick two or three families from
 * FONT_KIT that match the subject (Anton or Bebas Neue for loud hooks, Playfair
 * Display for luxury and editorial, Space Grotesk for tech, Nunito for friendly
 * education, Caveat for handwritten annotation, JetBrains Mono for data and
 * code) and register them with registerStudioFont() at module scope. Anton and
 * Bebas Neue are single-weight: request weight 400, never a synthetic bold.
 * Pair one display face with one text face; never set body copy in a display
 * face; keep the mono face for labels, numbers and code only.
 *
 * [AI: EDIT] Use TEXTURE_KIT to escape the flat-render look, but keep it
 * restrained: one grain plate (6-14% opacity, soft-light) and one vignette over
 * the whole film, light leaks only when the story is warm or nostalgic, and
 * sprites (glow, bokeh, spark, smoke) only where a light or particle belongs.
 * In 3D, <SceneEnvironment> gives real image-based lighting from one PNG and
 * meshMatcapMaterial with a matcap texture gives chrome, clay, pearl or glass
 * without an HDRI. Set envMapIntensity={0} on emissive light sources.
 *
 * [AI: KEEP] All animation must be deterministic and frame-driven with
 * useCurrentFrame(), interpolate(), spring(), and deterministic math. Never use
 * CSS keyframes/transitions, Date.now(), or Math.random().
 * Use CSS linear gradients or inline SVG for radial/conic artwork and masks so
 * audio-enabled browser exports match the preview in every supported browser.
 * Draw every bitmap with <Img> from remotion. The browser exporter rasterises
 * images, SVG and linear gradients, but ignores `background-image: url(...)`,
 * so a texture set that way disappears from the exported file. Give every
 * inline <svg> explicit width and height attributes as well as CSS sizing: the
 * exporter serialises the tag, and one with no intrinsic size is rasterised at
 * the wrong scale, which shifts that whole layer in the export.
 *
 * [AI: KEEP] Build a bespoke art direction from the brief: one dominant focal
 * point per scene; coherent palette, typography, lighting, and materials;
 * intentional negative space; foreground/midground/background separation; and
 * motivated camera movement. Arrows, neon, particles, glass, and decorative
 * geometry are optional tools, not a checklist. Remove them when the requested
 * subject calls for natural, editorial, minimal, historical, playful, or other
 * aesthetics. Never repeat the demo arrangement when a subject-specific shot
 * tells the story better.
 * Never use graph paper, blueprint lines, dot grids, Cartesian grids, tiled
 * line patterns, or receding perspective grids as a background. CSS Grid is
 * allowed strictly as an invisible layout mechanism, and real chart axes may
 * remain when the data requires them.
 * Every video also needs intentional sound unless the user explicitly asks for
 * silence. Choose one music bed for the subject and separate the remaining cues
 * into SOUNDS (small UI/story actions) and SFX (transitions, impacts, risers,
 * reveals, and the closing stinger). Every cue frame must match the visual event
 * that motivates it. Import Audio only from @remotion/media, use the built-in
 * SOUND_LIBRARY paths, and keep music under speech.
 *
 * [AI: KEEP] Make scene durations add up exactly to Composition
 * durationInFrames and derive the total from TIMELINE_END instead of copying a
 * second magic number. Rebuild the layout for the requested aspect ratio; do
 * not merely change Composition width/height. Keep important text at least 80px
 * from the sides in a 1080px-wide composition and scale that safe area with
 * width. Use a main headline of roughly 84px or larger at 1080px. Limit lines,
 * fit long copy deliberately, and keep all key content inside title/action-safe
 * bounds for the target platform.
 * Do not add a persistent title/header rail or visible scene numbering such as
 * 01, 02, 03, or 04. Let each scene open directly with its actual content.
 *
 * [AI: KEEP] Preserve a hook-free Root, an explicit <Composition>,
 * registerRoot(Root), and the default export. Update width, height, fps,
 * durationInFrames, and defaultProps to match the user's requested format.
 *
 * FINAL AI CHECK BEFORE RETURNING THE FILE
 * - One complete TSX file; no unsupported imports or missing local files.
 * - The first frames hook attention; every scene has one clear focal point.
 * - Every VISUAL_PROOF_PLAN phrase has its literal object and visible action.
 * - The story remains identifiable and understandable with all text hidden.
 * - 3D has real lights/materials/depth, keeps preserveDrawingBuffer, and
 *   decorative effects remain restrained.
 * - Music, sounds, and SFX are balanced and share exact frames with their visuals.
 * - Type is loaded from FONT_KIT, weights are real, and no font is fetched remotely.
 * - Grain/vignette/leaks stay subtle; textures serve the story, not the demo.
 * - No background uses a line grid, dot grid, graph-paper or floor-grid motif.
 * - All copy fits, all animations use frames, and 9:16/16:9/1:1 layouts are
 *   redesigned rather than stretched when the user requests those formats.
 * - Complexity is bounded: semantic subjects survive before particles/glow are
 *   reduced, and 4K/2x rendering does not depend on hundreds of blurred layers.
 * - The final frame resolves cleanly and the Composition metadata is correct.
 *
 * EDIT MAP
 * 0. KITS        -> FONT_KIT, TEXTURE_KIT, SOUND_LIBRARY (what you can use)
 * 1. BRIEF       -> concept, audience, message, story, CTA
 * 2. THEME       -> colors, fonts, surfaces, visual personality
 * 3. PROOF PLAN  -> map every important saying to literal objects and actions
 * 4. TIMELINE    -> scene starts and durations in frames (30 frames = 1 second)
 * 5. SOUND       -> choose music, sounds, and SFX; share frames with visuals
 * 6. SCENES      -> replace the actual layout and motion for the user's topic
 * 7. COMPOSITION -> set final size, fps, duration, and default props
 */

import React from 'react'
import {
	AbsoluteFill,
	Composition,
	continueRender,
	delayRender,
	Easing,
	Img,
	interpolate,
	registerRoot,
	Sequence,
	spring,
	staticFile,
	useCurrentFrame,
	useVideoConfig,
} from 'remotion'
import { Audio } from '@remotion/media'
import { loadFont } from '@remotion/fonts'
import { ThreeCanvas } from '@remotion/three'
import { useThree } from '@react-three/fiber'
import {
	AdditiveBlending,
	DoubleSide,
	EquirectangularReflectionMapping,
	SRGBColorSpace,
	TextureLoader,
	type Texture,
} from 'three'

/* -------------------------------------------------------------------------- */
/*  TYPOGRAPHY KIT [AI: KEEP THE LOADER; CHOOSE FAMILIES FOR THE SUBJECT]     */
/* -------------------------------------------------------------------------- */

const fontAsset = (relativePath: string) => staticFile(`assets/fonts/v1/${relativePath}`)

/**
 * Self-hosted SIL Open Font License families. Nothing is fetched from the
 * network at render time, so a server or CI render gets the same type as the
 * preview instead of silently falling back to Arial.
 *
 * [AI: EDIT] Load ONLY the two or three families the design needs - each one
 * costs a font download and parse in every render.
 */
export const FONT_KIT = {
	inter: { family: 'Inter', file: 'inter/Inter[opsz,wght].ttf', weight: '100 900', use: 'neutral UI and body copy' },
	archivo: { family: 'Archivo', file: 'archivo/Archivo[wdth,wght].ttf', weight: '100 900', use: 'editorial headlines with a width axis' },
	anton: { family: 'Anton', file: 'anton/Anton-Regular.ttf', weight: '400', use: 'loud poster headlines and social hooks' },
	bebasNeue: { family: 'Bebas Neue', file: 'bebas-neue/BebasNeue-Regular.ttf', weight: '400', use: 'condensed title cards and lower thirds' },
	oswald: { family: 'Oswald', file: 'oswald/Oswald[wght].ttf', weight: '200 700', use: 'news, sport and documentary overlays' },
	playfairDisplay: { family: 'Playfair Display', file: 'playfair-display/PlayfairDisplay[wght].ttf', weight: '400 900', use: 'luxury, fashion, food and editorial serif' },
	spaceGrotesk: { family: 'Space Grotesk', file: 'space-grotesk/SpaceGrotesk[wght].ttf', weight: '300 700', use: 'technical, AI and product launches' },
	jetBrainsMono: { family: 'JetBrains Mono', file: 'jetbrains-mono/JetBrainsMono[wght].ttf', weight: '100 800', use: 'code, labels, data and timestamps' },
	nunito: { family: 'Nunito', file: 'nunito/Nunito[wght].ttf', weight: '200 1000', use: 'friendly education, kids and health' },
	caveat: { family: 'Caveat', file: 'caveat/Caveat[wght].ttf', weight: '400 700', use: 'handwritten annotation and personal notes' },
} as const

/**
 * Registers a family and returns a ready-to-use CSS font-family stack.
 * loadFont() holds the render open until the face is parsed, so text never
 * renders in a fallback face on the first frames.
 */
const registerStudioFont = (id: keyof typeof FONT_KIT, fallback: string): string => {
	const entry = FONT_KIT[id]
	loadFont({ family: entry.family, url: fontAsset(entry.file), weight: entry.weight })
	return `'${entry.family}', ${fallback}`
}

const DISPLAY_FONT = registerStudioFont('anton', 'Impact, Haettenschweiler, sans-serif')
const TEXT_FONT = registerStudioFont('inter', 'Arial, Helvetica, sans-serif')
const MONO_FONT = registerStudioFont('jetBrainsMono', 'ui-monospace, Consolas, monospace')

/* -------------------------------------------------------------------------- */
/*  TEXTURE KIT [AI: KEEP; USE SPARINGLY AND ON PURPOSE]                      */
/* -------------------------------------------------------------------------- */

const textureAsset = (relativePath: string) => staticFile(`assets/texture/v1/${relativePath}`)

/**
 * Original CC0 raster assets. Overlays and sprites are DOM layers; matcaps and
 * environments feed three.js materials.
 */
export const TEXTURE_KIT = {
	filmGrain: textureAsset('overlays/film-grain.png'),
	grainFine: textureAsset('overlays/grain-fine.png'),
	noiseSoft: textureAsset('overlays/noise-soft.png'),
	paperFiber: textureAsset('overlays/paper-fiber.png'),
	halftone: textureAsset('overlays/halftone-dots.png'),
	scanlines: textureAsset('overlays/scanlines.png'),
	vignette: textureAsset('overlays/vignette.png'),
	lightLeakWarm: textureAsset('overlays/light-leak-warm.png'),
	lightLeakCool: textureAsset('overlays/light-leak-cool.png'),
	glow: textureAsset('sprites/glow-radial.png'),
	bokeh: textureAsset('sprites/bokeh-circle.png'),
	sparkStar: textureAsset('sprites/spark-star.png'),
	smokePuff: textureAsset('sprites/smoke-puff.png'),
	matcapChrome: textureAsset('matcaps/chrome.png'),
	matcapClay: textureAsset('matcaps/clay.png'),
	matcapPearl: textureAsset('matcaps/pearl.png'),
	matcapEmerald: textureAsset('matcaps/emerald.png'),
	envStudio: textureAsset('environments/studio.png'),
	envSunset: textureAsset('environments/sunset.png'),
	envNightCity: textureAsset('environments/night-city.png'),
} as const

/* -------------------------------------------------------------------------- */
/*  1. NORMALIZED USER BRIEF [AI: EDIT ALL CONTENT]                           */
/* -------------------------------------------------------------------------- */

export const BRIEF = {
	topic: 'Sunlight turns a seed into a living tree',
	audience: 'Curious people who love nature and visual science',
	goal: 'Make photosynthesis feel immediate, beautiful, and memorable',
	hook: 'ONE RAY.\nA LIVING WORLD.',
	subhead: 'Light arrives. A leaf catches it. Life builds upward.',
	storyPoints: [
		{
			title: 'ABSORB',
			body: 'Leaves capture sunlight across a layered green canopy.',
		},
		{
			title: 'BUILD',
			body: 'Light energy becomes the sugars that shape wood, roots, and new leaves.',
		},
		{
			title: 'GROW',
			body: 'A seed rises into a tree that stores carbon and shelters a living world.',
		},
	],
	proof: 'SUNLIGHT → ENERGY → LIFE',
	cta: 'LET THE LIGHT IN.',
	ctaDetail: 'Protect the systems that turn one ray into a living world.',
	mustInclude: ['Dimensional sun', 'Growing 3D tree', 'Visible light-to-life relationship'],
	avoid: ['Generic nature icons', 'Unmotivated neon', 'Text-only explanation'],
}

/** Shared by the proof plan, scenes, soundtrack, and Composition metadata. */
const STORY_CLOCK = {
	hook: { from: 0, duration: 105 },
	brief: { from: 105, duration: 120 },
	story: { from: 225, duration: 120 },
	cta: { from: 345, duration: 105 },
} as const

/* -------------------------------------------------------------------------- */
/*  2. VISUAL PROOF PLAN [AI: REWRITE BEFORE BUILDING ANY SCENE]              */
/* -------------------------------------------------------------------------- */

type SubjectId = 'sun' | 'tree'

type VisualProofBeat = {
	id: string
	saying: string
	from: number
	durationInFrames: number
	mustShow: readonly SubjectId[]
	focalObject: SubjectId
	visibleAction: string
	camera: 'push-in' | 'orbit' | 'tracking' | 'locked'
}

export const VISUAL_PROOF_PLAN: readonly VisualProofBeat[] = [
	{
		id: 'light-arrives',
		saying: 'One ray begins a living world',
		from: STORY_CLOCK.hook.from,
		durationInFrames: STORY_CLOCK.hook.duration,
		mustShow: ['sun', 'tree'],
		focalObject: 'sun',
		visibleAction: 'The sun rises, emits warm light, and reveals a young tree in depth',
		camera: 'push-in',
	},
	{
		id: 'leaf-captures-light',
		saying: 'Leaves capture sunlight and turn it into stored energy',
		from: STORY_CLOCK.brief.from,
		durationInFrames: STORY_CLOCK.brief.duration,
		mustShow: ['sun', 'tree'],
		focalObject: 'tree',
		visibleAction: 'Warm light travels from the sun to a leaf-rich canopy before energy pulses downward',
		camera: 'locked',
	},
	{
		id: 'light-becomes-growth',
		saying: 'Sunlight helps the tree grow',
		from: STORY_CLOCK.story.from,
		durationInFrames: STORY_CLOCK.story.duration,
		mustShow: ['sun', 'tree'],
		focalObject: 'tree',
		visibleAction: 'Light reaches the canopy while trunk, branches, and leaves visibly grow',
		camera: 'orbit',
	},
	{
		id: 'living-world-resolves',
		saying: 'Protect the systems that turn one ray into a living world',
		from: STORY_CLOCK.cta.from,
		durationInFrames: STORY_CLOCK.cta.duration,
		mustShow: ['sun', 'tree'],
		focalObject: 'tree',
		visibleAction: 'The mature tree fills the frame while the sun creates a resolved warm rim light',
		camera: 'push-in',
	},
] as const

export const CREATIVE_MANIFEST = {
	schemaVersion: 1,
	literalSubjects: ['sun', 'tree'] as const,
	beats: VISUAL_PROOF_PLAN,
}

/* -------------------------------------------------------------------------- */
/*  3. VISUAL THEME [AI: EDIT OR REPLACE]                                     */
/* -------------------------------------------------------------------------- */

const THEME = {
	background: '#061710',
	surface: '#10251C',
	ink: '#F7F3E7',
	muted: '#B8C9B7',
	accent: '#FFB84D',
	accent2: '#66D47F',
	warm: '#FFE08A',
	line: 'rgba(255,245,220,0.12)',
	fontDisplay: DISPLAY_FONT,
	fontSans: TEXT_FONT,
	fontMono: MONO_FONT,
}

/* -------------------------------------------------------------------------- */
/*  3. TIMELINE [AI: EDIT STORY_CLOCK; COMPOSITION DURATION IS DERIVED]       */
/* -------------------------------------------------------------------------- */

const TIMELINE = STORY_CLOCK

const TIMELINE_END = TIMELINE.cta.from + TIMELINE.cta.duration

/** One source of truth for visible beats that also receive a sound cue. */
const VISUAL_BEATS = {
	hook: { headlineImpact: 0, tagReveal: 54 },
	brief: { rowStarts: [0, 9, 18], iconStarts: [4, 13, 22] },
	story: { cardStarts: [12, 22, 32] },
	cta: { brandReveal: 60 },
} as const

/* -------------------------------------------------------------------------- */
/*  4. SOUND DESIGN [AI: MATCH THE VIDEO, THEN RETIME WITH THE VISUALS]        */
/* -------------------------------------------------------------------------- */

const audioAsset = (relativePath: string) => staticFile(`assets/audio/v1/${relativePath}`)

/**
 * [AI: EDIT] Pick one music bed from the subject, not from the template's current
 * look. All beds are loopable and mixed to sit under narration:
 * - technology, products, fast motion            -> neonPulse (120 BPM)
 * - education, friendly stories, explainers      -> warmInspiration (96 BPM)
 * - cinematic, space, premium, slow builds       -> cinematicOrbit (80 BPM)
 * - nature, meditation, documentary, narration   -> ambientCalm (70 BPM, no drums)
 * - trailers, sport, launches, heroic payoffs    -> epicCinematic (88 BPM)
 * - vlogs, study, casual and relaxed stories     -> lofiChill (84 BPM)
 * - SaaS, business, optimistic explainers        -> corporateClean (112 BPM)
 * - problems, suspense, before/after setups      -> tensionDrone (72 BPM)
 * Keep UI/diegetic actions in `sounds`; keep editorial accents in `sfx`.
 */
export const SOUND_LIBRARY = {
	music: {
		neonPulse: audioAsset('music/neon-pulse-120bpm-loop.wav'),
		warmInspiration: audioAsset('music/warm-inspiration-96bpm-loop.wav'),
		cinematicOrbit: audioAsset('music/cinematic-orbit-80bpm-loop.wav'),
		ambientCalm: audioAsset('music/ambient-calm-70bpm-loop.wav'),
		epicCinematic: audioAsset('music/epic-cinematic-88bpm-loop.wav'),
		lofiChill: audioAsset('music/lofi-chill-84bpm-loop.wav'),
		corporateClean: audioAsset('music/corporate-clean-112bpm-loop.wav'),
		tensionDrone: audioAsset('music/tension-drone-72bpm-loop.wav'),
	},
	sounds: {
		click: audioAsset('sfx/ui/click-soft.wav'),
		pop: audioAsset('sfx/ui/pop-clean.wav'),
		notification: audioAsset('sfx/ui/notification-bright.wav'),
		typewriter: audioAsset('sfx/ui/typewriter.wav'),
		tick: audioAsset('sfx/ui/tick.wav'),
		swipe: audioAsset('sfx/ui/swipe.wav'),
	},
	sfx: {
		whooshFast: audioAsset('sfx/transitions/whoosh-fast.wav'),
		whooshDeep: audioAsset('sfx/transitions/whoosh-deep.wav'),
		riser: audioAsset('sfx/transitions/riser-digital.wav'),
		riserOrganic: audioAsset('sfx/transitions/riser-organic.wav'),
		glitch: audioAsset('sfx/transitions/glitch.wav'),
		subDrop: audioAsset('sfx/transitions/sub-drop.wav'),
		impactClean: audioAsset('sfx/impacts/impact-clean.wav'),
		impactDeep: audioAsset('sfx/impacts/impact-deep.wav'),
		impactSnap: audioAsset('sfx/impacts/impact-snap.wav'),
		boomTail: audioAsset('sfx/impacts/impact-boom-tail.wav'),
		shimmer: audioAsset('sfx/accents/reveal-shimmer.wav'),
		chimeSparkle: audioAsset('sfx/accents/chime-sparkle.wav'),
		powerUp: audioAsset('sfx/accents/power-up.wav'),
		stinger: audioAsset('sfx/accents/logo-stinger.wav'),
	},
} as const

type TimedAudioCue = {
	id: string
	src: string
	from: number
	durationInFrames: number
	volume: number
}

const VIDEO_END_FRAME = TIMELINE_END - 1

/**
 * [AI: EDIT] This demo is a warm educational nature story, so Warm Inspiration fits.
 * Cue frames below reuse the scene and animation timing above: clicks land on
 * brief-row icons, pops land on story cards, whooshes straddle scene cuts, and
 * the riser ends exactly when the CTA begins. Retiming a visual means retiming
 * its matching cue here in the same edit.
 */
export const SOUND_DESIGN: {
	music: {
		src: string
		volume: number
		fadeInFrames: number
		fadeOutFrames: number
	}
	sounds: TimedAudioCue[]
	sfx: TimedAudioCue[]
} = {
	music: {
		src: SOUND_LIBRARY.music.warmInspiration,
		volume: 0.13,
		fadeInFrames: 24,
		fadeOutFrames: 34,
	},
	sounds: [
		{
			id: 'topic icon',
			src: SOUND_LIBRARY.sounds.click,
			from: TIMELINE.brief.from + VISUAL_BEATS.brief.iconStarts[0],
			durationInFrames: 3,
			volume: 0.16,
		},
		{
			id: 'audience icon',
			src: SOUND_LIBRARY.sounds.click,
			from: TIMELINE.brief.from + VISUAL_BEATS.brief.iconStarts[1],
			durationInFrames: 3,
			volume: 0.16,
		},
		{
			id: 'goal icon',
			src: SOUND_LIBRARY.sounds.click,
			from: TIMELINE.brief.from + VISUAL_BEATS.brief.iconStarts[2],
			durationInFrames: 3,
			volume: 0.16,
		},
		{
			id: 'describe card',
			src: SOUND_LIBRARY.sounds.pop,
			from: TIMELINE.story.from + VISUAL_BEATS.story.cardStarts[0],
			durationInFrames: 6,
			volume: 0.17,
		},
		{
			id: 'generate card',
			src: SOUND_LIBRARY.sounds.pop,
			from: TIMELINE.story.from + VISUAL_BEATS.story.cardStarts[1],
			durationInFrames: 6,
			volume: 0.17,
		},
		{
			id: 'render card',
			src: SOUND_LIBRARY.sounds.pop,
			from: TIMELINE.story.from + VISUAL_BEATS.story.cardStarts[2],
			durationInFrames: 6,
			volume: 0.17,
		},
	],
	sfx: [
		{
			id: 'hook impact',
			src: SOUND_LIBRARY.sfx.impactClean,
			from: TIMELINE.hook.from + VISUAL_BEATS.hook.headlineImpact,
			durationInFrames: 12,
			volume: 0.32,
		},
		{
			id: 'hook shimmer',
			src: SOUND_LIBRARY.sfx.shimmer,
			from: TIMELINE.hook.from + VISUAL_BEATS.hook.tagReveal,
			durationInFrames: 30,
			volume: 0.2,
		},
		{
			id: 'brief transition',
			src: SOUND_LIBRARY.sfx.whooshFast,
			from: TIMELINE.brief.from - 6,
			durationInFrames: 12,
			volume: 0.23,
		},
		{
			id: 'story transition',
			src: SOUND_LIBRARY.sfx.whooshFast,
			from: TIMELINE.story.from - 6,
			durationInFrames: 12,
			volume: 0.23,
		},
		{
			id: 'CTA riser',
			src: SOUND_LIBRARY.sfx.riser,
			from: TIMELINE.cta.from - 45,
			durationInFrames: 45,
			volume: 0.18,
		},
		{
			id: 'CTA impact',
			src: SOUND_LIBRARY.sfx.impactClean,
			from: TIMELINE.cta.from,
			durationInFrames: 12,
			volume: 0.28,
		},
		{
			id: 'closing stinger',
			src: SOUND_LIBRARY.sfx.stinger,
			from: TIMELINE.cta.from + VISUAL_BEATS.cta.brandReveal,
			durationInFrames: 36,
			volume: 0.22,
		},
	],
}

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const
const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1)

/* -------------------------------------------------------------------------- */
/*  5. ANIMATION HELPERS [AI: KEEP FRAME-DRIVEN]                              */
/* -------------------------------------------------------------------------- */

const sceneEnvelope = (frame: number, duration: number) =>
	interpolate(frame, [0, 12, duration - 14, duration - 1], [0, 1, 1, 0], {
		...CLAMP,
		easing: EASE_OUT,
	})

const SceneFrame: React.FC<{
	duration: number
	startVisible?: boolean
	children: React.ReactNode
}> = ({ duration, startVisible = false, children }) => {
	const frame = useCurrentFrame()

	return (
		<AbsoluteFill
			style={{
				opacity: startVisible
					? interpolate(frame, [duration - 14, duration - 1], [1, 0], CLAMP)
					: sceneEnvelope(frame, duration),
				padding: '250px 84px 230px',
				fontFamily: THEME.fontSans,
				color: THEME.ink,
			}}
		>
			{children}
		</AbsoluteFill>
	)
}

/* -------------------------------------------------------------------------- */
/*  PROCEDURAL VISUAL KIT [AI: KEEP; USE, RECOLOR, AND EXTEND PURPOSEFULLY]   */
/* -------------------------------------------------------------------------- */

type Point = readonly [number, number]

type IconName =
	| 'spark'
	| 'play'
	| 'bolt'
	| 'target'
	| 'chart'
	| 'layers'
	| 'cube'
	| 'code'
	| 'cursor'
	| 'check'
	| 'rocket'
	| 'sound'
	| 'orbit'
	| 'idea'

/** Original, dependency-free 24px glyphs. Add a subject-specific path when needed. */
const ICON_PATHS: Record<IconName, readonly string[]> = {
	spark: [
		'M12 2.5L14.3 9.3L21 12L14.3 14.6L12 21.5L9.6 14.6L3 12L9.6 9.3Z',
		'M18.5 3.5V7',
		'M16.75 5.25H20.25',
	],
	play: ['M8 5.5L19 12L8 18.5Z'],
	bolt: ['M13.6 2.5L5.5 13H11L9.8 21.5L18.5 10.2H13Z'],
	target: ['M12 3A9 9 0 1 0 21 12A9 9 0 0 0 12 3Z', 'M12 7A5 5 0 1 0 17 12A5 5 0 0 0 12 7Z', 'M12 10.3A1.7 1.7 0 1 0 13.7 12A1.7 1.7 0 0 0 12 10.3Z'],
	chart: ['M4 19V11', 'M10 19V5', 'M16 19V9', 'M3 19H21', 'M4 8L9 3L14 7L20 2'],
	layers: ['M12 3L21 8L12 13L3 8Z', 'M4.5 12L12 16.2L19.5 12', 'M4.5 16L12 20.2L19.5 16'],
	cube: ['M12 3L20 7.5L12 12L4 7.5Z', 'M4 7.5V16.5L12 21V12', 'M20 7.5V16.5L12 21'],
	code: ['M9 7L4 12L9 17', 'M15 7L20 12L15 17', 'M13.5 4L10.5 20'],
	cursor: ['M5 3L18.5 13L12.2 14.5L9 20.5Z', 'M12.2 14.5L17 20'],
	check: ['M12 3A9 9 0 1 0 21 12A9 9 0 0 0 12 3Z', 'M7.5 12.2L10.5 15.2L16.8 8.8'],
	rocket: ['M8.2 15.8C6.2 15.5 4.8 16.2 3.5 18.5C5.8 19.1 7.5 18.5 8.8 16.8', 'M9 15L6 12L7.8 8.5L12 7C14.7 4.3 17.5 3.2 21 3C20.8 6.5 19.7 9.3 17 12L15.5 16.2L12 18L9 15Z', 'M14.8 8.2A1.8 1.8 0 1 0 18.4 8.2A1.8 1.8 0 0 0 14.8 8.2Z'],
	sound: ['M4 10H8L13 6V18L8 14H4Z', 'M16 9C17.6 10.5 17.6 13.5 16 15', 'M18.8 6.5C22 9.5 22 14.5 18.8 17.5'],
	orbit: ['M5 14.5C2.4 12.8 3.8 9.5 7.8 7.2C11.8 4.9 17.2 4.5 19.6 6.5C22 8.5 19.9 12 16 14.3C12.1 16.6 7.4 17.2 5 14.5Z', 'M12 10.2A1.8 1.8 0 1 0 13.8 12A1.8 1.8 0 0 0 12 10.2Z', 'M4.5 17.5L6.8 15.2'],
	idea: ['M8.5 15.5C6.8 14.3 6 12.6 6 10.5A6 6 0 0 1 18 10.5C18 12.6 17.2 14.3 15.5 15.5L14.5 17H9.5Z', 'M9.5 20H14.5', 'M12 1.5V4', 'M3.5 5L5.4 6.6', 'M20.5 5L18.6 6.6'],
}

const VectorIcon: React.FC<{
	name: IconName
	size?: number
	color?: string
	strokeWidth?: number
	glow?: boolean
}> = ({ name, size = 48, color = THEME.ink, strokeWidth = 1.8, glow = false }) => (
	<svg
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
		aria-hidden
		style={{
			display: 'block',
			overflow: 'visible',
			filter: glow ? `drop-shadow(0 0 ${Math.max(8, size * 0.24)}px ${color})` : undefined,
		}}
	>
		{ICON_PATHS[name].map((path, index) => (
			<path
				key={`${name}-${index}`}
				d={path}
				stroke={color}
				strokeWidth={strokeWidth}
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		))}
	</svg>
)

const IconBadge: React.FC<{
	name: IconName
	color: string
	size?: number
	delay?: number
}> = ({ name, color, size = 76, delay = 0 }) => {
	const frame = useCurrentFrame()
	const enter = interpolate(frame, [delay, delay + 18], [0, 1], {
		...CLAMP,
		easing: EASE_OUT,
	})
	const float = Math.sin((frame - delay) * 0.075) * 4
	const pulse = 0.72 + Math.sin((frame - delay) * 0.11) * 0.16

	return (
		<div
			style={{
				width: size,
				height: size,
				borderRadius: size * 0.28,
				border: `1px solid ${color}88`,
				background: `linear-gradient(145deg, ${color}38, rgba(10,12,24,0.94) 72%)`,
				boxShadow: `0 18px 36px rgba(0,0,0,0.34), 0 0 ${24 * pulse}px ${color}66`,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				opacity: enter,
				scale: interpolate(enter, [0, 1], [0.72, 1]),
				translate: `0 ${interpolate(enter, [0, 1], [24, 0]) + float}px`,
			}}
		>
			<VectorIcon name={name} size={size * 0.47} color={color} glow />
		</div>
	)
}

const FlowArrow: React.FC<{
	from: Point
	to: Point
	color: string
	bend?: number
	startFrame?: number
	drawFrames?: number
	strokeWidth?: number
}> = ({ from, to, color, bend = 0, startFrame = 0, drawFrames = 24, strokeWidth = 5 }) => {
	const frame = useCurrentFrame()
	const { width, height } = useVideoConfig()
	const draw = interpolate(frame, [startFrame, startFrame + drawFrames], [0, 1], {
		...CLAMP,
		easing: EASE_OUT,
	})
	const dx = to[0] - from[0]
	const dy = to[1] - from[1]
	const length = Math.max(1, Math.sqrt(dx * dx + dy * dy))
	const control: Point = [
		(from[0] + to[0]) / 2 - (dy / length) * bend,
		(from[1] + to[1]) / 2 + (dx / length) * bend,
	]
	const path = `M ${from[0]} ${from[1]} Q ${control[0]} ${control[1]} ${to[0]} ${to[1]}`
	const angle = (Math.atan2(to[1] - control[1], to[0] - control[0]) * 180) / Math.PI
	const headScale = interpolate(draw, [0.72, 1], [0, 1], CLAMP)
	const dotX = (1 - draw) * (1 - draw) * from[0] + 2 * (1 - draw) * draw * control[0] + draw * draw * to[0]
	const dotY = (1 - draw) * (1 - draw) * from[1] + 2 * (1 - draw) * draw * control[1] + draw * draw * to[1]

	return (
		<svg
			width="100%"
			height="100%"
			viewBox={`0 0 ${width} ${height}`}
			preserveAspectRatio="none"
			aria-hidden
			style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
		>
			<path
				d={path}
				fill="none"
				stroke={color}
				strokeOpacity={0.16}
				strokeWidth={strokeWidth + 7}
				strokeLinecap="round"
			/>
			<path
				d={path}
				fill="none"
				stroke={color}
				strokeWidth={strokeWidth}
				strokeLinecap="round"
				pathLength={1}
				strokeDasharray={1}
				strokeDashoffset={1 - draw}
				style={{ filter: `drop-shadow(0 0 10px ${color})` }}
			/>
			<circle cx={dotX} cy={dotY} r={strokeWidth * 1.45} fill={color} opacity={draw < 0.99 ? 1 : 0} />
			<g
				transform={`translate(${to[0]} ${to[1]}) rotate(${angle}) scale(${headScale})`}
				style={{ filter: `drop-shadow(0 0 10px ${color})` }}
			>
				<path d="M0 0L-28 -14L-21 0L-28 14Z" fill={color} />
			</g>
		</svg>
	)
}

const HEX_COLOR = /^#([0-9a-f]{6})$/i

const mixHex = (hex: string, target: number, amount: number) => {
	const match = HEX_COLOR.exec(hex)
	if (!match) return hex
	const value = parseInt(match[1], 16)
	const channel = (shift: number) => {
		const current = (value >> shift) & 0xff
		return Math.round(current + (target - current) * amount)
	}
	const mixed = (channel(16) << 16) | (channel(8) << 8) | channel(0)
	return `#${mixed.toString(16).padStart(6, '0')}`
}

type ShapeKind = 'circle' | 'ring' | 'diamond' | 'hex' | 'triangle' | 'star'
type SolidShapeKind = Exclude<ShapeKind, 'ring'>

const SHAPE_CLIP: Record<SolidShapeKind, string> = {
	circle: 'circle(50% at 50% 50%)',
	diamond: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
	hex: 'polygon(25% 6%, 75% 6%, 100% 50%, 75% 94%, 25% 94%, 0% 50%)',
	triangle: 'polygon(50% 2%, 98% 94%, 2% 94%)',
	star: 'polygon(50% 0%, 61% 34%, 98% 35%, 68% 56%, 79% 92%, 50% 71%, 21% 92%, 32% 56%, 2% 35%, 39% 34%)',
}

const GeoShape: React.FC<{
	kind: ShapeKind
	x: number
	y: number
	size: number
	color: string
	delay?: number
	opacity?: number
	spin?: number
}> = ({ kind, x, y, size, color, delay = 0, opacity = 0.3, spin = 0.18 }) => {
	const frame = useCurrentFrame()
	const enter = interpolate(frame, [delay, delay + 20], [0, 1], {
		...CLAMP,
		easing: EASE_OUT,
	})
	const rotation = frame * spin + Math.sin((frame + delay) * 0.025) * 6
	const common: React.CSSProperties = {
		position: 'absolute',
		left: x - size / 2,
		top: y - size / 2,
		width: size,
		height: size,
		opacity: opacity * enter,
		scale: interpolate(enter, [0, 1], [0.62, 1]),
		rotate: `${rotation}deg`,
	}

	if (kind === 'ring') {
		return (
			<div
				style={{
					...common,
					borderRadius: '50%',
					border: `2px solid ${color}`,
					boxShadow: `0 0 24px ${color}55`,
				}}
			/>
		)
	}

	return (
		<div
			style={{
				...common,
				clipPath: SHAPE_CLIP[kind],
				background: `linear-gradient(145deg, ${mixHex(color, 255, 0.28)}, ${color} 50%, ${mixHex(color, 0, 0.28)})`,
				boxShadow: `0 0 28px ${color}44`,
			}}
		/>
	)
}

const DepthShape: React.FC<{
	kind: SolidShapeKind
	x: number
	y: number
	size: number
	color: string
	delay?: number
	depth?: number
	layers?: number
	rotation?: number
}> = ({ kind, x, y, size, color, delay = 0, depth = 24, layers = 8, rotation = -8 }) => {
	const frame = useCurrentFrame()
	const enter = interpolate(frame, [delay, delay + 20], [0, 1], {
		...CLAMP,
		easing: EASE_OUT,
	})
	const bob = Math.sin((frame - delay) * 0.055) * 6
	const pulse = 0.76 + Math.sin((frame - delay) * 0.09) * 0.12

	return (
		<div
			style={{
				position: 'absolute',
				left: x - size / 2,
				top: y - size / 2,
				width: size,
				height: size,
				opacity: enter,
				scale: interpolate(enter, [0, 1], [0.56, 1]),
				translate: `0 ${interpolate(enter, [0, 1], [44, 0]) + bob}px`,
				rotate: `${rotation + Math.sin(frame * 0.025) * 3}deg`,
			}}
		>
			{Array.from({ length: layers }).map((_, index) => {
				const layerDepth = ((layers - index) / layers) * depth
				return (
					<div
						key={index}
						style={{
							position: 'absolute',
							inset: 0,
							translate: `${layerDepth}px ${layerDepth * 0.72}px`,
							clipPath: SHAPE_CLIP[kind],
							backgroundColor: mixHex(color, 0, 0.42 + (layerDepth / depth) * 0.2),
						}}
					/>
				)
			})}
			<div
				style={{
					position: 'absolute',
					inset: 0,
					clipPath: SHAPE_CLIP[kind],
					background: `linear-gradient(142deg, ${mixHex(color, 255, 0.42)} 0%, ${color} 48%, ${mixHex(color, 0, 0.34)} 100%)`,
					boxShadow: `0 28px 54px rgba(0,0,0,0.42), 0 0 ${30 * pulse}px ${color}88`,
				}}
			/>
			<div
				style={{
					position: 'absolute',
					left: '17%',
					top: '12%',
					width: '48%',
					height: '18%',
					borderRadius: 999,
					background: 'linear-gradient(90deg, rgba(255,255,255,0.46), rgba(255,255,255,0))',
					opacity: 0.72,
					rotate: '-18deg',
				}}
			/>
		</div>
	)
}

const NeonRing: React.FC<{
	x: number
	y: number
	size: number
	color: string
	delay?: number
}> = ({ x, y, size, color, delay = 0 }) => {
	const frame = useCurrentFrame()
	const enter = interpolate(frame, [delay, delay + 22], [0, 1], {
		...CLAMP,
		easing: EASE_OUT,
	})
	const angle = (frame - delay) * 0.025
	const radius = size / 2
	const pulse = 0.78 + Math.sin((frame - delay) * 0.08) * 0.14

	return (
		<div
			style={{
				position: 'absolute',
				left: x - radius,
				top: y - radius,
				width: size,
				height: size,
				borderRadius: '50%',
				border: `2px solid ${color}88`,
				boxShadow: `0 0 ${32 * pulse}px ${color}66`,
				opacity: enter,
				scale: interpolate(enter, [0, 1], [0.72, 1]),
			}}
		>
			<div
				style={{
					position: 'absolute',
					left: radius - 8 + Math.cos(angle) * radius,
					top: radius - 8 + Math.sin(angle) * radius,
					width: 16,
					height: 16,
					borderRadius: '50%',
					backgroundColor: color,
					boxShadow: `0 0 22px ${color}`,
				}}
			/>
		</div>
	)
}

const hashValue = (value: number) => {
	const hashed = Math.sin(value * 91.3458) * 47453.5453
	return hashed - Math.floor(hashed)
}

/* -------------------------------------------------------------------------- */
/*  REAL 3D SUBJECT KIT [AI: KEEP THE METHOD; REBUILD SUBJECTS FOR THE BRIEF] */
/* -------------------------------------------------------------------------- */

type Subject3DProps = {
	position?: readonly [number, number, number]
	scale?: number
	delay?: number
}

const SUN_RAYS = Array.from({ length: 20 }, (_, index) => index)
const SUN_SPOTS: ReadonlyArray<readonly [number, number, number, number]> = [
	[-0.34, 0.42, 0.91, 0.13],
	[0.45, 0.16, 0.89, 0.09],
	[-0.08, -0.48, 0.88, 0.1],
]
const TREE_BRANCHES: ReadonlyArray<readonly [number, number, number, number]> = [
	[-0.48, 2.2, 0, -0.76],
	[0.53, 2.42, -0.06, 0.72],
	[-0.36, 2.88, 0.18, -0.58],
	[0.34, 3.02, 0.12, 0.5],
]
const TREE_CANOPY: ReadonlyArray<readonly [number, number, number, number, string]> = [
	[-0.95, 3.02, 0.08, 0.98, '#2F8F5B'],
	[0.1, 3.45, -0.12, 1.22, '#42B86E'],
	[1.0, 2.98, 0.14, 0.92, '#277A50'],
	[-0.45, 4.15, -0.22, 0.9, '#66D47F'],
	[0.62, 4.08, 0.02, 0.84, '#38A960'],
	[-0.08, 2.7, 0.62, 0.82, '#226D4A'],
]
const LIGHT_PARTICLES = Array.from({ length: 7 }, (_, index) => index)

/** A literal sun: emissive sphere, corona, rays, sunspots, and emitted light. */
const ProceduralSun3D: React.FC<Subject3DProps> = ({
	position = [2.35, 2.35, -1.2],
	scale = 1,
	delay = 0,
}) => {
	const frame = useCurrentFrame()
	const { fps } = useVideoConfig()
	const enter = spring({
		frame: frame - delay,
		fps,
		config: { damping: 22, stiffness: 82, mass: 1.05 },
	})
	const rise = interpolate(enter, [0, 1], [-1.5, 0], CLAMP)
	const pulse = 1 + Math.sin((frame - delay) * 0.075) * 0.035
	const rayCount = SUN_RAYS.length

	return (
		<group
			position={[position[0], position[1] + rise, position[2]]}
			rotation={[0.08, frame * 0.0025, frame * 0.004]}
			scale={scale * interpolate(enter, [0, 1], [0.72, 1], CLAMP) * pulse}
		>
			<pointLight color="#FFD08A" intensity={4.6 * enter} distance={18} decay={1.7} />
			{SUN_RAYS.map((index) => {
				const angle = (index / rayCount) * Math.PI * 2
				const length = 0.62 + hashValue(index * 7.1) * 0.48
				return (
					<mesh
						key={index}
						position={[Math.cos(angle) * 1.48, Math.sin(angle) * 1.48, -0.18]}
						rotation={[0, 0, angle - Math.PI / 2]}
						scale={[1, length, 1]}
					>
						<boxGeometry args={[0.055, 0.72, 0.045]} />
						<meshBasicMaterial color={index % 2 === 0 ? '#FFD36A' : '#FF9F43'} transparent opacity={0.58} />
					</mesh>
				)
			})}
			<mesh rotation={[Math.PI / 2, 0, frame * -0.006]}>
				<torusGeometry args={[1.18, 0.075, 16, 80]} />
				<meshBasicMaterial color="#FFB44C" transparent opacity={0.32} />
			</mesh>
			<mesh castShadow>
				<sphereGeometry args={[1, 64, 64]} />
				<meshStandardMaterial
					color="#FFB23E"
					emissive="#FF7A1A"
					emissiveIntensity={1.35}
					// Fully rough and non-metallic: a sun has no specular highlight.
					roughness={1}
					metalness={0}
					// A light source does not reflect its surroundings: keep the
					// scene environment off this material or it reads as a planet.
					envMapIntensity={0}
				/>
			</mesh>
			{SUN_SPOTS.map(([x, y, z, spotScale], index) => (
				<mesh key={index} position={[x, y, z]} scale={spotScale * 0.8}>
					<sphereGeometry args={[1, 20, 20]} />
					{/* Faint granulation, not planet markings. */}
					<meshBasicMaterial color="#E8813A" transparent opacity={0.26} />
				</mesh>
			))}
		</group>
	)
}

/** A literal tree: rooted trunk, branching structure, layered canopy and wind. */
const ProceduralTree3D: React.FC<Subject3DProps & { maturity?: number }> = ({
	position = [-0.45, -2.2, 0.25],
	scale = 1,
	delay = 8,
	maturity = 1,
}) => {
	const frame = useCurrentFrame()
	const { fps } = useVideoConfig()
	const grown = spring({
		frame: frame - delay,
		fps,
		config: { damping: 24, stiffness: 64, mass: 1.15 },
	})
	const growth = Math.max(0.04, grown * maturity)
	const wind = Math.sin((frame - delay) * 0.045) * 0.035
	return (
		<group
			position={[position[0], position[1], position[2]]}
			rotation={[0, -0.24 + wind, wind * 0.48]}
			scale={[scale * growth, scale * growth, scale * growth]}
		>
			<mesh castShadow position={[0, 1.55, 0]}>
				<cylinderGeometry args={[0.26, 0.52, 3.1, 14]} />
				<meshStandardMaterial color="#7A4327" roughness={0.82} metalness={0.02} />
			</mesh>
			{TREE_BRANCHES.map(([x, y, z, rotation], index) => (
				<mesh key={index} castShadow position={[x, y, z]} rotation={[0, 0, rotation]}>
					<cylinderGeometry args={[0.09, 0.16, 1.55, 10]} />
					<meshStandardMaterial color={index % 2 === 0 ? '#704027' : '#875034'} roughness={0.86} />
				</mesh>
			))}
			<group rotation={[wind * 0.4, wind, wind]}>
				{TREE_CANOPY.map(([x, y, z, size, color], index) => (
					<mesh
						key={index}
						castShadow
						position={[x, y + Math.sin(frame * 0.035 + index) * 0.035, z]}
						scale={[size * 1.08, size, size * 0.9]}
						rotation={[index * 0.18, frame * 0.0018 * (index % 2 === 0 ? 1 : -1), index * 0.12]}
					>
						<icosahedronGeometry args={[1, 2]} />
						<meshStandardMaterial color={color} roughness={0.7} metalness={0.03} />
					</mesh>
				))}
			</group>
		</group>
	)
}

const SUBJECT_VISUALS = {
	sun: ProceduralSun3D,
	tree: ProceduralTree3D,
} satisfies Record<SubjectId, React.FC<Subject3DProps>>

for (const beat of VISUAL_PROOF_PLAN) {
	for (const subject of beat.mustShow) {
		if (!SUBJECT_VISUALS[subject]) {
			throw new Error(`VISUAL_PROOF_PLAN beat "${beat.id}" has no renderer for "${subject}".`)
		}
	}
}

/**
 * Loads a texture through delayRender, so a render never captures a frame
 * before the image is decoded. Cached per URL: repeated scenes reuse one upload.
 *
 * [AI: KEEP] This is the only correct way to bring an image into three.js here.
 * useLoader()/Suspense does not tell Remotion to wait, and useFrame() is banned.
 */
const textureCache = new Map<string, Texture>()

const useStudioTexture = (url: string, equirectangular = false): Texture | null => {
	const [texture, setTexture] = React.useState<Texture | null>(() => textureCache.get(url) ?? null)

	React.useEffect(() => {
		const cached = textureCache.get(url)
		if (cached) {
			setTexture(cached)
			return
		}
		const handle = delayRender(`Loading texture ${url}`)
		let cancelled = false
		new TextureLoader().load(
			url,
			(loaded) => {
				loaded.colorSpace = SRGBColorSpace
				if (equirectangular) loaded.mapping = EquirectangularReflectionMapping
				textureCache.set(url, loaded)
				if (!cancelled) setTexture(loaded)
				continueRender(handle)
			},
			undefined,
			() => continueRender(handle),
		)
		return () => {
			cancelled = true
		}
	}, [url, equirectangular])

	return texture
}

/** Image-based lighting: reflections and ambient colour come from one PNG. */
const SceneEnvironment: React.FC<{ url: string; background?: boolean }> = ({
	url,
	background = false,
}) => {
	const scene = useThree((state) => state.scene)
	const texture = useStudioTexture(url, true)

	React.useEffect(() => {
		if (!texture) return
		scene.environment = texture
		if (background) scene.background = texture
		return () => {
			scene.environment = null
			if (background) scene.background = null
		}
	}, [scene, texture, background])

	return null
}

/**
 * Scenes that fill the upper third with copy lift the sun above the headline so
 * the subject stays visible without competing with the text.
 */
const SUN_FRAMING = {
	hero: [1.22, 2.62, -1.1],
	aboveCopy: [1.68, 3.42, -1.1],
} as const

const NatureProofWorld3D: React.FC<{
	treeMaturity?: number
	cameraMove?: 'push-in' | 'orbit' | 'locked'
	soft?: boolean
	sunFraming?: keyof typeof SUN_FRAMING
}> = ({ treeMaturity = 1, cameraMove = 'push-in', soft = false, sunFraming = 'hero' }) => {
	const frame = useCurrentFrame()
	const { width, height, durationInFrames } = useVideoConfig()
	const sunPosition = SUN_FRAMING[sunFraming]
	const progress = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], CLAMP)
	const orbit = cameraMove === 'orbit' ? (progress - 0.5) * 0.86 : 0
	const push = cameraMove === 'push-in' ? progress * 0.65 : 0
	const lightTravel = interpolate(frame, [8, 48], [0, 1], CLAMP)

	return (
		<AbsoluteFill style={{ pointerEvents: 'none', opacity: soft ? 0.58 : 1 }}>
			<ThreeCanvas
				width={width}
				height={height}
				shadows="basic"
				dpr={2}
				gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
				camera={{
					fov: 37,
					near: 0.1,
					far: 80,
					position: [Math.sin(orbit) * 1.4, 0.8, 10.2 - push],
				}}
				style={{ position: 'absolute', inset: 0 }}
			>
				{/* Sunset image-based lighting: warm reflections the lights alone cannot give. */}
				<SceneEnvironment url={TEXTURE_KIT.envSunset} />
				<ambientLight color="#C6D8FF" intensity={0.7} />
				{/* Warm sky over a green ground bounce keeps shadows readable instead of black. */}
				<hemisphereLight color="#FFE6B0" groundColor="#2C5A46" intensity={0.85} />
				<directionalLight
					castShadow
					color="#FFF0C9"
					intensity={2.35}
					position={[4.8, 7.5, 5.5]}
					shadow-mapSize-width={2048}
					shadow-mapSize-height={2048}
				/>
				{/* Rim light from the sun side so the canopy separates from the sky. */}
				{/* Sits well clear of the sun mesh: it rims the canopy, not the disc. */}
				<pointLight
					color="#FFC978"
					intensity={22}
					distance={14}
					decay={2}
					position={[sunPosition[0] + 1.1, sunPosition[1] - 1.9, 1.4]}
				/>
				{/* Light shaft: starts under the sun and lands on the canopy. */}
				<mesh
					position={[sunPosition[0] - 0.8, sunPosition[1] - 0.96, -0.55]}
					rotation={[0, 0, 0.72]}
					scale={[1, Math.max(0.02, lightTravel), 1]}
				>
					<coneGeometry args={[0.68, 3.9, 32, 1, true]} />
					<meshBasicMaterial
						color="#FFCB6B"
						transparent
						opacity={0.085 * lightTravel}
						blending={AdditiveBlending}
						depthWrite={false}
						depthTest={false}
						side={DoubleSide}
					/>
				</mesh>
				{LIGHT_PARTICLES.map((index) => {
					const phase = (progress * 1.45 + index / 7) % 1
					return (
						<mesh
							key={index}
							position={[
								sunPosition[0] + 0.23 - 1.8 * phase,
								sunPosition[1] - 0.17 - 1.7 * phase,
								-0.82 + 0.72 * phase,
							]}
							scale={0.035 + (1 - phase) * 0.045}
						>
							<sphereGeometry args={[1, 12, 12]} />
							<meshBasicMaterial color="#FFF0B8" transparent opacity={0.25 + lightTravel * 0.65} />
						</mesh>
					)
				})}
				{/* Kept inside the vertical frame so the whole disc stays visible through the push-in. */}
				<ProceduralSun3D position={sunPosition} scale={0.74} delay={2} />
				<ProceduralTree3D position={[-0.25, -2.5, 0]} scale={0.83} maturity={treeMaturity} delay={10} />
				<mesh receiveShadow position={[0, -2.55, 0]} rotation={[-Math.PI / 2, 0, 0]}>
					<circleGeometry args={[7.5, 80]} />
					<meshStandardMaterial color="#15382D" roughness={0.96} metalness={0} />
				</mesh>
			</ThreeCanvas>
		</AbsoluteFill>
	)
}

const ParticleField: React.FC<{
	seed: number
	count?: number
	colorA: string
	colorB: string
}> = ({ seed, count = 28, colorA, colorB }) => {
	const frame = useCurrentFrame()
	const { width, height } = useVideoConfig()

	return (
		<AbsoluteFill style={{ overflow: 'hidden', pointerEvents: 'none' }}>
			{Array.from({ length: count }).map((_, index) => {
				const baseX = hashValue(seed * 11 + index * 3.17)
				const baseY = hashValue(seed * 17 + index * 7.31)
				const speed = 0.12 + hashValue(seed + index * 5.9) * 0.34
				const travel = (frame * speed + baseY * (height + 120)) % (height + 120)
				const size = 3 + hashValue(seed * 3 + index * 9.7) * 8
				const color = index % 3 === 0 ? colorB : colorA
				return (
					<div
						key={index}
						style={{
							position: 'absolute',
							left: baseX * width + Math.sin(frame * 0.012 + index) * 18,
							top: travel - 60,
							width: size,
							height: size,
							borderRadius: index % 2 === 0 ? '50%' : 2,
							backgroundColor: color,
							boxShadow: `0 0 ${size * 2}px ${color}`,
							opacity: 0.12 + hashValue(seed + index) * 0.25,
							rotate: `${frame * (index % 2 === 0 ? 0.3 : -0.22) + index * 19}deg`,
						}}
					/>
				)
			})}
		</AbsoluteFill>
	)
}

const VisualCluster: React.FC<{
	x: number
	y: number
	size: number
	color: string
	secondaryColor: string
	icon: IconName
	shape?: SolidShapeKind
	delay?: number
	satellites?: readonly [IconName, IconName]
}> = ({
	x,
	y,
	size,
	color,
	secondaryColor,
	icon,
	shape = 'hex',
	delay = 0,
	satellites = ['spark', 'orbit'],
}) => {
	const frame = useCurrentFrame()
	const enter = interpolate(frame, [delay + 8, delay + 28], [0, 1], {
		...CLAMP,
		easing: EASE_OUT,
	})

	return (
		<>
			<NeonRing x={x} y={y} size={size * 1.42} color={secondaryColor} delay={delay} />
			<GeoShape kind="diamond" x={x - size * 0.74} y={y + size * 0.38} size={size * 0.24} color={color} delay={delay + 8} opacity={0.44} spin={0.42} />
			<GeoShape kind="triangle" x={x + size * 0.72} y={y - size * 0.42} size={size * 0.22} color={secondaryColor} delay={delay + 12} opacity={0.5} spin={-0.34} />
			<DepthShape kind={shape} x={x} y={y} size={size} color={color} delay={delay + 3} depth={size * 0.09} />
			<div
				style={{
					position: 'absolute',
					left: x - size * 0.16,
					top: y - size * 0.16,
					width: size * 0.32,
					height: size * 0.32,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					opacity: enter,
					scale: interpolate(enter, [0, 1], [0.5, 1]),
					translate: `0 ${Math.sin((frame - delay) * 0.055) * 6}px`,
				}}
			>
				<VectorIcon name={icon} size={size * 0.29} color={THEME.ink} strokeWidth={1.55} glow />
			</div>
			<div style={{ position: 'absolute', left: x - size * 0.88, top: y - size * 0.72 }}>
				<IconBadge name={satellites[0]} color={secondaryColor} size={size * 0.25} delay={delay + 14} />
			</div>
			<div style={{ position: 'absolute', left: x + size * 0.62, top: y + size * 0.48 }}>
				<IconBadge name={satellites[1]} color={color} size={size * 0.22} delay={delay + 20} />
			</div>
		</>
	)
}

/* -------------------------------------------------------------------------- */
/*  SHARED VISUALS [AI: REPLACE TO MATCH THE USER'S SUBJECT]                 */
/* -------------------------------------------------------------------------- */

const Background: React.FC = () => {
	const frame = useCurrentFrame()
	const { durationInFrames, width, height } = useVideoConfig()
	const phase = (frame / Math.max(1, durationInFrames - 1)) * Math.PI * 2

	return (
		<AbsoluteFill style={{ backgroundColor: THEME.background, overflow: 'hidden' }}>
			{/* [AI: KEEP] Inline SVG needs explicit width/height attributes, not only
			    CSS: the browser exporter serialises the element, and one without
			    intrinsic size is rasterised at the wrong scale. */}
			<svg
				aria-hidden="true"
				width={width}
				height={height}
				viewBox={`0 0 ${width} ${height}`}
				preserveAspectRatio="none"
				style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
			>
				<defs>
					<radialGradient id="ai-master-accent-glow">
						<stop offset="0%" stopColor={THEME.accent} stopOpacity={0.32} />
						<stop offset="68%" stopColor={THEME.accent} stopOpacity={0} />
					</radialGradient>
					<radialGradient id="ai-master-secondary-glow">
						<stop offset="0%" stopColor={THEME.accent2} stopOpacity={0.2} />
						<stop offset="70%" stopColor={THEME.accent2} stopOpacity={0} />
					</radialGradient>
					<radialGradient id="ai-master-vignette" cx="50%" cy="45%" r="72%">
						<stop offset="35%" stopColor="#04050c" stopOpacity={0} />
						<stop offset="100%" stopColor="#04050c" stopOpacity={0.74} />
					</radialGradient>
				</defs>
				<circle
					cx={160 + Math.cos(phase) * 80}
					cy={530 + Math.sin(phase) * 100}
					r="400"
					fill="url(#ai-master-accent-glow)"
				/>
				<circle
					cx={1230 - Math.sin(phase) * 90}
					cy={1310 - Math.cos(phase) * 120}
					r="430"
					fill="url(#ai-master-secondary-glow)"
				/>
				<path
					d={`M ${-width * 0.08} ${height * (0.68 + Math.sin(phase) * 0.025)} C ${width * 0.2} ${height * 0.52}, ${width * 0.66} ${height * 0.84}, ${width * 1.08} ${height * 0.62}`}
					fill="none"
					stroke={THEME.line}
					strokeWidth={Math.max(2, width * 0.002)}
					opacity={0.42}
				/>
				<rect width={width} height={height} fill="url(#ai-master-vignette)" />
			</svg>
			<ParticleField seed={17} count={20} colorA={THEME.accent} colorB={THEME.accent2} />
		</AbsoluteFill>
	)
}

const ProgressRail: React.FC = () => {
	const frame = useCurrentFrame()
	const { durationInFrames, width } = useVideoConfig()
	const progress = interpolate(frame, [0, durationInFrames - 1], [0, 1], CLAMP)
	const railWidth = width - 168

	return (
		<div
			style={{
				position: 'absolute',
				left: 84,
				right: 84,
				bottom: 92,
				height: 4,
				borderRadius: 99,
				backgroundColor: THEME.line,
				overflow: 'hidden',
			}}
		>
			<GradientRule width={railWidth * progress} height={4} from={THEME.accent} to={THEME.accent2} />
		</div>
	)
}

const SafeAreaGuides: React.FC = () => (
	<div
		style={{
			position: 'absolute',
			left: 84,
			right: 84,
			top: 190,
			bottom: 190,
			border: `2px dashed ${THEME.warm}`,
			borderRadius: 28,
		pointerEvents: 'none',
			opacity: 0.7,
		}}
	>
		<div
			style={{
				position: 'absolute',
				left: 18,
				top: 14,
				fontFamily: THEME.fontMono,
				fontSize: 16,
				letterSpacing: 2,
				color: THEME.warm,
			}}
		>
			SAFE AREA - turn showGuides off before rendering
		</div>
	</div>
)

/* -------------------------------------------------------------------------- */
/*  SCENE 1: HOOK [AI: REPLACE WITH THE STRONGEST OPENING]                   */
/* -------------------------------------------------------------------------- */

const HookScene: React.FC = () => {
	const frame = useCurrentFrame()
	const { fps } = useVideoConfig()
	const entrance = spring({
		frame: frame + 8,
		fps,
		config: { damping: 18, stiffness: 95, mass: 0.9 },
	})

	return (
		<SceneFrame duration={TIMELINE.hook.duration} startVisible>
			<NatureProofWorld3D treeMaturity={0.46} cameraMove="push-in" />
			<div
				style={{
					marginTop: 170,
					// Anton is a single-weight display face: never ask it for a bold weight.
					fontFamily: THEME.fontDisplay,
					fontSize: 132,
					fontWeight: 400,
					lineHeight: 0.94,
					letterSpacing: -1,
					whiteSpace: 'pre-line',
					opacity: entrance,
					translate: `0 ${interpolate(entrance, [0, 1], [90, 0])}px`,
					scale: interpolate(entrance, [0, 1], [0.92, 1]),
				}}
			>
				{BRIEF.hook}
			</div>
			<div style={{ marginTop: 42 }}>
				<GradientRule
					width={interpolate(frame, [18, 52], [0, 720], { ...CLAMP, easing: EASE_OUT })}
					height={12}
					from={THEME.accent}
					to={THEME.accent2}
				/>
			</div>
			<div
				style={{
					marginTop: 54,
					maxWidth: 830,
					fontSize: 42,
					fontWeight: 520,
					lineHeight: 1.35,
					color: THEME.muted,
					opacity: interpolate(frame, [34, 58], [0, 1], CLAMP),
				}}
			>
				{BRIEF.subhead}
			</div>
			<div
				style={{
					position: 'absolute',
					left: 84,
					bottom: 270,
					display: 'flex',
					gap: 14,
					opacity: interpolate(
						frame,
						[VISUAL_BEATS.hook.tagReveal, VISUAL_BEATS.hook.tagReveal + 18],
						[0, 1],
						CLAMP,
					),
				}}
			>
				{['LIGHT', 'LEAF', 'ENERGY', 'GROWTH'].map((item, index) => (
					<div
						key={item}
						style={{
							padding: '14px 20px',
							borderRadius: 999,
							border: `1px solid ${index === 0 ? THEME.accent : THEME.line}`,
							backgroundColor: index === 0 ? `${THEME.accent}24` : THEME.surface,
							fontFamily: THEME.fontMono,
							fontSize: 17,
							fontWeight: 800,
							letterSpacing: 2,
							color: index === 0 ? THEME.ink : THEME.muted,
						}}
					>
						{item}
					</div>
				))}
			</div>
		</SceneFrame>
	)
}

/* -------------------------------------------------------------------------- */
/*  SCENE 2: BRIEF [AI: SHOW THE PROBLEM, AUDIENCE, OR CONTEXT]               */
/* -------------------------------------------------------------------------- */

const BriefScene: React.FC = () => {
	const frame = useCurrentFrame()
	const { fps } = useVideoConfig()
	const rows: Array<{ key: string; value: string; color: string; icon: IconName }> = [
		{ key: 'CAPTURE', value: 'Leaves turn toward the incoming light.', color: THEME.warm, icon: 'spark' },
		{ key: 'CONVERT', value: 'Light energy becomes stored chemical energy.', color: THEME.accent2, icon: 'bolt' },
		{ key: 'BUILD', value: 'That energy shapes roots, wood, and new canopy.', color: '#66D47F', icon: 'layers' },
	]

	return (
		<SceneFrame duration={TIMELINE.brief.duration}>
			<NatureProofWorld3D treeMaturity={0.64} cameraMove="locked" soft sunFraming="aboveCopy" />
			<div
				style={{
					marginTop: 80,
					fontSize: 94,
					fontWeight: 900,
					lineHeight: 1,
					letterSpacing: -4,
				}}
			>
				Light becomes
				<br />
				<span style={{ color: THEME.accent2 }}>building material.</span>
			</div>
			<FlowArrow
				from={[1012, 688]}
				to={[1012, 1045]}
				bend={-58}
				color={THEME.accent2}
				startFrame={22}
				drawFrames={44}
				strokeWidth={4}
			/>
			<div style={{ marginTop: 72, display: 'flex', flexDirection: 'column', gap: 22 }}>
				{rows.map((row, index) => {
					const enter = spring({
						frame: frame - VISUAL_BEATS.brief.rowStarts[index],
						fps,
						config: { damping: 18, stiffness: 105 },
					})
					return (
						<div
							key={row.key}
							style={{
								display: 'grid',
								gridTemplateColumns: '86px 1fr',
								alignItems: 'center',
								gap: 24,
								minHeight: 154,
								padding: '28px 30px',
								borderRadius: 28,
								border: `1px solid ${THEME.line}`,
								backgroundColor: 'rgba(18,21,39,0.82)',
								opacity: enter,
								translate: `${interpolate(enter, [0, 1], [70, 0])}px 0`,
							}}
						>
							<IconBadge
								name={row.icon}
								color={row.color}
								size={64}
								delay={VISUAL_BEATS.brief.iconStarts[index]}
							/>
							<div>
								<div
									style={{
										fontFamily: THEME.fontMono,
										fontSize: 16,
										fontWeight: 800,
										letterSpacing: 3,
										color: row.color,
										marginBottom: 9,
									}}
								>
									{row.key}
								</div>
								<div style={{ fontSize: 36, fontWeight: 750, lineHeight: 1.16 }}>{row.value}</div>
							</div>
						</div>
					)
				})}
			</div>
			<div
				style={{
					marginTop: 42,
					fontFamily: THEME.fontMono,
					fontSize: 22,
					lineHeight: 1.55,
					color: THEME.muted,
					opacity: interpolate(frame, [54, 78], [0, 1], CLAMP),
				}}
			>
				The visual relationship is literal: warm light reaches the leaves before growth appears.
			</div>
		</SceneFrame>
	)
}

/* -------------------------------------------------------------------------- */
/*  SCENE 3: STORY / PROOF [AI: BUILD TOPIC-SPECIFIC VISUAL EVIDENCE]         */
/* -------------------------------------------------------------------------- */

const StoryScene: React.FC = () => {
	const frame = useCurrentFrame()
	const { fps } = useVideoConfig()
	const storyIcons: IconName[] = ['cursor', 'spark', 'play']

	return (
		<SceneFrame duration={TIMELINE.story.duration}>
			<NatureProofWorld3D treeMaturity={1} cameraMove="orbit" soft sunFraming="aboveCopy" />
			<div
				style={{
					marginTop: 40,
					fontFamily: THEME.fontMono,
					fontSize: 24,
					fontWeight: 800,
					letterSpacing: 4,
					color: THEME.muted,
				}}
			>
				{BRIEF.proof}
			</div>
			<div
				style={{
					marginTop: 26,
					fontSize: 100,
					fontWeight: 940,
					lineHeight: 0.98,
					letterSpacing: -4,
				}}
			>
				Watch life
				<br />
				<span style={{ color: THEME.accent }}>build upward.</span>
			</div>
			<FlowArrow
				from={[62, 700]}
				to={[62, 1112]}
				bend={64}
				color={THEME.accent}
				startFrame={18}
				drawFrames={54}
				strokeWidth={4}
			/>
			<div style={{ marginTop: 68, display: 'flex', flexDirection: 'column', gap: 18 }}>
				{BRIEF.storyPoints.map((point, index) => {
					const enter = spring({
						frame: frame - VISUAL_BEATS.story.cardStarts[index],
						fps,
						config: { damping: 20, stiffness: 120 },
					})
					return (
						<div
							key={point.title}
							style={{
								display: 'grid',
								gridTemplateColumns: '72px 158px 1fr',
								alignItems: 'center',
								gap: 22,
								padding: '28px 30px',
								borderRadius: 26,
								border: `1px solid ${index === 1 ? `${THEME.accent}88` : THEME.line}`,
								backgroundColor: index === 1 ? `${THEME.accent}18` : THEME.surface,
								opacity: enter,
								translate: `0 ${interpolate(enter, [0, 1], [64, 0])}px`,
							}}
						>
							<IconBadge
								name={storyIcons[index] ?? 'spark'}
								color={index === 1 ? THEME.accent2 : THEME.accent}
								size={56}
								delay={VISUAL_BEATS.story.cardStarts[index]}
							/>
							<div
								style={{
									fontSize: 29,
									fontWeight: 900,
									letterSpacing: 1,
									color: index === 1 ? THEME.accent2 : THEME.ink,
								}}
							>
								{point.title}
							</div>
							<div style={{ fontSize: 25, lineHeight: 1.35, color: THEME.muted }}>{point.body}</div>
						</div>
					)
				})}
			</div>
			<div
				style={{
					position: 'absolute',
					left: 84,
					right: 84,
					bottom: 250,
					display: 'flex',
					justifyContent: 'space-between',
					fontFamily: THEME.fontMono,
					fontSize: 17,
					letterSpacing: 2,
					color: THEME.muted,
					opacity: interpolate(frame, [64, 84], [0, 1], CLAMP),
				}}
			>
				<span>LIGHT BECOMES MATTER</span>
				<span>ROOTS · WOOD · CANOPY</span>
			</div>
		</SceneFrame>
	)
}

/* -------------------------------------------------------------------------- */
/*  SCENE 4: CTA [AI: END WITH THE USER'S ONE DESIRED ACTION]                 */
/* -------------------------------------------------------------------------- */

const CtaScene: React.FC = () => {
	const frame = useCurrentFrame()
	const { fps } = useVideoConfig()
	const enter = spring({
		frame,
		fps,
		config: { damping: 16, stiffness: 88, mass: 0.95 },
	})

	return (
		<SceneFrame duration={TIMELINE.cta.duration}>
			<NatureProofWorld3D treeMaturity={1} cameraMove="push-in" />
			{/* Scrim: keeps the closing copy readable where it crosses the lit canopy. */}
			<AbsoluteFill
				style={{
					pointerEvents: 'none',
					background:
						'linear-gradient(180deg, rgba(6,23,16,0) 34%, rgba(6,23,16,0.5) 46%, rgba(6,23,16,0.8) 60%, rgba(6,23,16,0.9) 100%)',
				}}
			/>
			<div
				style={{
					position: 'absolute',
					left: 84,
					right: 84,
					top: 875,
					textAlign: 'center',
					opacity: enter,
					translate: `0 ${interpolate(enter, [0, 1], [54, 0])}px`,
				}}
			>
				<div
					style={{
						fontFamily: THEME.fontDisplay,
						fontSize: 110,
						fontWeight: 400,
						lineHeight: 0.98,
						letterSpacing: -0.5,
					}}
				>
					{BRIEF.cta}
				</div>
				<div
					style={{
						margin: '42px auto 0',
						maxWidth: 760,
						fontSize: 36,
						fontWeight: 560,
						lineHeight: 1.4,
						color: THEME.muted,
					}}
				>
					{BRIEF.ctaDetail}
				</div>
				<div
					style={{
						display: 'inline-flex',
						alignItems: 'center',
						gap: 16,
						marginTop: 50,
						padding: '20px 28px',
						borderRadius: 999,
						backgroundColor: THEME.ink,
						fontFamily: THEME.fontMono,
						fontSize: 20,
						fontWeight: 900,
						letterSpacing: 2,
						color: THEME.background,
						opacity: interpolate(
							frame,
							[VISUAL_BEATS.cta.brandReveal, VISUAL_BEATS.cta.brandReveal + 12],
							[0, 1],
							CLAMP,
						),
						scale: interpolate(
							frame,
							[VISUAL_BEATS.cta.brandReveal, VISUAL_BEATS.cta.brandReveal + 12],
							[0.92, 1],
							CLAMP,
						),
					}}
				>
					<span style={{ color: THEME.accent }}>SUNLIGHT</span>
					<VectorIcon name="spark" size={20} color={THEME.background} strokeWidth={2.2} />
					<span>BECOMES LIFE</span>
				</div>
			</div>
		</SceneFrame>
	)
}

/* -------------------------------------------------------------------------- */
/*  SOUNDTRACK [AI: KEEP ALL CUES ON THE SAME FRAME CLOCK AS THE VISUALS]      */
/* -------------------------------------------------------------------------- */

const Soundtrack: React.FC = () => (
	<>
		<Audio
			src={SOUND_DESIGN.music.src}
			loop
			loopVolumeCurveBehavior="extend"
			volume={(frame) =>
				interpolate(
					frame,
					[
						0,
						SOUND_DESIGN.music.fadeInFrames,
						VIDEO_END_FRAME - SOUND_DESIGN.music.fadeOutFrames,
						VIDEO_END_FRAME,
					],
					[0, SOUND_DESIGN.music.volume, SOUND_DESIGN.music.volume, 0],
					CLAMP,
				)
			}
		/>

		{/* Small UI and story sounds. */}
		{SOUND_DESIGN.sounds.map((cue) => (
			<Sequence
				key={cue.id}
				name={`Sound - ${cue.id}`}
				from={cue.from}
				durationInFrames={cue.durationInFrames}
				layout="none"
			>
				<Audio src={cue.src} volume={cue.volume} />
			</Sequence>
		))}

		{/* Editorial transitions, impacts, reveals, and final branding. */}
		{SOUND_DESIGN.sfx.map((cue) => (
			<Sequence
				key={cue.id}
				name={`SFX - ${cue.id}`}
				from={cue.from}
				durationInFrames={cue.durationInFrames}
				layout="none"
			>
				<Audio src={cue.src} volume={cue.volume} />
			</Sequence>
		))}
	</>
)

/* -------------------------------------------------------------------------- */
/*  FINISHING LAYER [AI: KEEP SUBTLE; NEVER LET IT FLATTEN THE SUBJECT]       */
/* -------------------------------------------------------------------------- */

/**
 * A gradient bar drawn as inline SVG.
 *
 * [AI: KEEP] The browser exporter derives CSS gradient fills from the element
 * box and can spill one across the frame; inline SVG rasterises exactly as
 * drawn. Use this for small gradient artwork and keep CSS gradients for
 * full-frame background layers.
 */
const GradientRule: React.FC<{
	width: number
	height: number
	from: string
	to: string
	radius?: number
}> = ({ width, height, from, to, radius }) => {
	const gradientId = React.useId()
	const barWidth = Math.max(1, Math.round(width))

	return (
		<svg
			aria-hidden="true"
			width={barWidth}
			height={height}
			viewBox={`0 0 ${barWidth} ${height}`}
			style={{ display: 'block' }}
		>
			<defs>
				<linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
					<stop offset="0" stopColor={from} />
					<stop offset="1" stopColor={to} />
				</linearGradient>
			</defs>
			<rect
				width={barWidth}
				height={height}
				rx={radius ?? height / 2}
				fill={`url(#${gradientId})`}
			/>
		</svg>
	)
}

const GRAIN_TILE = 512

/**
 * Grain plus vignette is what separates a flat render from something that looks
 * shot. The grain plate steps every other frame so it flickers like film instead
 * of sliding, and both layers stay light enough to keep text crisp.
 *
 * [AI: KEEP] Textures are drawn with <Img>, never with CSS background-image:
 * the browser exporter rasterises images and CSS gradients, and silently drops
 * `background-image: url(...)`, which would make the export differ from preview.
 */
const FilmFinish: React.FC<{ grain?: number; vignette?: number }> = ({
	grain = 0.09,
	vignette = 0.36,
}) => {
	const frame = useCurrentFrame()
	const { width, height } = useVideoConfig()
	const step = Math.floor(frame / 2)
	const offsetX = -((step * 37) % GRAIN_TILE)
	const offsetY = -((step * 71) % GRAIN_TILE)
	const columns = Math.ceil(width / GRAIN_TILE) + 1
	const rows = Math.ceil(height / GRAIN_TILE) + 1

	return (
		<>
			<AbsoluteFill style={{ pointerEvents: 'none', opacity: grain, overflow: 'hidden' }}>
				{Array.from({ length: rows }).map((_, row) =>
					Array.from({ length: columns }).map((__, column) => (
						<Img
							key={`${row}-${column}`}
							src={TEXTURE_KIT.filmGrain}
							style={{
								position: 'absolute',
								left: offsetX + column * GRAIN_TILE,
								top: offsetY + row * GRAIN_TILE,
								width: GRAIN_TILE,
								height: GRAIN_TILE,
							}}
						/>
					)),
				)}
			</AbsoluteFill>
			<Img
				src={TEXTURE_KIT.vignette}
				style={{
					position: 'absolute',
					inset: 0,
					width: '100%',
					height: '100%',
					opacity: vignette,
					pointerEvents: 'none',
				}}
			/>
		</>
	)
}

/* -------------------------------------------------------------------------- */
/*  6. MASTER COMPOSITION [AI: ASSEMBLE ALL SCENES HERE]                      */
/* -------------------------------------------------------------------------- */

export type AiMasterTemplateProps = {
	showGuides: boolean
}

export const AiMasterTemplate: React.FC<AiMasterTemplateProps> = ({ showGuides }) => (
	<AbsoluteFill style={{ backgroundColor: THEME.background }}>
		<Soundtrack />
		<Background />

		<Sequence name="Scene 1 - Hook" from={TIMELINE.hook.from} durationInFrames={TIMELINE.hook.duration}>
			<HookScene />
		</Sequence>
		<Sequence name="Scene 2 - Brief" from={TIMELINE.brief.from} durationInFrames={TIMELINE.brief.duration}>
			<BriefScene />
		</Sequence>
		<Sequence name="Scene 3 - Story" from={TIMELINE.story.from} durationInFrames={TIMELINE.story.duration}>
			<StoryScene />
		</Sequence>
		<Sequence name="Scene 4 - CTA" from={TIMELINE.cta.from} durationInFrames={TIMELINE.cta.duration}>
			<CtaScene />
		</Sequence>

		{/* Finishing pass: one grain plate and one vignette over the whole film. */}
		<FilmFinish grain={0.09} vignette={0.36} />

		{showGuides ? <SafeAreaGuides /> : null}
	</AbsoluteFill>
)

/* -------------------------------------------------------------------------- */
/*  7. ROOT REGISTRATION [AI: KEEP; EDIT INLINE VIDEO METADATA AS REQUESTED]  */
/* -------------------------------------------------------------------------- */

export const Root: React.FC = () => (
	<Composition
		id="AiMasterTemplate"
		component={AiMasterTemplate}
		durationInFrames={TIMELINE_END}
		fps={30}
		width={1080}
		height={1920}
		defaultProps={{ showGuides: false }}
	/>
)

registerRoot(Root)

export default AiMasterTemplate
