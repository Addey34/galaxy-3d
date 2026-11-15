/**
 * ROUTAGE DU SERVICE WORKER POUR LES PAGES D'ATTERRISSAGE — build uniquement, lu par la
 * configuration VitePWA de `vite.config.ts`.
 *
 * Deux règles, et chacune a déjà été fausse une fois pour la même raison : écrite pour la
 * forme `/jupiter/` (UN segment), elle ne voyait pas `/eclipse/2026-08-12/` (DEUX). Rien ne
 * cassait — ni test, ni e2e, ni build — et l'effet ne se voit que chez un visiteur revenu :
 *
 *   - `LANDING_PAGE_GLOB_IGNORES` : ces pages sont des quasi-copies d'`index.html`. Les
 *     précacher gonflait l'installation hors ligne de 1,1 à 3,1 Mio (mesuré : 27 → 80
 *     entrées) pour un contenu que l'app shell couvre déjà.
 *   - `NAVIGATE_FALLBACK_DENYLIST` : ce sont de VRAIS fichiers. Sans exclusion, un visiteur
 *     qui a déjà le service worker reçoit l'`index.html` en cache, donc les balises de tête
 *     de l'accueil, au lieu de la page demandée. L'application ouvre quand même la bonne
 *     vue (le chemin suffit), mais le document servi est le mauvais.
 *
 * `pwaRouting.test.ts` confronte les deux listes aux pages que le build produit ; la garde
 * `e2e/built-pwaPrecache.spec.ts` les confronte au VRAI `dist/` (manifeste de précache lu dans
 * `sw.js`, tous les `index.html` écrits). Pas d'import ici : `vite.config.ts` le charge avant que
 * l'alias `@/` n'existe.
 *
 * GAL-PERF-PWA-001 (2026-11-15) : la troisième fois que cette liste est fausse, et la plus chère. Les
 * pages de formations (`/places/<corps>/<nom>/`, TROIS niveaux, 3 420 pages, 28 Mo bruts, 8 à 9 Mo
 * transférés) et les activités (`/activities/<id>/`) n'étaient dans aucune liste : le service worker
 * les précachait, soit 92 % de son installation. Deux changements, pour que cela ne puisse plus
 * recommencer :
 *   - l'ignorance du précache ne nomme plus les familles : TOUT `index.html` sous un dossier, à
 *     toute profondeur et dans toute langue, est exclu (le motif glob `GLOB_ANY_DEPTH_INDEX`, ci-dessous). Seuls `index.html` et
 *     `privacy.html` de la racine restent précachés. Une famille de pages nouvelle est donc exclue
 *     par défaut ; il faudrait une exception écrite pour la précacher ;
 *   - le repli SPA (`NAVIGATE_FALLBACK_DENYLIST`) reste explicite, parce qu'il décide du document
 *     SERVI et que les pages de corps et d'éclipse portent des permaliens interactifs (`?mode=`,
 *     `?date=`, `?place=`) qui doivent, eux, ouvrir l'application. Workbox applique ces motifs à
 *     `pathname + search` : les motifs ancrés par `$` ne reconnaissent donc PAS une adresse avec
 *     paramètres, et c'est voulu pour les familles interactives. Les familles purement
 *     documentaires (`places`, `activities`) tolèrent au contraire paramètres, absence de slash
 *     final et `index.html`, parce qu'aucune application n'est à ouvrir à leur place.
 * Conséquence assumée : hors ligne, ces pages ne sont plus lisibles (elles ne l'étaient que par effet
 * de bord du précache) ; en ligne, un visiteur revenu reçoit leur vrai document.
 */

/** Segment des pages d'éclipse — le même que `core/eclipsePages.ts::ECLIPSE_PATH_SEGMENT`. */
const ECLIPSE_SEGMENT = 'eclipse';

/**
 * Segment des pages de mission (`/missions/voyager/`), le même que
 * `documentPage.ts::MISSIONS_SLUG`. Deux segments, comme les éclipses : la forme exacte qui a
 * déjà échappé une fois à ces deux listes.
 */
const MISSIONS_SEGMENT = 'missions';

/** Segment des pages de survol (`/flybys/voyager2-neptune-1989-08-25/`), `documentPage.ts::FLYBYS_SLUG`. */
const FLYBYS_SEGMENT = 'flybys';

/** Segment des mises en orbite (`/orbit-insertions/juno-jupiter-2016-07-05/`), `documentPage.ts::ORBIT_INSERTIONS_SLUG`. */
const ORBIT_INSERTIONS_SEGMENT = 'orbit-insertions';

/** Segment des périhélies (`/perihelia/parker-solar-probe-2024-12-24/`), `documentPage.ts::PERIHELIA_SLUG`. */
const PERIHELIA_SEGMENT = 'perihelia';

/** Segment des périjoves de Juno (`/perijoves/juno-2023-12-30/`), `documentPage.ts::PERIJOVES_SLUG`. */
const PERIJOVES_SEGMENT = 'perijoves';

/** Segment des contacts avec un corps (`/contacts/rosetta-churyumov-gerasimenko-2016-09-30/`), `documentPage.ts::CONTACTS_SLUG`. */
const CONTACTS_SEGMENT = 'contacts';

/** Les rubriques dont les pages vivent DEUX segments sous la racine, ou sous la langue. */
const NESTED_SEGMENTS = [
  ECLIPSE_SEGMENT,
  MISSIONS_SEGMENT,
  FLYBYS_SEGMENT,
  ORBIT_INSERTIONS_SEGMENT,
  PERIHELIA_SEGMENT,
  PERIJOVES_SEGMENT,
  CONTACTS_SEGMENT,
];

/**
 * Préfixes des pages documentaires NON anglaises (`/fr/methodology/`, `/es/…`, `/pt-br/…`).
 *
 * Écrits ici en dur, et c'est délibéré : ce module est chargé par `vite.config.ts` AVANT que
 * l'alias `@/` existe, donc il ne peut pas lire `i18n/locales`. `pwaRouting.test.ts` confronte
 * cette liste aux pages que le build produit VRAIMENT, et rougit si une langue y manque — c'est
 * exactement le mode de panne que ce module documente en tête : rien ne casse, et seul un
 * visiteur revenu reçoit l'app shell au lieu de la page demandée.
 */
const LOCALISED_SEGMENTS = ['fr', 'es', 'pt-br'];

/**
 * Morceau du résumé de validation Horizons (`config/horizons-validation-summary.json`), chargé
 * à la demande par la fiche : 11 Kio compressés que personne ne doit payer à l'installation
 * pour ouvrir une fiche qu'il n'ouvrira peut-être jamais. Conséquence assumée : hors ligne et
 * avant tout chargement, la fiche masque son bloc « Position à cette date » plutôt que
 * d'inventer un écart.
 */
const VALIDATION_SUMMARY_GLOB = 'assets/horizons-validation-summary-*.js';

/**
 * Fichiers générés à NE PAS précacher (motifs glob, relatifs à `dist/`).
 *
 * Le motif `GLOB_ANY_DEPTH_INDEX` : un `index.html` sous au moins un dossier, à toute profondeur. Sémantique
 * vérifiée avec le `glob` de `workbox-build` sur le vrai `dist/` : `index.html` et `privacy.html` de la
 * racine restent, les 5 000 pages générées sortent. Ne pas le remplacer par une liste de familles :
 * c'est la forme qui a été fausse trois fois.
 */
const GLOB_ANY_DEPTH_INDEX = '*/**/index.html';

export const LANDING_PAGE_GLOB_IGNORES: string[] = [
  GLOB_ANY_DEPTH_INDEX,
  VALIDATION_SUMMARY_GLOB,
];

/**
 * Familles de pages PUREMENT documentaires, sans application à ouvrir à leur place : elles ont au
 * moins deux niveaux sous la langue et `depth` segments après `segment`. Leur adresse est refusée au
 * repli SPA avec ou sans slash final, avec `index.html`, et avec n'importe quels paramètres
 * (`?utm_source=`, `?foo=`), qu'un motif ancré par `$` ne verrait pas (Workbox teste `pathname + search`).
 */
const DOCUMENT_ONLY_FAMILIES = [
  { segment: 'places', depth: 2 }, // /places/moon/tycho/
  { segment: 'activities', depth: 1 }, // /activities/eclipse/
] as const;

/** Navigations à NE PAS remplacer par l'app shell en cache. */
export const NAVIGATE_FALLBACK_DENYLIST: RegExp[] = [
  // Cloudflare Pages sert privacy.html à /privacy après redirection.
  /^\/privacy(?:\.html)?$/,
  // Un segment unique sans point : les pages de corps, sans toucher `/`, `/assets/…` ni les
  // fichiers.
  /^\/[^/.]+\/?$/,
  ...NESTED_SEGMENTS.map((nested) => new RegExp(`^\\/${nested}\\/[^/.]+\\/?$`)),
  // Les pages documentaires anglaises (`/methodology/`) tombent déjà sous la règle à un segment.
  ...LOCALISED_SEGMENTS.map(
    (segment) => new RegExp(`^\\/${segment}\\/[^/.]+\\/?$`)
  ),
  // Les pages d'éclipse et de mission traduites ont TROIS segments (`/es/eclipse/2026-08-12/`) :
  // c'est exactement le motif qui avait déjà été manqué une fois, décrit en tête de ce module.
  ...LOCALISED_SEGMENTS.flatMap((segment) =>
    NESTED_SEGMENTS.map(
      (nested) => new RegExp(`^\\/${segment}\\/${nested}\\/[^/.]+\\/?$`)
    )
  ),
  // Pages purement documentaires (GAL-PERF-PWA-001) : paramètres, slash final et `index.html` tolérés.
  ...DOCUMENT_ONLY_FAMILIES.map(
    ({ segment, depth }) =>
      new RegExp(
        `^\\/(?:(?:${LOCALISED_SEGMENTS.join('|')})\\/)?${segment}(?:\\/[^/.]+){${depth}}(?:\\/(?:index\\.html)?)?(?:\\?.*)?$`
      )
  ),
];

export const ECLIPSE_SEGMENT_FOR_TESTS = ECLIPSE_SEGMENT;
