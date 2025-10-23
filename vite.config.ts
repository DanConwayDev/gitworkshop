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
			devOptions: {
				enabled: false, // Disable in dev mode to avoid errors
				suppressWarnings: true,
				navigateFallback: '/index.html',
				type: 'module'
			},
			workbox: {
				globDirectory: '.svelte-kit/output/client',
				globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff,woff2,json}'],
				// Important fix: Explicitly add root URLs to precache manifest
				// This bypasses the glob timing issue where index.html doesn't exist yet
				additionalManifestEntries: [
					{ url: '/', revision: null },
					{ url: 'index.html', revision: null }
				],
				// Serve index.html for all navigation requests
				navigateFallback: '/',
				navigateFallbackDenylist: [
					/^\/api\//,
					/\.(?:png|jpg|jpeg|svg|gif|webp|ico|css|js|woff|woff2)$/
				],
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
