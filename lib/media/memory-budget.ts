'use client'

/**
 * How much the machine can actually be asked for.
 *
 * Every expensive thing in the studio - the segmentation model, the sprite
 * raster, the frames held between decode and encode - was sized for a
 * developer's laptop, and the sizes were written as constants. On a machine
 * with eight gigabytes of RAM shared with the compositor, the browser and
 * whatever else is open, those constants are not a budget: they are the reason
 * a bake takes the whole system down rather than failing politely.
 *
 * So the constants become a function of the machine.
 *
 * `navigator.deviceMemory` is the signal that matters, and it is deliberately
 * coarse: the spec rounds the real figure down to a power of two and clamps it
 * to the range 0.25 to 8, so a machine with 7.8 GB reports 4, not 8. That
 * rounding is a feature here - it is exactly the conservative direction - and
 * it is why the tiers are cut where they are rather than at round numbers of
 * gigabytes.
 *
 * Two rules govern everything below.
 *
 * **Nothing here changes what the viewer sees.** The caps are on intermediate
 * buffers - how large a picture is rasterised before it is scaled to its final
 * size, how many of them are kept warm, which device the model runs on. The
 * output resolution the person asked for is theirs, and silently shrinking it
 * to avoid a crash would trade a failure they can see for a disappointment
 * they cannot.
 *
 * **An unknown machine is treated as a middling one, not a large one.** A
 * browser that does not implement `deviceMemory` - every Firefox and Safari -
 * gets the modest tier, which is smaller than the constants this replaced.
 * Guessing high is how the crash happened in the first place.
 */

/** What size of machine this is, as far as anything can tell from inside a tab. */
export type MemoryTier = 'tight' | 'modest' | 'roomy'

export type MemoryBudget = {
	tier: MemoryTier
	/** `navigator.deviceMemory` in GB, or null where the browser withholds it */
	deviceMemoryGb: number | null
	/** V8's ceiling for this tab in bytes, where the browser exposes it */
	heapLimitBytes: number | null
	/** the longest side a sprite is rasterised at before it is drawn */
	maxSpritePixels: number
	/** how many rasterised sprites stay in memory at once */
	maxLiveSprites: number
	/**
	 * True when the segmentation model should be asked for the CPU delegate.
	 *
	 * On a machine with discrete graphics the GPU delegate is free speed. On the
	 * integrated graphics that a tight machine almost always has, the model's
	 * textures come out of the same pool as the decoder's frames and the
	 * compositor's surfaces - so the delegate that is meant to save time is
	 * competing for the exact memory that is about to run out.
	 */
	preferCpuSegmentation: boolean
	/**
	 * A suggested ceiling on output pixels per frame, for a caller that wants to
	 * warn before a bake rather than fail during one. Nothing applies this
	 * silently.
	 */
	suggestedRenderPixels: number
}

/** The tiers, in one place, so the numbers can be read against each other. */
const TIERS: Record<MemoryTier, Omit<MemoryBudget, 'tier' | 'deviceMemoryGb' | 'heapLimitBytes'>> = {
	tight: {
		maxSpritePixels: 1_024,
		maxLiveSprites: 2,
		preferCpuSegmentation: true,
		suggestedRenderPixels: 1_280 * 720,
	},
	modest: {
		maxSpritePixels: 1_536,
		maxLiveSprites: 3,
		preferCpuSegmentation: false,
		suggestedRenderPixels: 1_920 * 1_080,
	},
	roomy: {
		maxSpritePixels: 2_048,
		maxLiveSprites: 3,
		preferCpuSegmentation: false,
		suggestedRenderPixels: 3_840 * 2_160,
	},
}

type MemoryNavigator = Navigator & { deviceMemory?: number }
type HeapPerformance = Performance & { memory?: { jsHeapSizeLimit?: number; usedJSHeapSize?: number } }

function readDeviceMemory(): number | null {
	if (typeof navigator === 'undefined') return null
	const reported = (navigator as MemoryNavigator).deviceMemory
	return typeof reported === 'number' && Number.isFinite(reported) && reported > 0 ? reported : null
}

function readHeapLimit(): number | null {
	if (typeof performance === 'undefined') return null
	const limit = (performance as HeapPerformance).memory?.jsHeapSizeLimit
	return typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? limit : null
}

/**
 * Picks the tier.
 *
 * `deviceMemory` decides it where it exists, because it describes the machine
 * rather than the tab. The heap ceiling is the fallback and not the other way
 * round: Chrome reports roughly four gigabytes on any 64-bit desktop whatever
 * the machine has, so it separates a phone from a laptop and nothing finer.
 */
export function memoryTier(deviceMemoryGb: number | null, heapLimitBytes: number | null): MemoryTier {
	if (deviceMemoryGb !== null) {
		if (deviceMemoryGb <= 4) return 'tight'
		if (deviceMemoryGb < 8) return 'modest'
		return 'roomy'
	}
	if (heapLimitBytes !== null && heapLimitBytes < 1_500 * 1024 * 1024) return 'tight'
	return 'modest'
}

/**
 * What this machine may be asked for. Cheap enough to call per bake; not so
 * cheap that it belongs in a per-frame loop.
 */
export function memoryBudget(): MemoryBudget {
	const deviceMemoryGb = readDeviceMemory()
	const heapLimitBytes = readHeapLimit()
	const tier = memoryTier(deviceMemoryGb, heapLimitBytes)
	return { tier, deviceMemoryGb, heapLimitBytes, ...TIERS[tier] }
}

/** One line about the machine, for a report that would otherwise just say "slow". */
export function describeMemoryBudget(budget: MemoryBudget): string {
	const machine =
		budget.deviceMemoryGb !== null
			? `${budget.deviceMemoryGb} GB of memory`
			: 'an unknown amount of memory'
	if (budget.tier === 'tight') {
		return `${machine}, so pictures were rasterised smaller and the model ran on the processor`
	}
	if (budget.tier === 'roomy') return `${machine}, so nothing was held back`
	return `${machine}, so pictures were rasterised at a middling size`
}
