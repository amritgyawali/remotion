import { IconCaptions, IconFile, IconFilm, IconLayers, IconScissors, IconTools } from './Icons'

export type StudioId = 'video' | 'captions' | 'silence' | 'tools' | 'editor' | 'resume'

const STUDIOS: Array<{
	id: StudioId
	href: string
	label: string
	title: string
	icon: typeof IconFilm
}> = [
	{
		id: 'video',
		href: '/',
		label: 'Video',
		title: 'Describe a video and render it',
		icon: IconFilm,
	},
	{
		id: 'captions',
		href: '/captions',
		label: 'Subtitles',
		title: 'Transcribe a video and burn in styled captions',
		icon: IconCaptions,
	},
	{
		id: 'silence',
		href: '/silence',
		label: 'Silence',
		title: 'Find the dead air in a video and cut it or run it fast',
		icon: IconScissors,
	},
	{
		id: 'tools',
		href: '/tools',
		label: 'Tools',
		title: '50+ editing tools: mono to stereo, trim, rotate, watermark and more',
		icon: IconTools,
	},
	{
		id: 'editor',
		href: '/editor',
		label: 'Editor',
		title: 'A full multi-track timeline editor: layers, effects, text, keyframes and export - all local',
		icon: IconLayers,
	},
	{
		id: 'resume',
		href: '/resume',
		label: 'Resume',
		title: 'Write and audit an ATS-friendly resume',
		icon: IconFile,
	},
]

/**
 * The one navigation shared by all three studios.
 *
 * Plain anchors, not next/link, and that is deliberate: /captions is served with
 * cross-origin isolation headers so the on-device speech model can run, and a
 * client-side navigation would keep the previous document's headers instead.
 */
export default function StudioNav({ current }: { current: StudioId }) {
	return (
		<nav className="studio-nav" aria-label="Studios">
			{STUDIOS.map((studio) => {
				const Icon = studio.icon
				const active = studio.id === current
				return (
					<a
						key={studio.id}
						href={studio.href}
						title={studio.title}
						aria-current={active ? 'page' : undefined}
					>
						<Icon size={14} />
						<span className="studio-nav-label">{studio.label}</span>
					</a>
				)
			})}
		</nav>
	)
}
