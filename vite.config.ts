import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { defineConfig } from 'vitest/config';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: '/',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      input: {
        SolarSystemApp: resolve(__dirname, 'index.html'),
      },
      output: {
        // Sépare les grosses libs tierces du code applicatif : elles changent
        // rarement (meilleur cache navigateur) et allègent le chunk principal
        // sous le seuil d'avertissement de Vite.
        manualChunks: {
          three: ['three'],
          astronomy: ['astronomy-engine'],
          tween: ['@tweenjs/tween.js'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
