/** @type {import('tailwindcss').Config} */
import typography from '@tailwindcss/typography'
import daisyui from 'daisyui'

export default {
  content: ['./src/**/*.{svelte,js,ts}'],
  theme: {
    extend: {
      colors: {
        'base-400': '#16171e',
      },
    },
  },
  plugins: [typography, daisyui],
  daisyui: {
    themes: ['dracula'],
  },
}
