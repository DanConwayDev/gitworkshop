import { vitePreprocess } from '@sveltejs/kit/vite'
import adapter from '@sveltejs/adapter-static'

const config = {
  preprocess: vitePreprocess(),
  adapter: adapter({
    // default options are shown. You can customize them as needed.
    pages: 'build',
    assets: 'build',
    fallback: null, // Set to null to avoid using a fallback HTML file
  }),
  prerender: {
    // Set this to false to disable prerendering
    default: false,
  },
}

export default config
