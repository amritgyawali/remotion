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
