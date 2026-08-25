import type { Metadata } from 'next'
import ToolsStudio from '../../components/ToolsStudio'

export const metadata: Metadata = {
	title: 'Tools Studio - 50+ video and audio editing tools',
	description:
		'Fix mono audio to stereo, trim and speed up clips, rotate and crop, colour grade, watermark, extract audio and more - fifty-plus editing tools that run entirely in your browser.',
}

export default function Page() {
	return <ToolsStudio />
}
