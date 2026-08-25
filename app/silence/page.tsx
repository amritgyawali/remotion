import type { Metadata } from 'next'
import SilenceStudio from '../../components/SilenceStudio'

export const metadata: Metadata = {
	title: 'Silence Studio - cut the dead air out of a video',
	description:
		'Upload a video and the studio measures where the speech actually is, then removes every pause or runs it at 3x. Watch the cut before it is written, and export it without uploading a byte.',
}

export default function Page() {
	return <SilenceStudio />
}
