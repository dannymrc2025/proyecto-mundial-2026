import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  // Multi-page app: declara cada HTML como entry point
  build: {
    rollupOptions: {
      input: {
        main:    resolve(__dirname, 'index.html'),
        ficha:   resolve(__dirname, 'agregar-ficha.html'),
        profesor: resolve(__dirname, 'panel-profesor.html'),
      },
    },
  },
});
