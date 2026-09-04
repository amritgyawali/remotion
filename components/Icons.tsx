import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Base({ size = 16, children, ...rest }: IconProps) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth={1.8}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
			{...rest}
		>
			{children}
		</svg>
	)
}

export const IconLogo = (props: IconProps) => (
	<Base {...props} strokeWidth={2}>
		<path d="m8 7 8 5-8 5V7Z" fill="currentColor" stroke="none" />
	</Base>
)

export const IconUpload = (props: IconProps) => (
	<Base {...props}>
		<path d="M12 16V4" />
		<path d="m7 9 5-5 5 5" />
		<path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
	</Base>
)

export const IconFile = (props: IconProps) => (
	<Base {...props}>
		<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
		<path d="M14 3v5h5" />
	</Base>
)

export const IconFilm = (props: IconProps) => (
	<Base {...props}>
		<rect x="3" y="4" width="18" height="16" rx="2" />
		<path d="M7 4v16M17 4v16M3 12h18M3 8h4M3 16h4M17 8h4M17 16h4" />
	</Base>
)

export const IconPlay = (props: IconProps) => (
	<Base {...props}>
		<path d="M8 5.5 19 12 8 18.5v-13Z" fill="currentColor" stroke="none" />
	</Base>
)

export const IconVolume = (props: IconProps) => (
	<Base {...props}>
		<path d="M4 10h4l5-4v12l-5-4H4v-4Z" />
		<path d="M16 9.5a4 4 0 0 1 0 5M18.5 7a7 7 0 0 1 0 10" />
	</Base>
)

export const IconVolumeOff = (props: IconProps) => (
	<Base {...props}>
		<path d="M4 10h4l5-4v12l-5-4H4v-4Z" />
		<path d="m17 10 4 4m0-4-4 4" />
	</Base>
)

export const IconDownload = (props: IconProps) => (
	<Base {...props}>
		<path d="M12 4v12" />
		<path d="m7 11 5 5 5-5" />
		<path d="M4 20h16" />
	</Base>
)

export const IconBolt = (props: IconProps) => (
	<Base {...props}>
		<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
	</Base>
)

export const IconServer = (props: IconProps) => (
	<Base {...props}>
		<rect x="3" y="4" width="18" height="7" rx="2" />
		<rect x="3" y="13" width="18" height="7" rx="2" />
		<path d="M7 7.5h.01M7 16.5h.01" />
	</Base>
)

export const IconBrowser = (props: IconProps) => (
	<Base {...props}>
		<rect x="3" y="4" width="18" height="16" rx="2" />
		<path d="M3 9h18" />
		<path d="M6.5 6.5h.01M9.5 6.5h.01" />
	</Base>
)

export const IconCheck = (props: IconProps) => (
	<Base {...props}>
		<path d="m5 13 4 4 10-10" />
	</Base>
)

export const IconAlert = (props: IconProps) => (
	<Base {...props}>
		<path d="M12 3 2.5 20h19L12 3Z" />
		<path d="M12 9v5M12 17.5h.01" />
	</Base>
)

export const IconInfo = (props: IconProps) => (
	<Base {...props}>
		<circle cx="12" cy="12" r="9" />
		<path d="M12 11v5M12 8h.01" />
	</Base>
)

export const IconTrash = (props: IconProps) => (
	<Base {...props}>
		<path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
	</Base>
)

export const IconStop = (props: IconProps) => (
	<Base {...props}>
		<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
	</Base>
)

export const IconSpinner = (props: IconProps) => (
	<Base {...props} className={`spin ${props.className ?? ''}`.trim()}>
		<path d="M12 3a9 9 0 1 0 9 9" />
	</Base>
)

export const IconSparkle = (props: IconProps) => (
	<Base {...props}>
		<path d="M12 3.5 13.9 9l5.6 2-5.6 2-1.9 5.5L10.1 13 4.5 11l5.6-2L12 3.5Z" />
	</Base>
)

export const IconCopy = (props: IconProps) => (
	<Base {...props}>
		<rect x="9" y="9" width="12" height="12" rx="2" />
		<path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
	</Base>
)

export const IconGrid = (props: IconProps) => (
	<Base {...props}>
		<rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
		<rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
		<rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
		<rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
	</Base>
)

export const IconCaptions = (props: IconProps) => (
	<Base {...props}>
		<rect x="2.5" y="5" width="19" height="14" rx="2.5" />
		<path d="M9.5 10.2a2.6 2.6 0 1 0 0 3.6" />
		<path d="M16.5 10.2a2.6 2.6 0 1 0 0 3.6" />
	</Base>
)

export const IconMic = (props: IconProps) => (
	<Base {...props}>
		<rect x="9" y="2.5" width="6" height="11" rx="3" />
		<path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
		<path d="M12 17.5V21" />
	</Base>
)

export const IconWand = (props: IconProps) => (
	<Base {...props}>
		<path d="m4 20 10-10" />
		<path d="m14.5 3.5 1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1 1-2.5Z" />
		<path d="m19 14 .7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z" />
	</Base>
)

export const IconScissors = (props: IconProps) => (
	<Base {...props}>
		<circle cx="6" cy="6" r="2.5" />
		<circle cx="6" cy="18" r="2.5" />
		<path d="M8 7.5 20 18" />
		<path d="M8 16.5 20 6" />
	</Base>
)

export const IconPlus = (props: IconProps) => (
	<Base {...props}>
		<path d="M12 5v14" />
		<path d="M5 12h14" />
	</Base>
)

export const IconMerge = (props: IconProps) => (
	<Base {...props}>
		<path d="M7 3v5a4 4 0 0 0 4 4h6" />
		<path d="M7 21v-5a4 4 0 0 1 4-4" />
		<path d="m14 9 3 3-3 3" />
	</Base>
)

export const IconLink = (props: IconProps) => (
	<Base {...props}>
		<path d="M10 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7L11.5 6.4" />
		<path d="M14 10.5a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 0 0 5.7 5.7l1.3-1.4" />
	</Base>
)

export const IconClock = (props: IconProps) => (
	<Base {...props}>
		<circle cx="12" cy="12" r="9" />
		<path d="M12 7v5.2l3.2 2" />
	</Base>
)

export const IconType = (props: IconProps) => (
	<Base {...props}>
		<path d="M4 6.5V4.5h16v2" />
		<path d="M12 4.5V20" />
		<path d="M8.5 20h7" />
	</Base>
)

export const IconSun = (props: IconProps) => (
	<Base {...props}>
		<circle cx="12" cy="12" r="4" />
		<path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
	</Base>
)

export const IconMoon = (props: IconProps) => (
	<Base {...props}>
		<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
	</Base>
)

export const IconArrowUp = (props: IconProps) => (
	<Base {...props} strokeWidth={2.2}>
		<path d="M12 19V5M6 11l6-6 6 6" />
	</Base>
)

export const IconSliders = (props: IconProps) => (
	<Base {...props}>
		<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h10M18 18h2" />
		<circle cx="16" cy="6" r="2" />
		<circle cx="10" cy="12" r="2" />
		<circle cx="16" cy="18" r="2" />
	</Base>
)

export const IconSearch = (props: IconProps) => (
	<Base {...props}>
		<circle cx="11" cy="11" r="6.5" />
		<path d="M15.8 15.8L20 20" />
	</Base>
)

export const IconTools = (props: IconProps) => (
	<Base {...props}>
		<path d="M14.7 6.3a3.5 3.5 0 004.6 4.6l-8 8a2.3 2.3 0 01-3.2-3.2z" />
		<path d="M6.5 4.5l2.6 2.6-2 2-2.6-2.6z" />
	</Base>
)

export const IconHistory = (props: IconProps) => (
	<Base {...props}>
		<path d="M3.5 9A9 9 0 1 1 3 12" />
		<path d="M3 4v5h5" />
		<path d="M12 7.5V12l3 1.8" />
	</Base>
)

export const IconVault = (props: IconProps) => (
	<Base {...props}>
		<ellipse cx="12" cy="6" rx="7.5" ry="3" />
		<path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6" />
		<path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" />
	</Base>
)

export const IconClose = (props: IconProps) => (
	<Base {...props} strokeWidth={2.1}>
		<path d="M6 6l12 12M18 6L6 18" />
	</Base>
)

export const IconCloudOff = (props: IconProps) => (
	<Base {...props}>
		<path d="M6.6 10a5 5 0 0 0 .4 10h9" />
		<path d="M9.5 5.6A5.5 5.5 0 0 1 18 9.5a4.2 4.2 0 0 1 2.4 7" />
		<path d="M3 3l18 18" />
	</Base>
)

export const IconCloud = (props: IconProps) => (
	<Base {...props}>
		<path d="M6.5 19a4.5 4.5 0 0 1 .6-8.96 6 6 0 0 1 11.5 1.71A3.75 3.75 0 0 1 17.5 19h-11Z" />
	</Base>
)

export const IconCloudUp = (props: IconProps) => (
	<Base {...props}>
		<path d="M6.5 18.5a4.5 4.5 0 0 1 .6-8.46 6 6 0 0 1 11.5 1.71 3.75 3.75 0 0 1 .4 6.75" />
		<path d="M12 21v-7" />
		<path d="m9 16.5 3-3 3 3" />
	</Base>
)

export const IconDevice = (props: IconProps) => (
	<Base {...props}>
		<rect x="3" y="4" width="18" height="12" rx="2" />
		<path d="M8 20h8" />
		<path d="M12 16v4" />
	</Base>
)

export const IconLayers = (props: IconProps) => (
	<Base {...props}>
		<path d="M12 3 3 7.5l9 4.5 9-4.5L12 3Z" />
		<path d="m3 12.5 9 4.5 9-4.5" />
		<path d="m3 17 9 4.5 9-4.5" />
	</Base>
)

export const IconKeyboard = (props: IconProps) => (
	<Base {...props}>
		<rect x="2.5" y="6" width="19" height="12" rx="2" />
		<path d="M6.5 9.5h.01M10 9.5h.01M13.5 9.5h.01M17 9.5h.01M6.5 12.8h.01M10 12.8h.01M13.5 12.8h.01M17 12.8h.01M8.5 15.6h7" />
	</Base>
)

export const IconPause = (props: IconProps) => (
	<Base {...props}>
		<rect x="6.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
		<rect x="13.5" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
	</Base>
)

export const IconWaveform = (props: IconProps) => (
	<Base {...props}>
		<path d="M3 12h2M8 7v10M12 4v16M16 8.5v7M20 11h1.5" />
	</Base>
)

export const IconGauge = (props: IconProps) => (
	<Base {...props}>
		<path d="M4 18a8 8 0 1 1 16 0" />
		<path d="m12 14 4.5-4" />
		<circle cx="12" cy="18" r="1.4" fill="currentColor" stroke="none" />
	</Base>
)

export const IconForward = (props: IconProps) => (
	<Base {...props}>
		<path d="m4 6 7 6-7 6V6Z" fill="currentColor" stroke="none" />
		<path d="m13 6 7 6-7 6V6Z" fill="currentColor" stroke="none" />
	</Base>
)

export const IconSkipNext = (props: IconProps) => (
	<Base {...props}>
		<path d="m6 6 9 6-9 6V6Z" fill="currentColor" stroke="none" />
		<path d="M18 5.5v13" />
	</Base>
)

export const IconSkipPrev = (props: IconProps) => (
	<Base {...props}>
		<path d="m18 6-9 6 9 6V6Z" fill="currentColor" stroke="none" />
		<path d="M6 5.5v13" />
	</Base>
)

export const IconZoomIn = (props: IconProps) => (
	<Base {...props}>
		<circle cx="10.5" cy="10.5" r="6.5" />
		<path d="M20.5 20.5 15.2 15.2M10.5 8v5M8 10.5h5" />
	</Base>
)

export const IconZoomOut = (props: IconProps) => (
	<Base {...props}>
		<circle cx="10.5" cy="10.5" r="6.5" />
		<path d="M20.5 20.5 15.2 15.2M8 10.5h5" />
	</Base>
)

export const IconEye = (props: IconProps) => (
	<Base {...props}>
		<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
		<circle cx="12" cy="12" r="2.8" />
	</Base>
)

export const IconLock = (props: IconProps) => (
	<Base {...props}>
		<rect x="5" y="10.5" width="14" height="9.5" rx="2" />
		<path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
	</Base>
)

export const IconPerson = (props: IconProps) => (
	<Base {...props}>
		<circle cx="12" cy="7.5" r="3.5" />
		<path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
	</Base>
)

export const IconPalette = (props: IconProps) => (
	<Base {...props}>
		<path d="M12 3a9 9 0 0 0 0 18c1.4 0 2-.9 2-1.8 0-1.3-1-1.7-1-2.7 0-.8.7-1.5 1.6-1.5H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8Z" />
		<circle cx="8" cy="10.5" r="1.1" fill="currentColor" stroke="none" />
		<circle cx="11.5" cy="7.5" r="1.1" fill="currentColor" stroke="none" />
		<circle cx="15.5" cy="9" r="1.1" fill="currentColor" stroke="none" />
	</Base>
)
