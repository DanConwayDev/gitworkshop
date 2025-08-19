import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';

export default defineConfig({
	plugins: [
		// @ts-ignore
		sveltekit(),
		// @ts-ignore
		SvelteKitPWA({
			registerType: 'autoUpdate',
			manifestFilename: 'manifest.json'
		})
	],

	test: {
		include: ['src/**/*.{test,spec}.{js,ts}']
	}
});
