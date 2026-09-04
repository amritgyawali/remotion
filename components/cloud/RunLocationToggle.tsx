'use client'

/**
 * The switch that decides whether this machine does the work.
 *
 * It sits in every studio's top bar, in the same place, saying the same thing -
 * because the answer to "where is my video being encoded" should not depend on
 * which page someone happens to be on. Cloud is first and is the default;
 * Local remains an explicit, persistent escape hatch in every section.
 */

import { IconCloud, IconDevice } from '../Icons'
import { describeLimit, type CloudState } from '../../lib/cloud/use-cloud'

export default function RunLocationToggle({
	cloud,
	compact = false,
}: {
	cloud: CloudState
	/** drops the words and keeps the icons, for a crowded phone header */
	compact?: boolean
}) {
	const { location, setLocation, status } = cloud
	const limit = status ? describeLimit(status.maxVideoBytes) : null

	return (
		<div
			className="runloc"
			role="radiogroup"
			aria-label="Where processing runs"
			data-compact={compact || undefined}
		>
			<button
				type="button"
				role="radio"
				aria-checked={location === 'cloud'}
				className="runloc-option"
				data-active={location === 'cloud'}
				disabled={!cloud.probed || !cloud.available}
				onClick={() => setLocation('cloud')}
				title={
					cloud.available && limit
						? `Upload, save, process, and render online with Cloudinary and Supabase - up to ${limit} per video.`
						: cloud.probed
							? 'Cloud is not configured on this deployment.'
							: 'Checking cloud availability'
				}
			>
				<IconCloud size={12} />
				{compact ? null : <span>Cloud</span>}
			</button>
			<button
				type="button"
				role="radio"
				aria-checked={location === 'device'}
				className="runloc-option"
				data-active={location === 'device'}
				onClick={() => setLocation('device')}
				title="Keep files, editing, processing, and rendering on this machine."
			>
				<IconDevice size={12} />
				{compact ? null : <span>Local</span>}
			</button>
		</div>
	)
}

/**
 * A one-line explanation of what the current choice means, for panels that have
 * room for a sentence. Kept next to the switch so the two can never disagree.
 */
export function RunLocationNote({ cloud }: { cloud: CloudState }) {
	if (cloud.probed && !cloud.available) {
		return <p className="runloc-note"><IconDevice size={12} /> Cloud is unavailable on this deployment, so work stays local.</p>
	}
	if (!cloud.status) return null

	if (cloud.location === 'device') {
		return (
			<p className="runloc-note">
				<IconDevice size={12} /> Running here. Nothing is uploaded, and every frame is decoded by
				this browser.
			</p>
		)
	}

	return (
		<p className="runloc-note" data-tone="cloud">
			<IconCloud size={12} /> Running in the cloud. Your file is uploaded to Cloudinary, processed
			there, and only the finished result comes back - up to{' '}
			{describeLimit(cloud.status.maxVideoBytes)} per video.
		</p>
	)
}
