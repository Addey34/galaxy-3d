import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { defineConfig } from 'vitest/config';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Removes authoring-only HTML comments from the production document. Comments are
 * useful while editing the static shell, but they add no runtime value and expose
 * internal implementation notes in the deployed page source.
 */
function stripProductionHtmlComments() {
  return {
    name: 'strip-production-html-comments',
    transformIndexHtml(html: string): string {
      return html.replace(/<!--[\s\S]*?-->/g, '');
    },
  };
}

export default defineConfig({
  plugins: [stripProductionHtmlComments()],
  base: '/',
  publicDir: 'public',
  resolve: {
    // Alias @/ → src/ : imports absolus, résilients aux déplacements de fichiers
    alias: { '@': resolve(__dirname, 'src') },
  },
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
