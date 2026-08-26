import type { Metadata } from 'next'
import EditorStudio from '../../components/EditorStudio'

export const metadata: Metadata = {
	title: 'Editor Studio - a full multi-track video editor, entirely on your device',
	description:
		'A real non-linear editor in the browser: multi-track timeline, drag/trim/split/ripple-delete, transforms, text, keyframable properties, undo history, crash-proof autosave and local GPU export. Nothing is uploaded.',
}

export default function Page() {
	return <EditorStudio />
}
