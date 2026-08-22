export type SampleBadge =
	| 'ai-starter'
	| 'flagship'
	| 'showcase'
	| '3d'
	| 'data-viz'
	| 'systems'
	| 'multi-file'

export type SampleDefinition = {
	id: string
	/** file inside /public/samples */
	file: string
	name: string
	description: string
	/** what makes this one different from every other sample */
	technique: string
	badge: SampleBadge
}

/**
 * Bundled uploads. `npm run samples` copies /samples into /public/samples and
 * zips the multi-file starter, so these paths always exist after a build.
 *
 * Showcase samples use independent visual systems. AI Master Template is the
 * intentional guided scaffold for the download -> AI edit -> re-upload workflow.
 */
export const SAMPLES: SampleDefinition[] = [
	{
		id: 'ai-master-template',
		file: 'ai-master-template.tsx',
		name: 'AI Master Template',
		description: '1080x1920 - 15s - visual-proof contract, procedural 3D subjects and synced sound.',
		technique: 'A lit ThreeCanvas sun/tree proves the words; camera, growth, music and SFX share frames.',
		badge: 'ai-starter',
	},
	{
		id: 'ai-caption-template',
		file: 'ai-caption-template.tsx',
		name: 'AI Caption Template',
		description: '1080x1920 - burned-in subtitle contract with word timing, Nepali + English support.',
		technique: 'Balanced line breaking, per-word highlight, mixed Devanagari/Latin fonts, legibility scrim.',
		badge: 'ai-starter',
	},
	{
		id: 'star-forge-3d',
		file: 'star-forge-3d.tsx',
		name: 'Star Forge 3D',
		description: '1080x1920 - 30s - extruded stars forged in perspective, four loop shapes.',
		technique: 'Hand-written yaw/pitch matrix + perspective divide, 8-layer extrusion. No WebGL.',
		badge: '3d',
	},
	{
		id: '3d-asset-turntable',
		file: '3d-asset-turntable.tsx',
		name: 'Local GLB Turntable',
		description: '1920x1080 - 12s - a bundled Hero Bot model on a polished WebGL turntable.',
		technique: 'GLTFLoader + render delay, auto-framing, PBR lights and frame-driven rotation.',
		badge: '3d',
	},
	{
		id: 'event-loop-orbit',
		file: 'event-loop-orbit.tsx',
		name: 'Event Loop Orbit',
		description: '1080x1920 - 30s - blocking vs async I/O, told as an orbit with a live clock.',
		technique: 'A real scheduler returns start/end times; cards, ring and clock all read from it.',
		badge: 'systems',
	},
	{
		id: 'thread-race',
		file: 'thread-race.tsx',
		name: 'Thread Race',
		description: '1080x1920 - 30s - one time-sliced core races four parallel cores.',
		technique: 'Round-robin simulator emits the stripes; progress bars are derived, not keyframed.',
		badge: 'systems',
	},
	{
		id: 'pascal-cascade',
		file: 'pascal-cascade.tsx',
		name: 'Pascal Cascade',
		description: '1080x1920 - 30s - the triangle writes itself, then Sierpinski appears.',
		technique: 'Light drafting-paper palette, SVG arcs drawn via pathLength=1 dash offsets.',
		badge: 'data-viz',
	},
	{
		id: 'code-becomes-geometry',
		file: 'code-becomes-geometry.tsx',
		name: 'Code Becomes Geometry',
		description: '1080x1920 - 20s - four ASCII patterns built tile by tile with spring physics.',
		technique: 'Monospace grid typography, per-tile spring stagger, live code card.',
		badge: 'flagship',
	},
	{
		id: 'neon-product-reveal',
		file: 'neon-product-reveal.tsx',
		name: 'Neon Product Reveal',
		description: '1080x1920 - 15s - glass card, aurora gradient and a kinetic feature list.',
		technique: 'Layered blur gradients, glassmorphism, staggered list entrance.',
		badge: 'showcase',
	},
	{
		id: 'starter-project',
		file: 'starter-project.zip',
		name: 'Kinetic Quote (zip)',
		description: 'Multi-file project: package.json + src/index.ts + Root.tsx + component.',
		technique: 'Shows how a full folder upload resolves its own entry point.',
		badge: 'multi-file',
	},
]
