import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Tauri's own quickstart config, trimmed to what this app actually needs:
// relative asset paths (Tauri serves the bundle over a custom protocol, not
// from the origin root), a fixed dev port Tauri's shell can point at, and
// `TAURI_` env vars passed through so the frontend can tell it is running
// inside the native shell versus a plain browser tab.
export default defineConfig({
	base: './',
	plugins: [react()],
	clearScreen: false,
	server: {
		port: 5183,
		strictPort: true,
		host: process.env.TAURI_DEV_HOST || false,
	},
	envPrefix: ['VITE_', 'TAURI_'],
	build: {
		outDir: 'dist',
		// Every real target here - Tauri's WebView2/WKWebView/WebKitGTK, and
		// every browser this app actually supports - is a modern evergreen
		// engine; WebCodecs and OffscreenCanvas alone rule out anything an
		// older compatibility target like "safari13" would be for. `esnext`
		// also keeps BigInt literals intact, which mediabunny's MKV path uses.
		target: 'esnext',
		minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
		sourcemap: !!process.env.TAURI_ENV_DEBUG,
	},
})
