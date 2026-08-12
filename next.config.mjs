/** @type {import('next').NextConfig} */
const nextConfig = {
	reactStrictMode: true,

	/**
	 * The Remotion server renderer spawns a real headless browser and must never be
	 * bundled by webpack/turbopack. Keeping these external is what makes
	 * `/api/render` work on Vercel Functions and on a normal Node server.
	 */
	serverExternalPackages: [
		'@remotion/bundler',
		'@remotion/renderer',
		'@remotion/compositor-linux-x64-gnu',
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
			source: '/samples/:path*',
			headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }],
		},
	],
}

export default nextConfig
