import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://swapnild2111.github.io',
  base: '/carromstats',
  trailingSlash: 'ignore',
  build: {
    format: 'directory',
  },
});
