import containerQueries from '@tailwindcss/container-queries';
import typography from '@tailwindcss/typography';
import daisyui from 'daisyui';
import type { Config } from 'tailwindcss';

export default {
	content: ['./src/**/*.{html,js,svelte,ts}'],
	plugins: [typography, containerQueries, daisyui],
	theme: {
		extend: {
			colors: {
				'base-400': '#16171e'
			}
		}
	},
	daisyui: {
		themes: ['dracula']
	}
} satisfies Config;
