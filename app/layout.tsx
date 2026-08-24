import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
	title: 'Remotion Video Studio - describe a video, get a rendered file',
	description:
		'Describe the video you want and the studio plans it, composes the Remotion file, previews it and renders high-quality MP4 in your browser, in a Vercel Sandbox, or locally.',
	applicationName: 'Remotion Video Studio',
	openGraph: {
		title: 'Remotion Video Studio',
		description: 'Describe a video, preview it instantly and render it in your browser.',
		type: 'website',
	},
}

export const viewport: Viewport = {
	themeColor: [
		{ media: '(prefers-color-scheme: dark)', color: '#0a0b10' },
		{ media: '(prefers-color-scheme: light)', color: '#f5f6fb' },
	],
	width: 'device-width',
	initialScale: 1,
	viewportFit: 'cover',
}

/**
 * Paints the saved theme before first paint so a light-theme visitor never sees
 * a dark flash. Kept inline and tiny on purpose - it runs before hydration.
 */
const THEME_BOOTSTRAP = `(function(){try{var s=localStorage.getItem('rvs-theme');if(s!=='light'&&s!=='dark'){s=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}document.documentElement.setAttribute('data-theme',s)}catch(e){document.documentElement.setAttribute('data-theme','dark')}})()`

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" data-theme="dark" suppressHydrationWarning>
			<head>
				<script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
				{/*
				 * The bundled typography kit. Declaring the faces costs nothing until
				 * one is used - browsers fetch a font file only when text is actually
				 * set in it - which is what lets the caption font picker preview all
				 * 64 families in their own type without downloading 16 MB up front.
				 */}
				<link rel="stylesheet" href="/assets/fonts/v1/fonts.css" />
				<link rel="stylesheet" href="/assets/fonts/v1/google-deva.css" />
			</head>
			<body>{children}</body>
		</html>
	)
}
