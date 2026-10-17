import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

/*
 * Car DNA ships as a purely static bundle. The San Jose basemap, the charging and gas
 * station lists and the road graph are files inside this repository, so there is no map
 * API key, no proxy middleware and no runtime request to a tile or routing service.
 * `base: './'` keeps the build usable from a GitHub Pages project sub-path.
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {outDir: 'dist', assetsDir: 'assets'},
});
