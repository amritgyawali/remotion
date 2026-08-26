import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import EditorStudio from '../../../components/EditorStudio'
import '../../../app/globals.css'
import './native.css'

const root = document.getElementById('root')
if (!root) throw new Error('index.html is missing the #root element')

createRoot(root).render(
	<StrictMode>
		<EditorStudio standalone />
	</StrictMode>,
)
