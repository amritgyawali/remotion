import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
	title: 'Remotion Video Studio - render video from a code file',
	description:
		'Upload a Remotion composition file and render a broadcast-quality MP4 in your browser for free, or on the server at maximum power.',
	applicationName: 'Remotion Video Studio',
	openGraph: {
		title: 'Remotion Video Studio',
		description: 'Upload a code file, get a rendered video. Free, in-browser, hardware accelerated.',
		type: 'website',
	},
}

export const viewport: Viewport = {
	themeColor: '#191919',
	width: 'device-width',
	initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en">
			<body>{children}</body>
		</html>
	)
}
