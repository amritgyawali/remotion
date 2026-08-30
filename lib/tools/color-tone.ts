'use client'

/**
 * The colour-tone library: sixty-odd looks, and the maths that bakes any one
 * of them into a lookup table.
 *
 * A "look" here is a `ToneRecipe` - white balance, exposure, lift/gamma/gain,
 * contrast, saturation, split toning, a highlight shoulder and a black lift -
 * not a hand-painted .cube file. Two reasons for that. A recipe is a few
 * dozen bytes, so all sixty ship inside the page instead of sixty megabytes
 * of downloads; and because every recipe runs through the same evaluator, a
 * look can be trimmed live (warmer, brighter, flatter) rather than being a
 * fixed table that can only be faded in and out.
 *
 * The evaluator is only ever run 35,937 times - once per cell of a 33x33x33
 * cube - and never per pixel. `bakeToneLut` turns a recipe into that cube,
 * `tone-renderer.ts` uploads it to the GPU as a 3D texture, and from then on
 * every pixel of every frame costs one hardware-interpolated texture fetch
 * whatever the look was. That is what makes a heavy film emulation exactly as
 * cheap as a mild warm-up.
 *
 * Grain, vignette, bloom, halation and diffusion are deliberately *not* in
 * the cube: they depend on where a pixel is, or on a random seed, so no
 * colour-in/colour-out table can hold them. They live in the shader instead,
 * as the `ToneFinish` half of a look.
 */

export type RGB = [number, number, number]

export type ToneFamily = 'cinematic' | 'film' | 'creator' | 'moody' | 'retro' | 'nature' | 'neon' | 'mono' | 'utility'

export type ToneRecipe = {
	/** -1 cools the picture, +1 warms it */
	temperature?: number
	/** -1 pushes green, +1 pushes magenta */
	tint?: number
	/** stops, applied in linear light */
	exposure?: number
	/** 1 leaves contrast alone; applied around `pivot` */
	contrast?: number
	pivot?: number
	saturation?: number
	/** lifts only the already-dull colours, the way a "vibrance" slider does */
	vibrance?: number
	/** added to the shadows, per channel, in linear light */
	lift?: RGB
	/** per-channel midtone gamma; 1 is neutral */
	gamma?: RGB
	/** per-channel multiplier on the highlights, in linear light */
	gain?: RGB
	shadowTint?: string
	shadowStrength?: number
	highlightTint?: string
	highlightStrength?: number
	/** milky "matte" black lift, 0-0.35 */
	fade?: number
	/** highlight roll-off; 0 clips hard, 1 is a soft film shoulder */
	shoulder?: number
	/** global hue rotation, in degrees */
	hueShift?: number
	/** 0 keeps colour, 1 is fully monochrome */
	mono?: number
	/** what "white" looks like once `mono` reaches 1 */
	monoTint?: string
}

/** The parts of a look that no colour-in/colour-out table can hold. */
export type ToneFinish = {
	/** film grain, 0-1 */
	grain?: number
	/** grain cell size in output pixels, 1-4 */
	grainSize?: number
	vignette?: number
	/** blooming highlights, 0-1 */
	bloom?: number
	/** red halo around blown highlights, the way film halates, 0-1 */
	halation?: number
	/** soft-focus diffusion, 0-1 */
	softness?: number
	/** chromatic aberration toward the frame edge, 0-1 */
	chroma?: number
}

export type ToneDef = {
	id: string
	name: string
	family: ToneFamily
	blurb: string
	recipe: ToneRecipe
	finish?: ToneFinish
}

export const TONE_FAMILIES: Array<{ id: ToneFamily; label: string }> = [
	{ id: 'cinematic', label: 'Cinematic' },
	{ id: 'film', label: 'Film stock' },
	{ id: 'creator', label: 'Creator' },
	{ id: 'moody', label: 'Moody' },
	{ id: 'retro', label: 'Retro' },
	{ id: 'nature', label: 'Nature' },
	{ id: 'neon', label: 'Neon' },
	{ id: 'mono', label: 'Monochrome' },
	{ id: 'utility', label: 'Utility' },
]

/* ==========================================================================
   The looks.

   Ordered by family, and inside a family roughly from subtle to strong, so
   the picker reads as a shelf rather than a list. The numbers are small on
   purpose: a grade that survives being watched for a whole minute is nearly
   always less than it feels like it should be while you are building it.
   ========================================================================== */

export const TONES: ToneDef[] = [
	/* ------------------------------------------------------------ cinematic */
	{
		id: 'teal-orange',
		name: 'Teal & Orange',
		family: 'cinematic',
		blurb: 'The blockbuster look: warm skin against cool shadows.',
		recipe: {
			temperature: 0.16,
			contrast: 1.16,
			saturation: 1.06,
			shadowTint: '#123a4d',
			shadowStrength: 0.3,
			highlightTint: '#ffb877',
			highlightStrength: 0.2,
			shoulder: 0.35,
		},
		finish: { vignette: 0.16 },
	},
	{
		id: 'blockbuster',
		name: 'Blockbuster',
		family: 'cinematic',
		blurb: 'Punchier teal and orange with a deeper, glossier contrast curve.',
		recipe: {
			temperature: 0.2,
			contrast: 1.3,
			saturation: 1.12,
			gain: [1.05, 1, 0.95],
			shadowTint: '#0d3348',
			shadowStrength: 0.42,
			highlightTint: '#ffc48c',
			highlightStrength: 0.26,
			shoulder: 0.45,
		},
		finish: { vignette: 0.24, bloom: 0.14 },
	},
	{
		id: 'anamorphic',
		name: 'Anamorphic',
		family: 'cinematic',
		blurb: 'Wide-lens feel: blue flare in the highlights, soft edges, lifted blacks.',
		recipe: {
			temperature: -0.06,
			contrast: 1.12,
			saturation: 1.04,
			fade: 0.05,
			highlightTint: '#8fc7ff',
			highlightStrength: 0.2,
			shoulder: 0.5,
		},
		finish: { bloom: 0.3, softness: 0.16, chroma: 0.25, vignette: 0.2 },
	},
	{
		id: 'bleach-bypass',
		name: 'Bleach Bypass',
		family: 'cinematic',
		blurb: 'Silver-retention look - hard contrast, colour drained almost out.',
		recipe: { contrast: 1.45, saturation: 0.42, mono: 0.25, monoTint: '#e8eef2', shoulder: 0.2 },
		finish: { grain: 0.22, vignette: 0.2 },
	},
	{
		id: 'day-for-night',
		name: 'Day for Night',
		family: 'cinematic',
		blurb: 'Turns a daylight shot into moonlight: cold, dim and desaturated.',
		recipe: {
			temperature: -0.55,
			exposure: -0.85,
			contrast: 1.2,
			saturation: 0.55,
			lift: [-0.01, 0, 0.035],
			shadowTint: '#0b2444',
			shadowStrength: 0.5,
		},
		finish: { vignette: 0.34, grain: 0.14 },
	},
	{
		id: 'noir',
		name: 'Film Noir',
		family: 'cinematic',
		blurb: 'Hard black and white with crushed shadows and a blown key light.',
		recipe: { mono: 1, monoTint: '#f2f4f6', contrast: 1.55, exposure: 0.05, shoulder: 0.15 },
		finish: { grain: 0.3, vignette: 0.42 },
	},
	{
		id: 'epic-warm',
		name: 'Epic Warm',
		family: 'cinematic',
		blurb: 'Golden, high-contrast trailer grade for wide landscapes.',
		recipe: {
			temperature: 0.3,
			contrast: 1.26,
			saturation: 1.1,
			gain: [1.08, 1.02, 0.92],
			highlightTint: '#ffd7a0',
			highlightStrength: 0.28,
			shoulder: 0.4,
		},
		finish: { vignette: 0.2, bloom: 0.12 },
	},
	{
		id: 'cold-thriller',
		name: 'Cold Thriller',
		family: 'cinematic',
		blurb: 'Steel-blue, low saturation, heavy shadows - interrogation-room cold.',
		recipe: {
			temperature: -0.34,
			contrast: 1.3,
			saturation: 0.72,
			shadowTint: '#0f2233',
			shadowStrength: 0.45,
			highlightTint: '#cfe4f2',
			highlightStrength: 0.18,
		},
		finish: { vignette: 0.3, grain: 0.16 },
	},
	{
		id: 'sci-fi-chrome',
		name: 'Sci-Fi Chrome',
		family: 'cinematic',
		blurb: 'Clean cyan-white with a hard shoulder - clinical and future-facing.',
		recipe: {
			temperature: -0.2,
			tint: -0.08,
			contrast: 1.22,
			saturation: 0.88,
			gain: [0.96, 1.02, 1.06],
			shoulder: 0.55,
		},
		finish: { bloom: 0.2, chroma: 0.15 },
	},
	{
		id: 'dust-and-sun',
		name: 'Dust & Sun',
		family: 'cinematic',
		blurb: 'Sun-bleached western: amber highlights, dry greens, dusty blacks.',
		recipe: {
			temperature: 0.34,
			tint: 0.06,
			contrast: 1.14,
			saturation: 0.82,
			fade: 0.07,
			gain: [1.06, 0.99, 0.88],
			highlightTint: '#ffdca6',
			highlightStrength: 0.3,
		},
		finish: { grain: 0.24, vignette: 0.22 },
	},
	{
		id: 'war-drama',
		name: 'War Drama',
		family: 'cinematic',
		blurb: 'Desaturated olive and slate, the way a modern war film is graded.',
		recipe: {
			temperature: -0.1,
			tint: -0.14,
			contrast: 1.24,
			saturation: 0.6,
			fade: 0.04,
			shadowTint: '#22301f',
			shadowStrength: 0.35,
		},
		finish: { grain: 0.28, vignette: 0.26 },
	},
	{
		id: 'romance-glow',
		name: 'Romance Glow',
		family: 'cinematic',
		blurb: 'Soft, warm and slightly hazy - flattering on faces.',
		recipe: { temperature: 0.18, contrast: 0.96, saturation: 1.04, fade: 0.06, highlightTint: '#ffe1cf', highlightStrength: 0.3 },
		finish: { bloom: 0.3, softness: 0.3, vignette: 0.12 },
	},

	/* ---------------------------------------------------------------- film */
	{
		id: 'portra-400',
		name: 'Portra 400',
		family: 'film',
		blurb: 'Creamy negative stock: warm skin, soft contrast, gentle greens.',
		recipe: {
			temperature: 0.12,
			contrast: 0.98,
			saturation: 0.94,
			vibrance: 0.18,
			fade: 0.05,
			gain: [1.03, 1, 0.98],
			highlightTint: '#ffe6d2',
			highlightStrength: 0.22,
			shoulder: 0.45,
		},
		finish: { grain: 0.18 },
	},
	{
		id: 'portra-800',
		name: 'Portra 800',
		family: 'film',
		blurb: 'The same skin tones pushed a stop - grainier and a touch warmer.',
		recipe: {
			temperature: 0.16,
			exposure: 0.1,
			contrast: 1.04,
			saturation: 0.96,
			fade: 0.06,
			highlightTint: '#ffdcc4',
			highlightStrength: 0.24,
			shoulder: 0.4,
		},
		finish: { grain: 0.32 },
	},
	{
		id: 'kodak-gold',
		name: 'Kodak Gold',
		family: 'film',
		blurb: 'Sunny consumer film - yellow-warm and cheerfully saturated.',
		recipe: {
			temperature: 0.24,
			tint: 0.04,
			contrast: 1.06,
			saturation: 1.12,
			gain: [1.05, 1.01, 0.9],
			highlightTint: '#ffe2a8',
			highlightStrength: 0.26,
		},
		finish: { grain: 0.2 },
	},
	{
		id: 'vision3-250d',
		name: 'Vision3 250D',
		family: 'film',
		blurb: 'Daylight motion-picture negative: neutral, wide and easy to grade.',
		recipe: { contrast: 1.02, saturation: 0.98, fade: 0.04, shoulder: 0.5, highlightTint: '#fff2e2', highlightStrength: 0.12 },
		finish: { grain: 0.16 },
	},
	{
		id: 'vision3-500t',
		name: 'Vision3 500T',
		family: 'film',
		blurb: 'Tungsten stock shot cool - the night-interior workhorse.',
		recipe: {
			temperature: -0.2,
			contrast: 1.06,
			saturation: 0.96,
			fade: 0.05,
			shadowTint: '#16283c',
			shadowStrength: 0.3,
			shoulder: 0.45,
		},
		finish: { grain: 0.24, halation: 0.2 },
	},
	{
		id: 'cinestill-800t',
		name: 'Cinestill 800T',
		family: 'film',
		blurb: 'Tungsten night film with its signature red halo around lights.',
		recipe: {
			temperature: -0.26,
			contrast: 1.1,
			saturation: 1.04,
			fade: 0.05,
			shadowTint: '#132a44',
			shadowStrength: 0.32,
			highlightTint: '#ffd0c0',
			highlightStrength: 0.18,
		},
		finish: { grain: 0.28, halation: 0.55, bloom: 0.22 },
	},
	{
		id: 'fuji-superia',
		name: 'Fuji Superia',
		family: 'film',
		blurb: 'Cool greens and clean blues - the classic Fuji consumer palette.',
		recipe: {
			temperature: -0.1,
			tint: -0.08,
			contrast: 1.08,
			saturation: 1.06,
			gain: [0.98, 1.03, 1.02],
			shadowTint: '#1b3a34',
			shadowStrength: 0.22,
		},
		finish: { grain: 0.2 },
	},
	{
		id: 'fuji-velvia',
		name: 'Fuji Velvia',
		family: 'film',
		blurb: 'Slide film for landscapes: hard contrast and very loud colour.',
		recipe: { contrast: 1.3, saturation: 1.4, vibrance: 0.1, gain: [1.02, 1.02, 1], shoulder: 0.25 },
		finish: { grain: 0.1, vignette: 0.16 },
	},
	{
		id: 'fuji-eterna',
		name: 'Fuji Eterna',
		family: 'film',
		blurb: 'Flat, low-saturation cine stock made to be graded afterwards.',
		recipe: { contrast: 0.9, saturation: 0.78, fade: 0.09, shoulder: 0.6 },
		finish: { grain: 0.14 },
	},
	{
		id: 'agfa-vista',
		name: 'Agfa Vista',
		family: 'film',
		blurb: 'Punchy magentas and warm reds - the loud end of 90s print film.',
		recipe: { temperature: 0.1, tint: 0.16, contrast: 1.12, saturation: 1.18, gain: [1.05, 0.98, 1.02] },
		finish: { grain: 0.22 },
	},
	{
		id: 'ektachrome',
		name: 'Ektachrome',
		family: 'film',
		blurb: 'Cool, crisp reversal film - blue skies and neutral whites.',
		recipe: { temperature: -0.14, contrast: 1.18, saturation: 1.14, gain: [0.98, 1, 1.06], shoulder: 0.3 },
		finish: { grain: 0.12 },
	},
	{
		id: 'kodachrome-64',
		name: 'Kodachrome 64',
		family: 'film',
		blurb: 'Deep reds, dense blacks, unmistakably mid-century.',
		recipe: {
			temperature: 0.08,
			contrast: 1.24,
			saturation: 1.16,
			gain: [1.06, 0.99, 0.96],
			lift: [0, -0.008, -0.004],
			shadowTint: '#2a1410',
			shadowStrength: 0.24,
		},
		finish: { grain: 0.18, vignette: 0.14 },
	},
	{
		id: 'ilford-hp5',
		name: 'Ilford HP5',
		family: 'film',
		blurb: 'Classic reportage black and white - grainy, mid-contrast, honest.',
		recipe: { mono: 1, monoTint: '#f4f2ee', contrast: 1.16, fade: 0.04 },
		finish: { grain: 0.4 },
	},
	{
		id: 'tri-x',
		name: 'Kodak Tri-X',
		family: 'film',
		blurb: 'Punchier monochrome with heavier blacks than HP5.',
		recipe: { mono: 1, monoTint: '#f6f5f2', contrast: 1.34, exposure: -0.05 },
		finish: { grain: 0.46, vignette: 0.2 },
	},
	{
		id: 'polaroid-600',
		name: 'Polaroid 600',
		family: 'film',
		blurb: 'Instant film: milky blacks, cyan shadows, blown highlights.',
		recipe: {
			temperature: -0.08,
			contrast: 0.92,
			saturation: 0.88,
			fade: 0.16,
			shadowTint: '#2a4a52',
			shadowStrength: 0.3,
			highlightTint: '#fff3e0',
			highlightStrength: 0.3,
			shoulder: 0.7,
		},
		finish: { grain: 0.2, vignette: 0.24, bloom: 0.16 },
	},
	{
		id: 'expired-film',
		name: 'Expired Film',
		family: 'film',
		blurb: 'Colour shifted past its date - green cast, weak blacks, odd reds.',
		recipe: {
			tint: -0.2,
			contrast: 0.94,
			saturation: 0.84,
			fade: 0.14,
			gain: [1.04, 1.02, 0.9],
			shadowTint: '#3b4a2a',
			shadowStrength: 0.34,
		},
		finish: { grain: 0.36, vignette: 0.22 },
	},

	/* ------------------------------------------------------------- creator */
	{
		id: 'clean-bright',
		name: 'Clean & Bright',
		family: 'creator',
		blurb: 'Neutral lift for talking heads - brighter, clearer, still natural.',
		recipe: { exposure: 0.18, contrast: 1.06, saturation: 1.04, shoulder: 0.35 },
	},
	{
		id: 'vlog-punch',
		name: 'Vlog Punch',
		family: 'creator',
		blurb: 'Contrast and colour pushed for small screens and fast scrolling.',
		recipe: { exposure: 0.1, contrast: 1.24, saturation: 1.22, vibrance: 0.12, shoulder: 0.3 },
		finish: { vignette: 0.1 },
	},
	{
		id: 'beauty-soft',
		name: 'Beauty Soft',
		family: 'creator',
		blurb: 'Flattering warm diffusion for close-ups and pieces to camera.',
		recipe: { temperature: 0.14, exposure: 0.12, contrast: 0.96, saturation: 1.02, fade: 0.05 },
		finish: { softness: 0.35, bloom: 0.24 },
	},
	{
		id: 'product-white',
		name: 'Product White',
		family: 'creator',
		blurb: 'Clinical whites and true colour, for anything shot on a white sweep.',
		recipe: { exposure: 0.2, contrast: 1.1, saturation: 1, gain: [1.02, 1.02, 1.03], shoulder: 0.5 },
	},
	{
		id: 'food-warm',
		name: 'Food Warm',
		family: 'creator',
		blurb: 'Appetising warmth: reds and yellows up, greens held back.',
		recipe: { temperature: 0.22, contrast: 1.1, saturation: 1.14, vibrance: 0.14, gain: [1.05, 1, 0.94] },
		finish: { vignette: 0.14 },
	},
	{
		id: 'tech-review',
		name: 'Tech Review',
		family: 'creator',
		blurb: 'Slightly cool and very clean - reads as modern and precise.',
		recipe: { temperature: -0.12, exposure: 0.12, contrast: 1.14, saturation: 1.02, gain: [0.99, 1.01, 1.04] },
	},
	{
		id: 'fitness-punch',
		name: 'Fitness Punch',
		family: 'creator',
		blurb: 'High contrast with hard shadows - gym and sport footage.',
		recipe: { contrast: 1.36, saturation: 1.08, gain: [1.03, 1, 0.99], shoulder: 0.25 },
		finish: { vignette: 0.26, grain: 0.1 },
	},
	{
		id: 'travel-vivid',
		name: 'Travel Vivid',
		family: 'creator',
		blurb: 'Postcard colour - deep skies, rich greens, warm sand.',
		recipe: { temperature: 0.1, contrast: 1.18, saturation: 1.28, vibrance: 0.16, gain: [1, 1.04, 1.06] },
		finish: { vignette: 0.14 },
	},
	{
		id: 'interview-neutral',
		name: 'Interview Neutral',
		family: 'creator',
		blurb: 'A careful, invisible grade - the one to reach for when in doubt.',
		recipe: { contrast: 1.06, saturation: 1.02, shoulder: 0.4 },
	},
	{
		id: 'gaming-stream',
		name: 'Gaming Stream',
		family: 'creator',
		blurb: 'Saturated and bright, so a webcam holds up against a busy overlay.',
		recipe: { exposure: 0.16, contrast: 1.2, saturation: 1.3, vibrance: 0.1 },
	},

	/* --------------------------------------------------------------- moody */
	{
		id: 'moody-blue',
		name: 'Moody Blue',
		family: 'moody',
		blurb: 'Cool, quiet and low-contrast - the default melancholy grade.',
		recipe: { temperature: -0.26, contrast: 1.06, saturation: 0.86, fade: 0.09, shadowTint: '#16283f', shadowStrength: 0.4 },
		finish: { vignette: 0.22, grain: 0.14 },
	},
	{
		id: 'faded-film',
		name: 'Faded Film',
		family: 'moody',
		blurb: 'Milky blacks and washed colour, like a print left in the sun.',
		recipe: { contrast: 0.88, saturation: 0.76, fade: 0.18, shoulder: 0.6, highlightTint: '#f6e8da', highlightStrength: 0.2 },
		finish: { grain: 0.24, vignette: 0.18 },
	},
	{
		id: 'muted-earth',
		name: 'Muted Earth',
		family: 'moody',
		blurb: 'Warm but restrained - browns, clay and dulled greens.',
		recipe: { temperature: 0.12, tint: -0.06, contrast: 1.04, saturation: 0.74, fade: 0.08, gain: [1.03, 0.99, 0.94] },
		finish: { grain: 0.16, vignette: 0.2 },
	},
	{
		id: 'charcoal',
		name: 'Charcoal',
		family: 'moody',
		blurb: 'Nearly monochrome with a cold cast and heavy blacks.',
		recipe: { mono: 0.7, monoTint: '#dfe6ec', temperature: -0.18, contrast: 1.28, fade: 0.03 },
		finish: { grain: 0.24, vignette: 0.34 },
	},
	{
		id: 'rain-window',
		name: 'Rain Window',
		family: 'moody',
		blurb: 'Grey-green and damp, with soft highlights and no strong colour.',
		recipe: { temperature: -0.16, tint: -0.12, contrast: 0.98, saturation: 0.7, fade: 0.12, shoulder: 0.55 },
		finish: { bloom: 0.18, vignette: 0.22, grain: 0.16 },
	},
	{
		id: 'midnight',
		name: 'Midnight',
		family: 'moody',
		blurb: 'Very dark and very blue, with only the highlights left standing.',
		recipe: {
			temperature: -0.4,
			exposure: -0.55,
			contrast: 1.3,
			saturation: 0.7,
			shadowTint: '#0a1830',
			shadowStrength: 0.55,
			highlightTint: '#bcd8ff',
			highlightStrength: 0.2,
		},
		finish: { vignette: 0.4, bloom: 0.18 },
	},
	{
		id: 'smoke',
		name: 'Smoke',
		family: 'moody',
		blurb: 'Hazy neutral grey - flat, foggy and almost colourless.',
		recipe: { contrast: 0.84, saturation: 0.6, fade: 0.2, shoulder: 0.7 },
		finish: { softness: 0.3, bloom: 0.2, grain: 0.14 },
	},

	/* --------------------------------------------------------------- retro */
	{
		id: 'vhs',
		name: 'VHS Tape',
		family: 'retro',
		blurb: 'Soft, smeared and slightly magenta, the way a worn tape looks.',
		recipe: {
			tint: 0.14,
			contrast: 1.06,
			saturation: 1.1,
			fade: 0.12,
			gain: [1.04, 0.98, 1.02],
			shadowTint: '#2a1c3a',
			shadowStrength: 0.3,
		},
		finish: { grain: 0.3, softness: 0.4, chroma: 0.5, vignette: 0.2 },
	},
	{
		id: 'crt',
		name: 'CRT Monitor',
		family: 'retro',
		blurb: 'Glowing phosphor green-blue with blown, bleeding highlights.',
		recipe: { temperature: -0.12, tint: -0.14, contrast: 1.2, saturation: 1.12, gain: [0.96, 1.05, 1] },
		finish: { bloom: 0.4, softness: 0.22, vignette: 0.3, chroma: 0.3 },
	},
	{
		id: 'seventies-print',
		name: '1970s Print',
		family: 'retro',
		blurb: 'Orange-heavy, low contrast, faintly green shadows.',
		recipe: {
			temperature: 0.3,
			tint: -0.08,
			contrast: 0.94,
			saturation: 0.92,
			fade: 0.14,
			gain: [1.06, 1, 0.86],
			shadowTint: '#3a3418',
			shadowStrength: 0.3,
		},
		finish: { grain: 0.3, vignette: 0.24 },
	},
	{
		id: 'eighties-pop',
		name: '1980s Pop',
		family: 'retro',
		blurb: 'Loud magenta and cyan against a bright, contrasty base.',
		recipe: { tint: 0.2, contrast: 1.24, saturation: 1.34, gain: [1.05, 0.96, 1.06], highlightTint: '#ffc0ea', highlightStrength: 0.22 },
		finish: { bloom: 0.24, vignette: 0.16 },
	},
	{
		id: 'technicolor',
		name: 'Technicolor',
		family: 'retro',
		blurb: 'Three-strip saturation: primary reds, greens and blues, nothing in between.',
		recipe: { contrast: 1.3, saturation: 1.5, vibrance: -0.1, gain: [1.06, 1, 1.02], shoulder: 0.2 },
		finish: { vignette: 0.2 },
	},
	{
		id: 'sepia-print',
		name: 'Sepia Print',
		family: 'retro',
		blurb: 'A warm brown photographic print, not a colour filter.',
		recipe: { mono: 1, monoTint: '#f0d8b0', contrast: 1.1, fade: 0.07 },
		finish: { grain: 0.24, vignette: 0.28 },
	},
	{
		id: 'super-8',
		name: 'Super 8',
		family: 'retro',
		blurb: 'Home-movie warmth: grainy, soft and slightly overexposed.',
		recipe: { temperature: 0.26, exposure: 0.12, contrast: 1.02, saturation: 0.96, fade: 0.12, shoulder: 0.6 },
		finish: { grain: 0.5, softness: 0.24, vignette: 0.3, halation: 0.2 },
	},
	{
		id: 'newsreel',
		name: 'Newsreel',
		family: 'retro',
		blurb: 'Scratchy archive monochrome with a paper-white highlight.',
		recipe: { mono: 1, monoTint: '#efeade', contrast: 1.3, fade: 0.08 },
		finish: { grain: 0.55, vignette: 0.36, softness: 0.16 },
	},

	/* -------------------------------------------------------------- nature */
	{
		id: 'golden-hour',
		name: 'Golden Hour',
		family: 'nature',
		blurb: 'Low warm sun: amber highlights and long, soft shadows.',
		recipe: {
			temperature: 0.36,
			contrast: 1.08,
			saturation: 1.12,
			gain: [1.07, 1, 0.88],
			highlightTint: '#ffcf8a',
			highlightStrength: 0.34,
			shoulder: 0.45,
		},
		finish: { bloom: 0.2, vignette: 0.14 },
	},
	{
		id: 'blue-hour',
		name: 'Blue Hour',
		family: 'nature',
		blurb: 'The cool half hour after sunset - deep blue with warm point lights.',
		recipe: {
			temperature: -0.34,
			exposure: -0.15,
			contrast: 1.12,
			saturation: 0.94,
			shadowTint: '#122a4a',
			shadowStrength: 0.45,
			highlightTint: '#ffd6a8',
			highlightStrength: 0.2,
		},
		finish: { bloom: 0.2, vignette: 0.22 },
	},
	{
		id: 'deep-forest',
		name: 'Deep Forest',
		family: 'nature',
		blurb: 'Rich greens with cool shade and restrained highlights.',
		recipe: { tint: -0.14, contrast: 1.12, saturation: 1.1, gain: [0.95, 1.05, 0.98], shadowTint: '#123024', shadowStrength: 0.32 },
		finish: { vignette: 0.2 },
	},
	{
		id: 'tropical',
		name: 'Tropical',
		family: 'nature',
		blurb: 'Turquoise water, bright sand, high sun.',
		recipe: { temperature: 0.06, contrast: 1.16, saturation: 1.3, vibrance: 0.14, gain: [1, 1.04, 1.06] },
		finish: { bloom: 0.14 },
	},
	{
		id: 'autumn',
		name: 'Autumn',
		family: 'nature',
		blurb: 'Reds and ochres lifted, greens pulled down and warmed.',
		recipe: { temperature: 0.24, tint: 0.06, contrast: 1.12, saturation: 1.14, gain: [1.08, 0.98, 0.9] },
		finish: { vignette: 0.18, grain: 0.12 },
	},
	{
		id: 'arctic',
		name: 'Arctic',
		family: 'nature',
		blurb: 'Blue-white snow with almost no warmth left in the frame.',
		recipe: { temperature: -0.4, contrast: 1.18, saturation: 0.8, gain: [0.96, 1, 1.08], shoulder: 0.55 },
		finish: { bloom: 0.2, vignette: 0.14 },
	},
	{
		id: 'desert',
		name: 'Desert',
		family: 'nature',
		blurb: 'Hot, dry and pale - sand highlights with a faint red shadow.',
		recipe: {
			temperature: 0.28,
			contrast: 1.1,
			saturation: 0.9,
			fade: 0.06,
			gain: [1.06, 1, 0.9],
			shadowTint: '#4a2c1c',
			shadowStrength: 0.24,
		},
		finish: { vignette: 0.2, grain: 0.12 },
	},
	{
		id: 'underwater',
		name: 'Underwater Fix',
		family: 'nature',
		blurb: 'Puts back the red that water absorbs, so dive footage stops looking flat.',
		recipe: { temperature: 0.3, tint: 0.12, contrast: 1.14, saturation: 1.08, gain: [1.18, 1, 0.9] },
		finish: { vignette: 0.16 },
	},

	/* ---------------------------------------------------------------- neon */
	{
		id: 'cyberpunk',
		name: 'Cyberpunk',
		family: 'neon',
		blurb: 'Magenta highlights over cyan shadows, with glow on every light.',
		recipe: {
			contrast: 1.26,
			saturation: 1.3,
			shadowTint: '#0d2a4d',
			shadowStrength: 0.5,
			highlightTint: '#ff6ad5',
			highlightStrength: 0.34,
		},
		finish: { bloom: 0.4, halation: 0.25, vignette: 0.28, chroma: 0.2 },
	},
	{
		id: 'synthwave',
		name: 'Synthwave',
		family: 'neon',
		blurb: 'Purple-pink sunset colours with a soft, glowing haze.',
		recipe: {
			tint: 0.22,
			contrast: 1.16,
			saturation: 1.28,
			fade: 0.07,
			shadowTint: '#2a1250',
			shadowStrength: 0.45,
			highlightTint: '#ff9ad0',
			highlightStrength: 0.3,
		},
		finish: { bloom: 0.42, softness: 0.18, vignette: 0.24 },
	},
	{
		id: 'nightclub',
		name: 'Nightclub',
		family: 'neon',
		blurb: 'Deep blacks with hot, saturated colour only where the lights hit.',
		recipe: { exposure: -0.2, contrast: 1.42, saturation: 1.36, shadowTint: '#0a0a1a', shadowStrength: 0.5 },
		finish: { bloom: 0.36, halation: 0.3, vignette: 0.36 },
	},
	{
		id: 'toxic',
		name: 'Toxic',
		family: 'neon',
		blurb: 'Sickly green key with cold shadows - horror and hacker footage.',
		recipe: { tint: -0.3, contrast: 1.24, saturation: 1.18, gain: [0.92, 1.12, 0.96], shadowTint: '#0c2016', shadowStrength: 0.45 },
		finish: { vignette: 0.34, grain: 0.2, bloom: 0.18 },
	},
	{
		id: 'infrared',
		name: 'Infrared',
		family: 'neon',
		blurb: 'False colour: pink foliage and a near-black sky.',
		recipe: { tint: 0.4, contrast: 1.2, saturation: 1.3, gain: [1.25, 0.9, 1.1], hueShift: -25 },
		finish: { vignette: 0.24 },
	},

	/* ---------------------------------------------------------------- mono */
	{
		id: 'mono-neutral',
		name: 'Mono Neutral',
		family: 'mono',
		blurb: 'A straight, well-behaved black and white conversion.',
		recipe: { mono: 1, monoTint: '#ffffff', contrast: 1.1 },
	},
	{
		id: 'mono-high-key',
		name: 'High Key Mono',
		family: 'mono',
		blurb: 'Bright, airy monochrome with almost no true black.',
		recipe: { mono: 1, monoTint: '#ffffff', exposure: 0.3, contrast: 0.86, fade: 0.14, shoulder: 0.6 },
		finish: { bloom: 0.2 },
	},
	{
		id: 'mono-hard',
		name: 'Hard Mono',
		family: 'mono',
		blurb: 'Graphic, poster-like contrast with crushed blacks.',
		recipe: { mono: 1, monoTint: '#ffffff', contrast: 1.7, shoulder: 0.1 },
		finish: { vignette: 0.3 },
	},
	{
		id: 'mono-warm',
		name: 'Warm Mono',
		family: 'mono',
		blurb: 'Selenium-warm monochrome - brown-black rather than neutral.',
		recipe: { mono: 1, monoTint: '#f7e4cc', contrast: 1.16 },
		finish: { grain: 0.2 },
	},
	{
		id: 'mono-cool',
		name: 'Cool Mono',
		family: 'mono',
		blurb: 'Blue-toned monochrome, the way a cyanotype print reads.',
		recipe: { mono: 1, monoTint: '#d6e6ff', contrast: 1.18 },
		finish: { grain: 0.18 },
	},

	/* ------------------------------------------------------------- utility */
	{
		id: 'log-to-rec709',
		name: 'Log to Rec.709',
		family: 'utility',
		blurb: 'Puts contrast and colour back into flat log or D-Cinelike footage.',
		recipe: { contrast: 1.42, saturation: 1.32, gamma: [0.92, 0.92, 0.92], shoulder: 0.5 },
	},
	{
		id: 'flatten-log',
		name: 'Flatten (Log-like)',
		family: 'utility',
		blurb: 'The opposite: pulls a graded clip flat so it can be regraded.',
		recipe: { contrast: 0.72, saturation: 0.74, fade: 0.12, shoulder: 0.8 },
	},
	{
		id: 'hdr-punch',
		name: 'HDR Punch',
		family: 'utility',
		blurb: 'Strong contrast lift with the highlights held back from clipping.',
		recipe: { contrast: 1.34, saturation: 1.16, gamma: [0.94, 0.94, 0.94], shoulder: 0.65 },
		finish: { bloom: 0.12 },
	},
	{
		id: 'skin-safe',
		name: 'Skin Safe',
		family: 'utility',
		blurb: 'Adds contrast and colour where it helps, and leaves skin alone.',
		recipe: { contrast: 1.14, saturation: 0.98, vibrance: 0.2, temperature: 0.05, shoulder: 0.5 },
	},
	{
		id: 'broadcast-safe',
		name: 'Broadcast Safe',
		family: 'utility',
		blurb: 'Pulls blacks and whites inside legal range and tames saturation.',
		recipe: { contrast: 0.94, saturation: 0.94, fade: 0.062, shoulder: 0.7 },
	},
	{
		id: 'low-light-rescue',
		name: 'Low-Light Rescue',
		family: 'utility',
		blurb: 'Lifts a dark clip without dragging the colour noise up with it.',
		recipe: { exposure: 0.55, contrast: 1.08, saturation: 0.9, gamma: [0.88, 0.88, 0.88], shoulder: 0.6, fade: 0.03 },
	},
	{
		id: 'screen-recording',
		name: 'Screen Recording',
		family: 'utility',
		blurb: 'Crisper text and truer interface colour for captured screens.',
		recipe: { contrast: 1.16, saturation: 1.06, gain: [1.01, 1.01, 1.02], shoulder: 0.3 },
	},
	{
		id: 'drone-clarity',
		name: 'Drone Clarity',
		family: 'utility',
		blurb: 'Cuts through aerial haze: more contrast, less blue in the distance.',
		recipe: { temperature: 0.08, contrast: 1.28, saturation: 1.18, gain: [1.02, 1, 0.95], gamma: [0.95, 0.96, 1] },
		finish: { vignette: 0.12 },
	},
]

const TONE_BY_ID = new Map(TONES.map((tone) => [tone.id, tone]))

export function toneById(id: string): ToneDef | null {
	return TONE_BY_ID.get(id) ?? null
}

export const DEFAULT_TONE_ID = 'teal-orange'

/* ==========================================================================
   The evaluator.
   ========================================================================== */

function hexToRgb01(hex: string): RGB {
	const clean = hex.replace('#', '')
	const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean.padEnd(6, '0')
	const value = Number.parseInt(full, 16)
	if (!Number.isFinite(value)) return [1, 1, 1]
	return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255]
}

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value)

/**
 * sRGB transfer functions. Exposure, lift, gamma and gain behave like real
 * light only in linear space - doubling exposure should look like doubling
 * the light rather than adding a fixed amount of code value - so those four
 * run there, and everything perceptual (contrast, saturation, tinting) runs
 * back in sRGB where the numbers match what the eye reports.
 */
function srgbToLinear(value: number): number {
	return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
}

function linearToSrgb(value: number): number {
	const v = value < 0 ? 0 : value
	return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
}

const LUMA: RGB = [0.2126, 0.7152, 0.0722]

const luminance = (rgb: RGB): number => rgb[0] * LUMA[0] + rgb[1] * LUMA[1] + rgb[2] * LUMA[2]

/** The same matrix an SVG `hueRotate` filter uses. */
function rotateHue(rgb: RGB, degrees: number): RGB {
	const angle = (degrees * Math.PI) / 180
	const cos = Math.cos(angle)
	const sin = Math.sin(angle)
	const m = [
		0.213 + cos * 0.787 - sin * 0.213,
		0.715 - cos * 0.715 - sin * 0.715,
		0.072 - cos * 0.072 + sin * 0.928,
		0.213 - cos * 0.213 + sin * 0.143,
		0.715 + cos * 0.285 + sin * 0.14,
		0.072 - cos * 0.072 - sin * 0.283,
		0.213 - cos * 0.213 - sin * 0.787,
		0.715 - cos * 0.715 + sin * 0.715,
		0.072 + cos * 0.928 + sin * 0.072,
	]
	return [
		rgb[0] * m[0] + rgb[1] * m[1] + rgb[2] * m[2],
		rgb[0] * m[3] + rgb[1] * m[4] + rgb[2] * m[5],
		rgb[0] * m[6] + rgb[1] * m[7] + rgb[2] * m[8],
	]
}

/** The one place a look is turned into colour. Input and output are sRGB 0-1. */
export function evaluateTone(input: RGB, recipe: ToneRecipe): RGB {
	let rgb: RGB = [clamp01(input[0]), clamp01(input[1]), clamp01(input[2])]

	/* ---- white balance: a per-channel gain either way, so sRGB is fine ---- */
	const temperature = recipe.temperature ?? 0
	const tint = recipe.tint ?? 0
	if (temperature !== 0 || tint !== 0) {
		rgb = [
			rgb[0] * (1 + 0.19 * temperature + 0.06 * tint),
			rgb[1] * (1 - 0.03 * temperature - 0.13 * tint),
			rgb[2] * (1 - 0.19 * temperature + 0.06 * tint),
		]
	}

	/* ---- exposure, gain, lift and gamma, in linear light ---- */
	const exposure = recipe.exposure ?? 0
	const { lift, gamma, gain } = recipe
	if (exposure !== 0 || lift || gamma || gain) {
		const scale = Math.pow(2, exposure)
		const linear: RGB = [srgbToLinear(rgb[0]) * scale, srgbToLinear(rgb[1]) * scale, srgbToLinear(rgb[2]) * scale]
		for (let c = 0; c < 3; c++) {
			let value = linear[c]
			if (gain) value *= gain[c]
			if (lift) value += lift[c] * (1 - value)
			if (gamma && gamma[c] !== 1) value = Math.pow(Math.max(value, 0), gamma[c])
			linear[c] = value
		}
		rgb = [linearToSrgb(linear[0]), linearToSrgb(linear[1]), linearToSrgb(linear[2])]
	}

	/* ---- contrast around a pivot ---- */
	const contrast = recipe.contrast ?? 1
	if (contrast !== 1) {
		const pivot = recipe.pivot ?? 0.435
		rgb = [(rgb[0] - pivot) * contrast + pivot, (rgb[1] - pivot) * contrast + pivot, (rgb[2] - pivot) * contrast + pivot]
	}

	/* ---- saturation, then vibrance on whatever is still dull ---- */
	const saturation = recipe.saturation ?? 1
	if (saturation !== 1) {
		const luma = luminance(rgb)
		rgb = [luma + (rgb[0] - luma) * saturation, luma + (rgb[1] - luma) * saturation, luma + (rgb[2] - luma) * saturation]
	}
	const vibrance = recipe.vibrance ?? 0
	if (vibrance !== 0) {
		const max = Math.max(rgb[0], rgb[1], rgb[2])
		const min = Math.min(rgb[0], rgb[1], rgb[2])
		const current = max <= 0 ? 0 : (max - min) / max
		const boost = 1 + vibrance * (1 - clamp01(current))
		const luma = luminance(rgb)
		rgb = [luma + (rgb[0] - luma) * boost, luma + (rgb[1] - luma) * boost, luma + (rgb[2] - luma) * boost]
	}

	/* ---- split toning: shadows one way, highlights the other ---- */
	const shadowStrength = recipe.shadowStrength ?? 0
	if (shadowStrength > 0 && recipe.shadowTint) {
		const tintRgb = hexToRgb01(recipe.shadowTint)
		const weight = shadowStrength * Math.pow(1 - clamp01(luminance(rgb)), 2)
		rgb = [rgb[0] + (tintRgb[0] - 0.5) * weight, rgb[1] + (tintRgb[1] - 0.5) * weight, rgb[2] + (tintRgb[2] - 0.5) * weight]
	}
	const highlightStrength = recipe.highlightStrength ?? 0
	if (highlightStrength > 0 && recipe.highlightTint) {
		const tintRgb = hexToRgb01(recipe.highlightTint)
		const weight = highlightStrength * Math.pow(clamp01(luminance(rgb)), 2)
		rgb = [rgb[0] + (tintRgb[0] - 0.5) * weight, rgb[1] + (tintRgb[1] - 0.5) * weight, rgb[2] + (tintRgb[2] - 0.5) * weight]
	}

	if (recipe.hueShift) rgb = rotateHue(rgb, recipe.hueShift)

	/* ---- monochrome mix ---- */
	const mono = recipe.mono ?? 0
	if (mono > 0) {
		const luma = clamp01(luminance(rgb))
		const tintRgb = recipe.monoTint ? hexToRgb01(recipe.monoTint) : ([1, 1, 1] as RGB)
		rgb = [
			rgb[0] * (1 - mono) + luma * tintRgb[0] * mono,
			rgb[1] * (1 - mono) + luma * tintRgb[1] * mono,
			rgb[2] * (1 - mono) + luma * tintRgb[2] * mono,
		]
	}

	/* ---- highlight shoulder, then the black lift, last of all ---- */
	const shoulder = recipe.shoulder ?? 0
	if (shoulder > 0) {
		const k = shoulder * 0.9
		rgb = [
			(rgb[0] * (1 + k)) / (1 + k * Math.max(rgb[0], 0)),
			(rgb[1] * (1 + k)) / (1 + k * Math.max(rgb[1], 0)),
			(rgb[2] * (1 + k)) / (1 + k * Math.max(rgb[2], 0)),
		]
	}
	const fade = recipe.fade ?? 0
	if (fade !== 0) {
		rgb = [fade + rgb[0] * (1 - fade * 0.62), fade + rgb[1] * (1 - fade * 0.62), fade + rgb[2] * (1 - fade * 0.62)]
	}

	return [clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2])]
}

/* ==========================================================================
   Trims, and baking.
   ========================================================================== */

export type ToneTrim = {
	/** extra warmth, -1 to 1, on top of whatever the look already does */
	warmth?: number
	/** extra exposure in stops, -1 to 1 */
	exposure?: number
	/** extra saturation, -1 (grey) to 1 (double) */
	saturation?: number
	/** extra contrast, -1 to 1 */
	contrast?: number
}

/** Folds the trim sliders into a look, so the two bake into one cube. */
export function trimRecipe(recipe: ToneRecipe, trim: ToneTrim): ToneRecipe {
	const next: ToneRecipe = { ...recipe }
	if (trim.warmth) next.temperature = (recipe.temperature ?? 0) + trim.warmth * 0.4
	if (trim.exposure) next.exposure = (recipe.exposure ?? 0) + trim.exposure
	if (trim.saturation) next.saturation = Math.max(0, (recipe.saturation ?? 1) * (1 + trim.saturation))
	if (trim.contrast) next.contrast = Math.max(0.2, (recipe.contrast ?? 1) * (1 + trim.contrast * 0.5))
	return next
}

export type ToneLut = {
	/** cells per axis - 33 is the size every colourist's .cube file uses */
	size: number
	/** RGB8, ordered red fastest, then green, then blue */
	data: Uint8Array
}

export const DEFAULT_LUT_SIZE = 33

/**
 * Turns a recipe into a cube. 33^3 is 35,937 evaluations - roughly a
 * millisecond - and it happens once per render, not once per frame.
 */
export function bakeToneLut(recipe: ToneRecipe, size: number = DEFAULT_LUT_SIZE): ToneLut {
	const data = new Uint8Array(size * size * size * 3)
	const step = 1 / (size - 1)
	let index = 0
	for (let b = 0; b < size; b++) {
		for (let g = 0; g < size; g++) {
			for (let r = 0; r < size; r++) {
				const out = evaluateTone([r * step, g * step, b * step], recipe)
				data[index++] = Math.round(out[0] * 255)
				data[index++] = Math.round(out[1] * 255)
				data[index++] = Math.round(out[2] * 255)
			}
		}
	}
	return { size, data }
}

/**
 * Trilinear lookup, for the CPU fallback and for the picker's thumbnails -
 * the same interpolation the GPU does in hardware, written out.
 */
export function sampleToneLut(lut: ToneLut, r: number, g: number, b: number): RGB {
	const { size, data } = lut
	const max = size - 1
	const x = clamp01(r) * max
	const y = clamp01(g) * max
	const z = clamp01(b) * max
	const x0 = Math.floor(x)
	const y0 = Math.floor(y)
	const z0 = Math.floor(z)
	const x1 = Math.min(max, x0 + 1)
	const y1 = Math.min(max, y0 + 1)
	const z1 = Math.min(max, z0 + 1)
	const fx = x - x0
	const fy = y - y0
	const fz = z - z0

	const at = (xi: number, yi: number, zi: number, channel: number): number => data[((zi * size + yi) * size + xi) * 3 + channel]

	const out: RGB = [0, 0, 0]
	for (let c = 0; c < 3; c++) {
		const c00 = at(x0, y0, z0, c) * (1 - fx) + at(x1, y0, z0, c) * fx
		const c10 = at(x0, y1, z0, c) * (1 - fx) + at(x1, y1, z0, c) * fx
		const c01 = at(x0, y0, z1, c) * (1 - fx) + at(x1, y0, z1, c) * fx
		const c11 = at(x0, y1, z1, c) * (1 - fx) + at(x1, y1, z1, c) * fx
		const c0 = c00 * (1 - fy) + c10 * fy
		const c1 = c01 * (1 - fy) + c11 * fy
		out[c] = (c0 * (1 - fz) + c1 * fz) / 255
	}
	return out
}

/**
 * Applies a baked cube to pixels in place, mixed against the original by
 * `strength`. Used by the CPU fallback and by the tone picker's thumbnails,
 * which are far too small for a GPU pass to be worth setting up.
 */
export function applyToneLutToImageData(image: ImageData, lut: ToneLut, strength = 1): void {
	const data = image.data
	const mix = clamp01(strength)
	for (let i = 0; i < data.length; i += 4) {
		const out = sampleToneLut(lut, data[i] / 255, data[i + 1] / 255, data[i + 2] / 255)
		data[i] = data[i] * (1 - mix) + out[0] * 255 * mix
		data[i + 1] = data[i + 1] * (1 - mix) + out[1] * 255 * mix
		data[i + 2] = data[i + 2] * (1 - mix) + out[2] * 255 * mix
	}
}

/** A look's finishing pass, with the user's own additions folded in. */
export function resolveFinish(tone: ToneDef, extra: ToneFinish, strength: number): Required<ToneFinish> {
	const base = tone.finish ?? {}
	const scale = clamp01(strength)
	return {
		grain: clamp01((base.grain ?? 0) * scale + (extra.grain ?? 0)),
		grainSize: extra.grainSize ?? base.grainSize ?? 1.6,
		vignette: clamp01((base.vignette ?? 0) * scale + (extra.vignette ?? 0)),
		bloom: clamp01((base.bloom ?? 0) * scale + (extra.bloom ?? 0)),
		halation: clamp01((base.halation ?? 0) * scale + (extra.halation ?? 0)),
		softness: clamp01((base.softness ?? 0) * scale + (extra.softness ?? 0)),
		chroma: clamp01((base.chroma ?? 0) * scale + (extra.chroma ?? 0)),
	}
}
