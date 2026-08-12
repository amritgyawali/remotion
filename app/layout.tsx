import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
	title: 'Remotion Video Studio - render video from a code file',
	description:
		'Upload a Remotion composition and render high-quality video in your browser, with protected Vercel Sandbox and local render options.',
	applicationName: 'Remotion Video Studio',
	openGraph: {
		title: 'Remotion Video Studio',
		description: 'Upload a code file and render an authored video with browser, Vercel Sandbox, or local workflows.',
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
