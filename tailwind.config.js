/** @type {import('tailwindcss').Config} */


export default {
  content: ['./src/**/*.{svelte,js,ts}'],
  theme: {
    extend: {
      colors: {
        "base-400": "#16171e",
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
    require('daisyui'),
  ],
  daisyui: {
    themes: ['dracula'],
  }
}

