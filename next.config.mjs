/** @type {import('next').NextConfig} */
const nextConfig = {
	reactStrictMode: true,

	/**
	 * The Remotion server renderer spawns a real headless browser and must never be
	 * bundled by webpack/turbopack. A normal Node host uses the renderer directly;
	 * Vercel Functions orchestrate an isolated Vercel Sandbox instead.
	 */
	serverExternalPackages: [
		// gRPC talks to NVIDIA's hosted speech functions from the route handler;
		// it resolves its own transport lazily and must not be bundled.
		'@grpc/grpc-js',
		'@grpc/proto-loader',
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

			/**
			 * Whisper's WebAssembly build ships an Emscripten pthread worker, which
			 * makes its chunk and the webpack runtime depend on each other - the
			 * build says so out loud:
			 *
			 *   Circular dependency between chunks with runtime (em-pthread, webpack)
			 *   This prevents using hashes of each other and should be avoided.
			 *
			 * With `realContentHash` on (the production default) webpack rewrites
			 * those filenames after minification, and inside that cycle the runtime
			 * can keep pointing at a hash that was never emitted. The deployed app
			 * then requests a chunk that 404s and the studio reports "Loading chunk
			 * 192 failed" - permanently, not just until the next reload. Hashing
			 * before minification keeps the reference and the file in step.
			 */
			config.optimization = {
				...config.optimization,
				realContentHash: false,
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
