import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';

export default defineConfig({
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
			registerType: 'autoUpdate',
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
					/\.(?:png|jpg|jpeg|svg|gif|webp|ico|css|js|woff|woff2)$/
				],
				// ⚠️ REQUIRED: Service worker must take control immediately for offline to work
				// Without these: hard refresh while offline fails with ERR_INTERNET_DISCONNECTED
				skipWaiting: true,
				clientsClaim: true,
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
