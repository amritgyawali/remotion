'use client'

/**
 * Putting copied packets onto a timeline a muxer will accept.
 *
 * Several exports here copy encoded packets straight from the source into the
 * output rather than decoding them - the visual filters leave the audio alone,
 * and the remuxer leaves both tracks alone. That is the cheapest and most
 * faithful thing to do, and it works until the source's own timestamps start
 * below zero, at which point the muxer refuses the whole export:
 *
 *     Timestamps must be non-negative (got -0.044s).
 *
 * Which is not an edge case. It is what almost every camera, phone and editor
 * writes: **an AAC encoder needs priming samples**, and the file records them
 * by giving the first packets negative presentation times so a player knows to
 * decode but not play them. 2112 samples at 48 kHz is exactly the -0.044s in
 * that message; 1024 samples is -0.021s. Opus does the same thing with its
 * pre-skip. A studio that cannot bake an ordinary MP4 is not much of a studio,
 * so this file is the one place that decides what a negative timestamp means.
 *
 * Three rules, and the order matters:
 *
 * - **A packet that is over before zero is dropped.** Its samples are priming:
 *   the decoder consumes them and presents none of them, and the container has
 *   no way to say "decode this but do not show it" that survives a re-mux. It
 *   is not audio anybody has ever heard.
 *
 * - **A packet that straddles zero starts at zero, and loses the part that
 *   was before it.** The audible part keeps the instant it was always going to
 *   play at, which is the property that matters: subtitles, objects and cuts
 *   are all timed against a clock that starts at zero, and shifting the track
 *   to preserve a few milliseconds of priming would push every one of them out
 *   of sync by that much.
 *
 * - **Nothing else is touched.** A packet already at or after zero is passed
 *   through unchanged, byte for byte and timestamp for timestamp, so a normal
 *   file re-muxes exactly as it did before this file existed.
 *
 * There is one repair of last resort. A muxer also refuses a packet that goes
 * backwards past the end of the previous group of pictures, which a damaged
 * file can contain; rather than fail the export, such a packet is nudged
 * forward to the earliest instant that is legal. It is reported in the stats,
 * because a silent repair that nobody counts is a silent corruption.
 *
 * Everything here is a pure function of the timings it is given - no packets,
 * no muxer, no browser - so the whole policy is checked offline.
 */

/** The parts of an encoded packet that decide where it can go. */
export type PacketTiming = {
	/** presentation time in seconds; may be negative in a well-formed file */
	timestamp: number
	/** length in seconds; 0 when the container does not say */
	duration: number
	type: 'key' | 'delta'
}

export type PacketPlacement =
	| { action: 'keep' }
	| { action: 'retime'; timestamp: number; duration: number }
	| { action: 'drop'; reason: DropReason }

export type DropReason =
	/** every sample in it is priming - it is presented nowhere */
	| 'before-zero'
	/** a stream cannot open on a delta packet, and nothing has been written yet */
	| 'no-key-yet'
	/** the timing is not a number this can reason about */
	| 'unusable'

export type PacketRetimerStats = {
	/** packets passed through untouched */
	kept: number
	/** packets whose start or length had to change */
	retimed: number
	dropped: number
	/** how much media was cut from the head of the track, in seconds */
	trimmedSeconds: number
	/** packets nudged forward to keep the muxer's ordering rule */
	reordered: number
}

/**
 * Timestamps this close to zero are zero.
 *
 * A container that stores time as a rational against a 48 kHz or 90 kHz clock
 * lands on -1e-16 where it meant 0, and treating that as "before zero" would
 * throw away a packet over a rounding error.
 */
const EPSILON = 1e-9

export type PacketRetimerOptions = {
	/**
	 * What kind of track this is, which decides whether a packet may be dropped.
	 *
	 * An audio packet stands alone: nothing later decodes through it, so one
	 * that is presented nowhere can simply go. A video packet is usually the
	 * opposite - later frames are differences against it - so a video packet
	 * that starts before zero is pulled up to zero and kept, whatever it costs
	 * in duplicate timestamps. Dropping it could take a whole group of pictures
	 * with it, and a corrupt picture is a worse answer than a frame shown a
	 * few milliseconds early.
	 *
	 * Defaults to `audio`, which is the track that actually needs this.
	 */
	track?: 'audio' | 'video'
}

/**
 * Decides where each copied packet goes, in order.
 *
 * Stateful because two of the three rules are about the packets that came
 * before: whether anything has been written yet, and how far the timeline has
 * already got. One retimer per track.
 */
export function createPacketRetimer(options: PacketRetimerOptions = {}): {
	place(packet: PacketTiming): PacketPlacement
	stats(): PacketRetimerStats
} {
	const mayDrop = (options.track ?? 'audio') === 'audio'
	let kept = 0
	let retimed = 0
	let dropped = 0
	let reordered = 0
	let trimmedSeconds = 0

	let written = false
	/** the latest timestamp written so far */
	let maxTimestamp = 0
	/**
	 * The highest timestamp written before the most recent key packet.
	 *
	 * This mirrors the muxer's own rule exactly: presentation order may go
	 * backwards *within* a group of pictures - that is what B-frames are - but
	 * never behind the group before it. Tracking the same number here means a
	 * legal reordering is never "repaired" into a wrong one.
	 */
	let maxBeforeLastKey: number | null = null

	const record = (timestamp: number) => {
		if (!written) {
			written = true
			maxTimestamp = timestamp
			maxBeforeLastKey = null
			return
		}
		maxTimestamp = Math.max(maxTimestamp, timestamp)
	}

	return {
		place(packet: PacketTiming): PacketPlacement {
			const isKey = packet.type === 'key'

			if (!Number.isFinite(packet.timestamp) || !Number.isFinite(packet.duration)) {
				dropped++
				return { action: 'drop', reason: 'unusable' }
			}

			// A container that does not state a duration says nothing about where
			// the packet ends, so it is judged on its start alone.
			const hasDuration = packet.duration > 0
			const end = hasDuration ? packet.timestamp + packet.duration : packet.timestamp

			if (mayDrop && packet.timestamp < -EPSILON && end <= EPSILON) {
				dropped++
				if (hasDuration) trimmedSeconds += packet.duration
				else trimmedSeconds += -packet.timestamp
				return { action: 'drop', reason: 'before-zero' }
			}

			if (!written && !isKey) {
				// Nothing has been written and this cannot open a stream. Dropping it
				// is the only option that produces a playable file; the alternative is
				// the muxer's own "First packet must be a key packet".
				dropped++
				return { action: 'drop', reason: 'no-key-yet' }
			}

			let timestamp = packet.timestamp
			let duration = packet.duration
			let changed = false

			if (timestamp < 0) {
				// Straddles zero: keep the part that plays, lose the part that never
				// could. `end` is where it always ended, and that does not move.
				trimmedSeconds += -timestamp
				duration = hasDuration ? Math.max(0, end) : duration
				timestamp = 0
				changed = true
			}

			// A key packet closes the group before it, in that order: the muxer
			// promotes the boundary the moment the key packet arrives and then judges
			// that same packet against it, so doing it afterwards here would let
			// through exactly the packet the muxer is about to refuse.
			if (written && isKey) maxBeforeLastKey = maxTimestamp

			const floor = maxBeforeLastKey
			if (written && floor !== null && timestamp < floor) {
				// The source went backwards past the previous group of pictures. Every
				// container refuses this, so the packet is nudged to the earliest legal
				// instant rather than the export being abandoned.
				timestamp = floor
				changed = true
				reordered++
			}

			record(timestamp)

			if (!changed) {
				kept++
				return { action: 'keep' }
			}
			retimed++
			return { action: 'retime', timestamp, duration }
		},

		stats(): PacketRetimerStats {
			return { kept, retimed, dropped, trimmedSeconds, reordered }
		},
	}
}

/** One line for a log or a note, or null when nothing had to be changed. */
export function describePacketRetiming(stats: PacketRetimerStats): string | null {
	if (stats.retimed === 0 && stats.dropped === 0) return null
	const parts: string[] = []
	if (stats.trimmedSeconds > 0) {
		parts.push(`trimmed ${Math.round(stats.trimmedSeconds * 1000)} ms of encoder priming from the head`)
	}
	if (stats.dropped > 0) parts.push(`${stats.dropped} packet${stats.dropped === 1 ? '' : 's'} dropped`)
	if (stats.reordered > 0) parts.push(`${stats.reordered} nudged back into order`)
	return parts.join(', ') || null
}
