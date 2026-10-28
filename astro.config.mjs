import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://swapnild2111.github.io',
  base: '/carromstats',
  trailingSlash: 'ignore',
  server: { port: 5500 },
  build: {
    format: 'directory',
  },
});
