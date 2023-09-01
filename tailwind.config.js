/** @type {import('tailwindcss').Config} */
export default {
    content: [ './src/**/*.{svelte,js,ts}' ],
  theme: {
    extend: {},
  },
  plugins: [ 
    require('@tailwindcss/typography'),
    require('daisyui'),
  ],
  daisyui: {
    themes: [ 'dracula'],
  }
}

