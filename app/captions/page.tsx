import type { Metadata } from 'next'
import CaptionStudio from '../../components/CaptionStudio'

export const metadata: Metadata = {
	title: 'Subtitle Studio - caption a video and render it',
	description:
		'Upload a video, transcribe speech with Gemini or on-device Whisper, style the captions and render a finished video with the subtitles burned in.',
}

export default function Page() {
	return <CaptionStudio />
}
