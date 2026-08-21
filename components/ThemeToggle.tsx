'use client'

import { useEffect, useState } from 'react'
import { IconMoon, IconSun } from './Icons'

type Theme = 'dark' | 'light'

const STORAGE_KEY = 'rvs-theme'

/**
 * The inline script in the root layout has already put the right theme on
 * <html> before paint. This only mirrors that value so the button shows the
 * correct icon, and writes the choice back on click.
 */
export default function ThemeToggle() {
	const [theme, setTheme] = useState<Theme>('dark')

	useEffect(() => {
		const current = document.documentElement.getAttribute('data-theme')
		setTheme(current === 'light' ? 'light' : 'dark')
	}, [])

	const toggle = () => {
		const next: Theme = theme === 'dark' ? 'light' : 'dark'
		setTheme(next)
		document.documentElement.setAttribute('data-theme', next)
		try {
			localStorage.setItem(STORAGE_KEY, next)
		} catch {
			// Private browsing can refuse storage; the theme still applies for this visit.
		}
	}

	return (
		<button
			type="button"
			className="icon-btn"
			onClick={toggle}
			title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
			aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
		>
			{theme === 'dark' ? <IconSun size={15} /> : <IconMoon size={15} />}
		</button>
	)
}
