import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';

export default defineConfig({
	plugins: [
		// @ts-expect-error https://github.com/sveltejs/cli/issues/341 mismatch in types is because vitest
		sveltekit(),
		// @ts-expect-error https://github.com/sveltejs/cli/issues/341 mismatch in types is because vitest
		SvelteKitPWA({
			registerType: 'autoUpdate',
			manifestFilename: 'manifest.json'
		})
	],

	test: {
		include: ['src/**/*.{test,spec}.{js,ts}']
	}
});
