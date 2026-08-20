import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

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
  plugins: [
    stripProductionHtmlComments(),
    // PWA installable + hors-ligne. Pensé pour l'usage en classe (wifi d'école saturé) :
    // au 2e chargement, l'app boote sans réseau et les corps déjà visités restent
    // consultables. On ne PRÉCACHE que l'app shell (JS/CSS/HTML) — jamais les grosses
    // textures/éphémérides, sinon l'installation téléchargerait des dizaines de Mo. Ces
    // assets sont mis en cache À LA DEMANDE quand l'utilisateur les rencontre.
    VitePWA({
      registerType: 'autoUpdate',
      // Servi comme fichier statique : pas de précache, on n'auto-inclut donc pas index.html.
      includeAssets: ['favicon.ico', 'icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: '3D Solar System — Interactive Visualizer',
        short_name: 'Solar System',
        description:
          'Explore the solar system in 3D with real NASA/JPL ephemeris positions. Educational and true-scale exploration modes, time travel, real distances and light-time.',
        lang: 'en-GB',
        dir: 'ltr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#02040a',
        theme_color: '#000000',
        categories: ['education', 'science'],
        icons: [
          { src: '/icons/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/pwa-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // App shell précaché : le chunk `three` (~470 Ko) dépasse le défaut de 2 Mio ?
        // Non, mais on relève la borne par sécurité pour ne jamais exclure un chunk.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,ico,svg,woff2}'],
        // SPA : toute navigation retombe sur index.html (déjà rewrité côté Firebase).
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Textures + éphémérides : immutables (hash dans le nom), cache à la demande.
            // Plafonné pour ne pas saturer le disque d'un poste partagé.
            urlPattern: ({ url }) => url.pathname.startsWith('/assets/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'ssv-assets',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 30,
                purgeOnQuotaError: true,
              },
              cacheableResponse: { statuses: [0, 200] },
              rangeRequests: true,
            },
          },
          {
            // Données temps réel (météo, GIBS, SBDB) : le frais d'abord, le cache en secours
            // hors-ligne. Jamais présenté comme temps réel s'il vient du cache (statut honnête
            // géré côté app via dataStatus.ts).
            urlPattern: ({ url }) =>
              [
                'gibs.earthdata.nasa.gov',
                'api.open-meteo.com',
                'archive-api.open-meteo.com',
                'ssd-api.jpl.nasa.gov',
              ].includes(url.hostname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'ssv-live-data',
              networkTimeoutSeconds: 6,
              expiration: {
                maxEntries: 120,
                maxAgeSeconds: 60 * 60 * 24 * 7,
                purgeOnQuotaError: true,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: {
        // Pas de SW en dev (évite les surprises de cache pendant le HMR).
        enabled: false,
      },
    }),
  ],
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
