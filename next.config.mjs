/** @type {import('next').NextConfig} */
const nextConfig = {
	reactStrictMode: true,

	/**
	 * The Remotion server renderer spawns a real headless browser and must never be
	 * bundled by webpack/turbopack. A normal Node host uses the renderer directly;
	 * Vercel Functions orchestrate an isolated Vercel Sandbox instead.
	 */
	serverExternalPackages: [
		'@remotion/bundler',
		'@remotion/renderer',
		'@remotion/vercel',
		'@remotion/compositor-linux-x64-gnu',
		'@vercel/sandbox',
		'esbuild',
	],

	// The studio compiles user code in the browser; these Node builtins are never used there.
	webpack: (config, { isServer }) => {
		if (!isServer) {
			config.resolve.fallback = {
				...config.resolve.fallback,
				fs: false,
				path: false,
				os: false,
				crypto: false,
			}
		}
		return config
	},

	headers: async () => [
		{
			// WebCodecs + SharedArrayBuffer friendly headers for the render worker.
			source: '/(.*)',
			headers: [
				{ key: 'X-Content-Type-Options', value: 'nosniff' },
				{ key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
			],
		},
		{
			/**
			 * The subtitle studio transcribes speech with Whisper compiled to
			 * WebAssembly, and its worker pool only gets a SharedArrayBuffer in a
			 * cross-origin isolated document. `credentialless` buys that isolation
			 * without demanding a CORP header from every remote image or video the
			 * page might load. Scoped to this route so the code studio keeps
			 * embedding third-party assets unchanged.
			 */
			source: '/captions',
			headers: [
				{ key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
				{ key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
			],
		},
		{
			source: '/samples/:path*',
			headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }],
		},
	],
}

export default nextConfig
