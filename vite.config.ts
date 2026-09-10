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

const SITE_ORIGIN = 'https://galaxy.adrianguichard.dev';

/**
 * Taille à laquelle la carte équirectangulaire est relue avant d'être projetée.
 *
 * Le disque fait 440 px et n'en montre qu'un hémisphère : au centre, un pixel écran couvre
 * environ 0,41° de longitude, un texel de cette largeur 0,35°. C'est le point d'équilibre —
 * plus large, la texture est suréchantillonnée et scintille au bord ; plus étroite, le centre
 * du disque devient flou. Le rééchantillonnage de sharp fait la moyenne des texels, ce qu'un
 * simple filtrage bilinéaire sur la 2k d'origine ne ferait pas.
 */
const CARD_TEXTURE_WIDTH = 1024;
const CARD_TEXTURE_HEIGHT = 512;

/**
 * Opacité de l'anneau, reprise de `createRingMaterial()` dans `src/config/layerConfig.ts`.
 * La vignette doit ressembler à ce que l'application montre, pas à une seconde interprétation.
 */
const RING_OPACITY = 0.9;

/**
 * Une page d'atterrissage statique par corps — `dist/jupiter/index.html` — plus le sitemap
 * complet. Le POURQUOI et les contraintes vivent dans `src/seo/bodyLandingPage.ts` ; ici on ne
 * fait que de l'entrée/sortie.
 *
 * Le catalogue est du TypeScript qui importe par l'alias `@/`, que Node ne sait pas résoudre.
 * On passe donc par le chargeur de modules de Vite lui-même (`ssrLoadModule`) : les pages sont
 * générées à partir EXACTEMENT du même catalogue que l'application, sans copie ni export
 * intermédiaire qui pourrait dériver.
 */
function bodyLandingPages() {
  return {
    name: 'galaxy-body-landing-pages',
    apply: 'build' as const,
    async closeBundle(): Promise<void> {
      const { createServer } = await import('vite');
      const { mkdir, readFile, stat, writeFile } = await import('fs/promises');
      const sharp = (await import('sharp')).default;
      const loader = await createServer({
        configFile: false,
        logLevel: 'error',
        server: { middlewareMode: true },
        resolve: { alias: { '@': resolve(__dirname, 'src') } },
      });
      try {
        const catalogue = (await loader.ssrLoadModule(
          '/src/config/bodies.ts'
        )) as typeof import('./src/config/bodies');
        const seo = (await loader.ssrLoadModule(
          '/src/seo/bodyLandingPage.ts'
        )) as typeof import('./src/seo/bodyLandingPage');
        const card = (await loader.ssrLoadModule(
          '/src/seo/socialCard.ts'
        )) as typeof import('./src/seo/socialCard');

        const dist = resolve(__dirname, 'dist');
        const baseHtml = await readFile(resolve(dist, 'index.html'), 'utf-8');
        const pages = seo.bodyLandingPages(
          catalogue.CELESTIAL_CONFIG,
          SITE_ORIGIN
        );
        // Un catalogue vide, un chargeur qui rend un module vide, un renommage de champ : le
        // build produirait alors zéro page et un sitemap réduit à deux URL, SANS rien signaler
        // — et le déploiement effacerait les pages existantes. Le seuil est délibérément bas :
        // il attrape la panne, pas la suppression volontaire d'un corps.
        if (pages.length < 20)
          throw new Error(
            `génération des pages de corps : ${pages.length} page(s) seulement, catalogue non chargé ?`
          );
        for (const page of pages) {
          const dir = resolve(dist, page.slug);
          await mkdir(dir, { recursive: true });
          await writeFile(
            resolve(dir, 'index.html'),
            seo.renderBodyPage(baseHtml, page),
            'utf-8'
          );
        }
        // Vignettes de partage, une par corps — voir `src/seo/socialCard.ts` pour le POURQUOI.
        // Elles DÉRIVENT des textures déjà versionnées, donc rien de nouveau n'est committé ;
        // elles sont reconstruites à l'identique à chaque build (rendu déterministe, sans GPU).
        const socialDir = resolve(dist, 'social');
        await mkdir(socialDir, { recursive: true });
        const domain = new URL(SITE_ORIGIN).host;
        /** Décode une image en pixels bruts pour `socialCard.ts`. */
        const loadRaw = async (
          path: string,
          width?: number,
          height?: number
        ): Promise<import('./src/seo/socialCard').RawImage> => {
          let pipeline = sharp(resolve(__dirname, path));
          if (width && height)
            pipeline = pipeline.resize(width, height, {
              fit: 'fill',
            });
          const { data, info } = await pipeline
            .removeAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
          return {
            data,
            width: info.width,
            height: info.height,
            channels: info.channels,
          };
        };

        for (const page of pages) {
          const visual = page.visual;
          const texture = visual.surface
            ? await loadRaw(
                visual.surface,
                CARD_TEXTURE_WIDTH,
                CARD_TEXTURE_HEIGHT
              )
            : null;
          // Le profil d'anneau est déjà une image large et courte (2048 × 125) : la relire
          // telle quelle, la redimensionner écraserait justement les fines divisions.
          const ring = visual.ring
            ? {
                texture: await loadRaw(visual.ring.texture),
                innerRadius: visual.ring.innerRadius,
                outerRadius: visual.ring.outerRadius,
                opacity: RING_OPACITY,
              }
            : null;

          // Un corps à anneaux est rendu au DOUBLE puis réduit : l'ellipse de l'anneau et sa
          // découpe sur le globe sont des bords géométriques francs, très visiblement crénelés
          // sinon. Le globe seul, lui, n'a qu'un bord circulaire, déjà lissé par `coverage` —
          // d'où le rendu direct, qui garde les cinquante autres vignettes au bit près.
          const span = ring ? card.RINGED_SPAN : card.SPHERE_SIZE;
          const superSample = ring ? 2 : 1;
          const sphere = card.renderSphere(
            texture,
            visual.fallback,
            span * superSample,
            visual.emissive,
            ring
          );
          const target = resolve(socialDir, `${page.slug}.jpg`);
          let body = sharp(
            Buffer.from(sphere.buffer, sphere.byteOffset, sphere.byteLength),
            {
              raw: {
                width: span * superSample,
                height: span * superSample,
                channels: 4,
              },
            }
          );
          if (superSample > 1) body = body.resize(span, span);
          const bodyPng = await body.png().toBuffer();
          await sharp(Buffer.from(card.cardBackgroundSvg(page.visual.emissive)))
            .composite([
              {
                input: bodyPng,
                left: Math.round(card.SPHERE_CENTER_X - span / 2),
                top: Math.round((card.CARD_HEIGHT - span) / 2),
              },
              {
                input: Buffer.from(
                  card.cardTextSvg(
                    page.displayName,
                    page.facts.map((fact) => `${fact.label}: ${fact.value}`),
                    domain
                  )
                ),
              },
            ])
            // 4:2:0 (le défaut) délave les aplats colorés du texte sur fond sombre — un
            // liseré terne autour de chaque lettre, très visible à cette taille.
            .jpeg({ quality: 85, chromaSubsampling: '4:4:4' })
            .toFile(target);
          // Une vignette absente ou vide ne se voit NULLE PART : la page se déploie, la balise
          // pointe vers un 404, et l'aperçu de partage tombe silencieusement sur rien. Le seul
          // endroit où ça peut encore échouer bruyamment, c'est ici.
          const written = await stat(target).catch(() => null);
          if (!written || written.size === 0)
            throw new Error(`vignette de partage manquante : ${page.slug}.jpg`);
        }

        const today = new Date().toISOString().slice(0, 10);
        await writeFile(
          resolve(dist, 'sitemap.xml'),
          seo.renderSitemap(pages, SITE_ORIGIN, today),
          'utf-8'
        );
        loader.config.logger.info(
          `  ${pages.length} pages de corps + vignettes + sitemap générés`
        );
      } finally {
        await loader.close();
      }
    },
  };
}

export default defineConfig({
  plugins: [
    stripProductionHtmlComments(),
    bodyLandingPages(),
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
        // Les 51 pages d'atterrissage sont des quasi-copies de `index.html` : les précacher
        // triplait le poids de l'installation (1 019 → 2 941 Kio mesurés) pour du contenu que
        // l'app shell couvre déjà. Elles restent servies par le réseau, ce que la denylist de
        // `navigateFallback` impose de toute façon.
        globIgnores: ['*/index.html'],
        // SPA : toute navigation retombe sur index.html (déjà rewrité côté Firebase).
        navigateFallback: '/index.html',
        // …sauf les pages statiques autonomes (confidentialité) : elles doivent être
        // servies telles quelles, pas remplacées par l'app WebGL.
        // Les pages d'atterrissage par corps (`/jupiter`) sont de VRAIS fichiers : sans cette
        // exclusion, un visiteur qui a déjà le service worker recevrait le `/index.html` en
        // cache et donc les balises de tête de l'accueil. L'application ouvrirait quand même le
        // bon corps (le chemin suffit, cf. `bodyFromPathname`), mais le document servi serait le
        // mauvais. Motif : un segment unique sans point — ce qui exclut `/`, `/assets/…` et les
        // fichiers. Contrepartie assumée : hors ligne, une URL d'un seul segment INCONNUE ne
        // retombe plus sur l'app ; en ligne la réécriture Firebase s'en charge comme avant.
        navigateFallbackDenylist: [/^\/privacy\.html$/, /^\/[^/.]+\/?$/],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // manifest.json n'est PAS un asset immuable : c'est le pointeur mutable vers les
            // .bin d'éphémérides (nommés avec un hash de contenu, eux). Il est régénéré en
            // place (même nom de fichier) quand des données sont corrigées — ça s'est produit
            // deux fois dans cette session (bug de manifest obsolète, puis bug de cible
            // Horizons résolvant vers un astéroïde différent). Si cette règle passait par le
            // CacheFirst générique ci-dessous, un utilisateur PWA ayant mis le manifeste en
            // cache avant une correction continuerait, jusqu'à 30 jours, à pointer vers des
            // .bin à l'ancien hash — que le déploiement suivant supprime du serveur (ancien
            // hash absent du nouveau build) : non pas des données périmées mais un vrai 404,
            // silencieux, sur l'éphéméride d'un corps. Cette règle doit précéder la règle
            // générique /assets/ (Workbox retient la première correspondance) et repasser par
            // le réseau à chaque fois que possible — cohérent avec le Cache-Control d'1h que
            // Firebase applique déjà à ce chemin précis (voir firebase.json).
            urlPattern: ({ url }) =>
              url.pathname === '/assets/ephemerides/manifest.json',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'ssv-ephemeris-manifest',
              networkTimeoutSeconds: 4,
              expiration: {
                maxEntries: 1,
                maxAgeSeconds: 60 * 60,
                purgeOnQuotaError: true,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
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
