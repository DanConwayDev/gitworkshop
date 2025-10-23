import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { execSync } from 'child_process';

// Get git commit info at build time
function getGitInfo() {
	try {
		// Use Netlify env vars if available, otherwise use git commands
		const commitHash =
			process.env.COMMIT_REF || execSync('git rev-parse --short HEAD').toString().trim();
		const commitDate = process.env.NETLIFY
			? new Date().toISOString().split('T')[0]
			: execSync('git log -1 --format=%cd --date=short').toString().trim();
		return { commitHash, commitDate };
	} catch {
		return { commitHash: 'dev', commitDate: new Date().toISOString().split('T')[0] };
	}
}

const { commitHash, commitDate } = getGitInfo();

export default defineConfig({
	define: {
		__GIT_COMMIT__: JSON.stringify(commitHash),
		__COMMIT_DATE__: JSON.stringify(commitDate)
	},
	plugins: [
		sveltekit(),
		SvelteKitPWA({
			srcDir: './src',
			mode: 'production',
			strategies: 'generateSW',
			scope: '/',
			base: '/',
			selfDestroying: false,
			manifest: false, // We use static manifest.json
			injectRegister: 'auto',
			registerType: 'prompt', // Changed from 'autoUpdate' to require user action
			devOptions: {
				enabled: false, // Disable in dev mode to avoid errors
				suppressWarnings: true,
				navigateFallback: '/index.html',
				type: 'module'
			},
			workbox: {
				// ⚠️ CRITICAL: DO NOT CHANGE TO 'build'! Read docs/PWA_CONFIGURATION.md before modifying!
				// Must use '.svelte-kit/output/client' because PWA plugin runs BEFORE static adapter
				// creates the 'build' directory. Using 'build' results in EMPTY precache (0 files).
				globDirectory: '.svelte-kit/output/client',
				globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff,woff2,json}'],
				// ⚠️ REQUIRED: These entries map '/' to index.html for navigation fallback
				// Without these: offline navigation fails with 'non-precached-url' errors
				additionalManifestEntries: [
					{ url: '/', revision: null },
					{ url: 'index.html', revision: null }
				],
				navigateFallback: '/',
				navigateFallbackDenylist: [
					/^\/api\//,
					/^\/_app\//, // Exclude SvelteKit app directory to prevent serving HTML for JS modules
					/\.(?:png|jpg|jpeg|svg|gif|webp|ico|css|js|woff|woff2)$/
				],
				// ⚠️ IMPORTANT: Do NOT use skipWaiting here - it causes MIME errors on update
				// The new SW will wait until user clicks "Update" button, then skipWaiting is called manually
				skipWaiting: false,
				clientsClaim: true, // Still claim clients, but only after user-initiated update
				// ⚠️ CRITICAL: Clean up old caches when service worker updates
				// Without this: old cached assets persist and cause MIME type errors on update
				cleanupOutdatedCaches: true,
				runtimeCaching: [
					{
						urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
						handler: 'CacheFirst',
						options: {
							cacheName: 'google-fonts-cache',
							expiration: {
								maxEntries: 10,
								maxAgeSeconds: 60 * 60 * 24 * 365
							},
							cacheableResponse: {
								statuses: [0, 200]
							}
						}
					},
					{
						urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/,
						handler: 'CacheFirst',
						options: {
							cacheName: 'images-cache',
							expiration: {
								maxEntries: 50,
								maxAgeSeconds: 60 * 60 * 24 * 30
							}
						}
					}
				]
			},
			kit: {
				includeVersionFile: true
			}
		})
	],

	test: {
		include: ['src/**/*.{test,spec}.{js,ts}']
	}
});
