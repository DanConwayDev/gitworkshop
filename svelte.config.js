import { vitePreprocess } from '@sveltejs/kit/vite'
import adapter from '@sveltejs/adapter-netlify'

const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
  },
}

export default config
