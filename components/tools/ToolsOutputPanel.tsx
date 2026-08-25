'use client'

import { formatBytes } from '../../lib/format'
import type { ToolDef } from '../../lib/tools/registry'
import type { OutputSettings, RunOutput, RunProgress } from '../../lib/tools/runners'
import { IconAlert, IconBolt, IconCaptions, IconCheck, IconDownload, IconInfo, IconScissors, IconSpinner, IconStop } from '../Icons'

const PHASE_LABEL: Record<string, string> = {
	reading: 'Reading the file',
	decoding: 'Decoding audio',
	preparing: 'Setting up the encoder',
	encoding: 'Working through the frames',
	finishing: 'Writing the file',
}

export default function ToolsOutputPanel({
	tool,
	hasVideo,
	webCodecs,
	output,
	onOutput,
	running,
	progress,
	outputs,
	runError,
	sendState,
	onRun,
	onCancel,
	onDownload,
	onSendTo,
}: {
	tool: ToolDef | null
	hasVideo: boolean
	webCodecs: boolean
	output: OutputSettings
	onOutput: (patch: Partial<OutputSettings>) => void
	running: boolean
	progress: RunProgress | null
	outputs: RunOutput[]
	runError: string | null
	sendState: 'idle' | 'sending' | 'sent' | 'failed'
	onRun: () => void
	onCancel: () => void
	onDownload: (index: number) => void
	onSendTo: (target: 'silence' | 'captions') => void
}) {
	const runnable = tool !== null && tool.status === 'ready' && !tool.link
	const showOutputSettings = runnable && tool.outputKind === 'video'
	const ready = runnable && hasVideo && webCodecs

	return (
		<aside className="panel panel--right">
			<div className="panel-scroll">
				{tool ? (
					<div>
						<h2 className="section-label">
							<span>Output</span>
						</h2>

						{showOutputSettings ? (
							<>
								<div className="field">
									<label className="field-label">
										<span>Container</span>
									</label>
									<div className="segmented" role="group" aria-label="Container">
										<button data-active={output.format === 'mp4'} disabled={running} onClick={() => onOutput({ format: 'mp4' })}>
											MP4
										</button>
										<button data-active={output.format === 'webm'} disabled={running} onClick={() => onOutput({ format: 'webm' })}>
											WebM
										</button>
									</div>
									{tool.losslessVideo ? (
										<span className="field-hint">
											The picture is copied byte-for-byte here, so the container only needs to be able to
											hold the source's video codec - if this one can't, the tool will say so and you can
											try the other.
										</span>
									) : null}
								</div>

								{!tool.losslessVideo ? (
									<div className="field">
										<label className="field-label">
											<span>Quality</span>
										</label>
										<div className="segmented" role="group" aria-label="Quality">
											<button data-active={output.quality === 'draft'} disabled={running} onClick={() => onOutput({ quality: 'draft' })}>
												Draft
											</button>
											<button data-active={output.quality === 'high'} disabled={running} onClick={() => onOutput({ quality: 'high' })}>
												High
											</button>
											<button data-active={output.quality === 'max'} disabled={running} onClick={() => onOutput({ quality: 'max' })}>
												Max
											</button>
										</div>
									</div>
								) : null}
							</>
						) : (
							<p className="field-hint">
								{tool.link
									? 'This tool runs in its own studio - use the button on the left to open it.'
									: tool.status === 'soon'
										? "This tool isn't wired up yet."
										: 'This tool exports a plain file with no format choice to make.'}
							</p>
						)}
					</div>
				) : (
					<div className="notice notice--info">
						<span className="notice-icon">
							<IconInfo size={14} />
						</span>
						<span>Pick a tool on the left to see its output settings here.</span>
					</div>
				)}
			</div>

			<div className="panel-actions">
				{runError ? (
					<div className="notice notice--error">
						<span className="notice-icon">
							<IconAlert size={14} />
						</span>
						<span>{runError}</span>
					</div>
				) : null}

				{!webCodecs ? (
					<div className="notice notice--warn">
						<span className="notice-icon">
							<IconAlert size={14} />
						</span>
						<span>This browser has no WebCodecs encoder, so tools can't export here. Chrome or Edge on a desktop will.</span>
					</div>
				) : null}

				{running ? (
					<>
						<div className="progress-track">
							<div className="progress-fill" style={{ width: `${Math.round((progress?.ratio ?? 0) * 100)}%` }} />
						</div>
						<div className="progress-meta">
							<span>{PHASE_LABEL[progress?.phase ?? 'preparing'] ?? 'Working'}</span>
							<span>{Math.round((progress?.ratio ?? 0) * 100)}%</span>
						</div>
						<button className="btn btn--danger btn--block" onClick={onCancel}>
							<IconStop size={13} /> Stop
						</button>
					</>
				) : (
					<button className="btn btn--primary btn--block btn--lg" disabled={!ready} onClick={onRun}>
						{tool ? <tool.icon size={14} /> : <IconBolt size={14} />} Run
					</button>
				)}

				{outputs.length > 0 ? (
					<div className="result">
						<div className="result-title">
							<IconCheck size={14} /> {outputs.length > 1 ? `${outputs.length} files ready` : 'Your file is ready'}
						</div>
						{outputs.map((item, index) => (
							<div key={item.url} style={{ marginTop: index > 0 ? 10 : 0 }}>
								{item.kind === 'video' ? (
									<video className="result-media" src={item.url} controls playsInline />
								) : item.kind === 'image' ? (
									// eslint-disable-next-line @next/next/no-img-element
									<img src={item.url} alt="Extracted frame" className="result-media" />
								) : (
									<audio src={item.url} controls style={{ width: '100%' }} />
								)}
								<div className="result-meta">
									<span title={item.name}>{item.name}</span>
									<span>{formatBytes(item.sizeInBytes)}</span>
								</div>
								<button className="btn btn--block" onClick={() => onDownload(index)}>
									<IconDownload size={13} /> Download{outputs.length > 1 ? ` #${index + 1}` : ''}
								</button>
							</div>
						))}

						{outputs[0]?.kind === 'video' ? (
							<div className="card-actions" style={{ marginTop: 12, flexWrap: 'wrap' }}>
								<button className="btn btn--ghost btn--sm" disabled={sendState === 'sending'} onClick={() => onSendTo('silence')}>
									{sendState === 'sending' ? <IconSpinner size={12} className="spin" /> : <IconScissors size={12} />}
									Send to Silence Studio
								</button>
								<button className="btn btn--ghost btn--sm" disabled={sendState === 'sending'} onClick={() => onSendTo('captions')}>
									{sendState === 'sending' ? <IconSpinner size={12} className="spin" /> : <IconCaptions size={12} />}
									Send to Subtitle Studio
								</button>
							</div>
						) : null}
						{sendState === 'sent' ? (
							<div className="notice notice--success" style={{ marginTop: 10 }}>
								<span className="notice-icon">
									<IconCheck size={14} />
								</span>
								<span>Sent - open the other studio to pick it up.</span>
							</div>
						) : sendState === 'failed' ? (
							<div className="notice notice--error" style={{ marginTop: 10 }}>
								<span className="notice-icon">
									<IconAlert size={14} />
								</span>
								<span>The browser refused to store the hand-off. Download the file and upload it there instead.</span>
							</div>
						) : null}
					</div>
				) : null}
			</div>
		</aside>
	)
}
