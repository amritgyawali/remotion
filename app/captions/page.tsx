import type { Metadata } from 'next'
import CaptionStudio from '../../components/CaptionStudio'

export const metadata: Metadata = {
	title: 'Subtitle Studio - caption a video and render it',
	description:
		'Upload a video, generate the transcript on-device with Whisper, style the captions and render a finished video with the subtitles burned in.',
}

export default function Page() {
	return <CaptionStudio />
}
