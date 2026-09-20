/**
 * `/sources` : d'où vient chaque donnée et chaque image que Galaxy livre, et sous quelle licence.
 *
 * Rien ici n'est une copie : chaque tableau est lu au build dans le fichier qui fait foi.
 *   - textures : le registre `src/registry/products/` (couches livrées), croisé avec les couches que le
 *     catalogue livre réellement. Une couche SANS provenance fait échouer le build : une page qui
 *     la tairait mentirait par omission, et un contrôle qui l'ignorerait ne contrôlerait rien ;
 *   - données physiques : le registre `config/factSources.ts`, croisé avec les provenances que le
 *     catalogue déclare champ par champ (`realData.sources`) et ses valeurs non publiées ;
 *   - modèles de forme : le `ModelConfig` du catalogue (crédit, carte de couleur, albédo) ;
 *   - éphémérides : `public/assets/ephemerides/manifest.json` ;
 *   - éléments orbitaux : registres `src/registry/entities/` et `src/registry/interstellar/`, exposés par les façades `config/` ;
 *   - bibliothèques : `package.json` et le `package.json` de chaque dépendance installée ;
 *   - le texte juridique complet : `THIRD_PARTY_NOTICES.md`, rendu tel quel.
 *
 * Module PUR : données en entrée, pages en sortie.
 */
import type { CelestialConfig } from '@/types';
import { flattenBodies } from '@/config/catalog';
import { FACT_SOURCES } from '@/config/factSources';
import { EVENT_PROVIDERS } from '@/registry/providers/events';
import { ALL_FACT_FIELDS, bodyFact } from '@/core/bodyFacts';
import type { FactField, FactMethod } from '@/types';
import { SMALL_BODY_ELEMENTS } from '@/config/smallBodies';
import { INTERSTELLAR_OBJECTS } from '@/config/interstellar';
import { NAVIGABLE_TARGETS } from '@/config/navigable';
import { escapeHtml } from './bodyLandingPage';
import {
  type Bilingual,
  type DocLocale,
  type DocPage,
  DOC_LOCALES,
  docPath,
  docSection,
  docTable,
} from './documentPage';
import { displayNameResolver, type EphemerisManifest } from './methodologyPage';
import { renderMarkdown } from './markdown';

export interface TextureProvenance {
  body: string;
  layer: string;
  license: string;
  credit: string;
  sourceUrl?: string;
  illustrative?: boolean;
}

export interface DependencyNotice {
  name: string;
  version: string;
  license: string;
  homepage: string | null;
}

export interface SourcesInput {
  config: CelestialConfig;
  textures: readonly TextureProvenance[];
  manifest: EphemerisManifest;
  dependencies: readonly DependencyNotice[];
  /** Contenu de `THIRD_PARTY_NOTICES.md`. */
  notices: string;
  /** `https://github.com/…/blob/main` : où pointent les liens relatifs du texte juridique. */
  repositoryBlobUrl: string;
  /** Date ISO affichée comme date des données (celle du build). */
  updated: string;
  /**
   * Instantané des petits corps livré avec le build, LU dans
   * `public/assets/small-bodies/dataset.json` : ni la date ni le compte ne se retapent ici.
   */
  smallBodies: { retrieved: string; count: number };
  origin: string;
  /**
   * Hôtes que la CSP de production autorise en `connect-src` (`firebase.json`), hors `'self'`.
   * C'est la liste AUTORITAIRE des services que le navigateur d'un visiteur peut contacter :
   * chacun doit être décrit ci-dessous, et chaque description doit correspondre à un hôte.
   */
  connectHosts: readonly string[];
}

export interface LiveDataService {
  host: string;
  name: string;
  url: string;
  use: Bilingual;
  terms: Bilingual;
}

/**
 * Services contactés À L'EXÉCUTION, avec leur usage et leurs conditions.
 *
 * Les deux DERNIERS ne sont pas écrits ici : ils sont DÉRIVÉS des fiches d'événements du
 * registre (`src/registry/providers/`), qui portent déjà leur hôte, leur licence, la date de
 * lecture de leurs conditions et leur texte bilingue. Deux déclarations de la même chose
 * finissent par diverger, et c'est une page publiée.
 *
 * Les conditions ont été lues à la source le 2026-09-17 : Open-Meteo (README du dépôt
 * open-meteo et page « Terms » : données CC BY 4.0, API gratuite réservée à l'usage non
 * commercial, lien d'attribution demandé), citation ERA5 (page « Historical Weather API »),
 * NASA Earthdata « Data Use Guidance » (données EOSDIS sans restriction, citation demandée).
 * Cloudflare Web Analytics n'est pas une source de données : il est décrit dans la politique de
 * confidentialité, et déclaré ici comme tel pour que la liste reste égale à la CSP.
 */
export const LIVE_DATA_SERVICES: readonly LiveDataService[] = [
  {
    host: 'gibs.earthdata.nasa.gov',
    name: 'NASA GIBS (EOSDIS)',
    url: 'https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api',
    use: {
      en: 'Earth weather layers from satellites and reanalysis: VIIRS and MODIS (Terra, Aqua) clouds, IMERG precipitation, MERRA-2 surface air temperature.',
      fr: 'Couches météo terrestres issues de satellites et de réanalyse : nuages VIIRS et MODIS (Terra, Aqua), précipitations IMERG, température de l’air en surface MERRA-2.',
    },
    terms: {
      en: 'NASA EOSDIS data, no restriction on use; NASA is acknowledged as the source.',
      fr: 'Données NASA EOSDIS, sans restriction d’usage ; la NASA est citée comme source.',
    },
  },
  {
    host: 'api.open-meteo.com',
    name: 'Open-Meteo',
    url: 'https://open-meteo.com/',
    use: {
      en: 'Model weather layers (forecast and recent days): clouds, precipitation, wind, temperature, pressure, humidity.',
      fr: 'Couches météo de modèle (prévision et jours récents) : nuages, précipitations, vent, température, pression, humidité.',
    },
    terms: {
      en: 'Weather data by Open-Meteo.com, licensed under CC BY 4.0; values are resampled into map textures. Free API used under its non-commercial terms.',
      fr: 'Données météo par Open-Meteo.com, sous licence CC BY 4.0 ; les valeurs sont rééchantillonnées en textures de carte. API gratuite utilisée selon ses conditions non commerciales.',
    },
  },
  {
    host: 'archive-api.open-meteo.com',
    name: 'Open-Meteo Historical Weather API (ERA5)',
    url: 'https://open-meteo.com/en/docs/historical-weather-api',
    use: {
      en: 'The same model layers for past dates, from the ERA5 reanalysis.',
      fr: 'Les mêmes couches de modèle pour les dates passées, d’après la réanalyse ERA5.',
    },
    terms: {
      en: 'CC BY 4.0 through Open-Meteo. Hersbach, H. et al. (2023), ERA5 hourly data on single levels from 1940 to present, ECMWF, doi:10.24381/cds.adbb2d47. Generated using Copernicus Climate Change Service information.',
      fr: 'CC BY 4.0 via Open-Meteo. Hersbach, H. et al. (2023), ERA5 hourly data on single levels from 1940 to present, ECMWF, doi:10.24381/cds.adbb2d47. Generated using Copernicus Climate Change Service information.',
    },
  },
  ...Object.values(EVENT_PROVIDERS).map((provider): LiveDataService => ({
    host: provider.host,
    // Virgule et non deux-points : le tableau est rendu dans les deux langues, et le
    // français demande une espace avant le deux-points. La virgule évite la règle.
    name: `${provider.publisher}, ${provider.title}`,
    url: provider.url,
    use: provider.use,
    terms: provider.terms,
  })),
  {
    host: 'cloudflareinsights.com',
    name: 'Cloudflare Web Analytics',
    url: '/privacy.html',
    use: {
      en: 'Not a data source: cookieless visit counting, described in the privacy policy.',
      fr: 'Pas une source de données : comptage de visites sans cookie, décrit dans la politique de confidentialité.',
    },
    terms: {
      en: 'See the privacy policy.',
      fr: 'Voir la politique de confidentialité.',
    },
  },
];

/** Forme minimale de `firebase.json` lue pour la CSP. */
export interface FirebaseHostingConfig {
  hosting: { headers: { headers: { key: string; value: string }[] }[] };
}

/** Hôtes HTTPS de la directive `connect-src` de la CSP servie par Firebase. */
export function connectHostsFromFirebase(
  config: FirebaseHostingConfig
): string[] {
  const csp = config.hosting.headers
    .flatMap((rule) => rule.headers)
    .find((header) => header.key === 'Content-Security-Policy')?.value;
  const connectSrc = /(?:^|;)\s*connect-src ([^;]+)/.exec(csp ?? '')?.[1];
  if (!connectSrc)
    throw new Error('firebase.json : connect-src introuvable dans la CSP');
  return connectSrc
    .trim()
    .split(/\s+/)
    .filter((source) => source.startsWith('https://'))
    .map((source) => new URL(source).host);
}

/** Hôtes de la CSP sans description, et descriptions sans hôte : les deux doivent être vides. */
export function liveServiceMismatch(connectHosts: readonly string[]): {
  undescribed: string[];
  unused: string[];
} {
  const described = new Set(LIVE_DATA_SERVICES.map((s) => s.host));
  const allowed = new Set(connectHosts);
  return {
    undescribed: connectHosts.filter((h) => !described.has(h)),
    unused: [...described].filter((h) => !allowed.has(h)),
  };
}

/** Une couche de texture livrée par le catalogue : ce que la page doit sourcer. */
export interface ShippedTextureLayer {
  body: string;
  layer: string;
}

/**
 * Toutes les couches de texture que le catalogue charge réellement : chaque couche déclarée
 * dans `textureResolutions` avec au moins une résolution, plus l'anneau.
 */
export function shippedTextureLayers(
  config: CelestialConfig
): ShippedTextureLayer[] {
  const layers: ShippedTextureLayer[] = [];
  for (const [body, cfg] of flattenBodies(config)) {
    for (const [layer, resolutions] of Object.entries(
      cfg.textureResolutions ?? {}
    ))
      if (Array.isArray(resolutions) && resolutions.length > 0)
        layers.push({ body, layer });
    if (cfg.ring && cfg.ring.textureResolutions.length > 0)
      layers.push({ body, layer: 'ring' });
  }
  return layers;
}

/** Couches livrées sans entrée de provenance — doit être vide pour publier. */
export function missingTextureProvenance(
  config: CelestialConfig,
  textures: readonly TextureProvenance[]
): ShippedTextureLayer[] {
  const known = new Set(textures.map((t) => `${t.body}/${t.layer}`));
  return shippedTextureLayers(config).filter(
    (l) => !known.has(`${l.body}/${l.layer}`)
  );
}

const LICENSE_LABELS: Record<string, Bilingual> = {
  'public-domain': { en: 'Public domain', fr: 'Domaine public' },
  generated: {
    en: 'Generated by this project',
    fr: 'Générée par ce projet',
  },
};

const LAYER_LABELS: Record<string, Bilingual> = {
  surface: { en: 'surface', fr: 'surface' },
  clouds: { en: 'clouds', fr: 'nuages' },
  lights: { en: 'night lights', fr: 'lumières nocturnes' },
  normalMap: { en: 'relief (normal map)', fr: 'relief (normal map)' },
  spec: { en: 'land/ocean mask', fr: 'masque terre/mer' },
  ring: { en: 'ring', fr: 'anneau' },
};

const JD_UNIX_EPOCH = 2_440_587.5;
const isoFromJd = (jd: number): string =>
  new Date((jd - JD_UNIX_EPOCH) * 86_400_000).toISOString().slice(0, 10);

const link = (url: string, text: string): string =>
  `<a href="${escapeHtml(url)}" rel="noopener noreferrer">${text}</a>`;

export function sourcesPages(input: SourcesInput): DocPage[] {
  const missing = missingTextureProvenance(input.config, input.textures);
  if (missing.length > 0)
    throw new Error(
      `page /sources : couche(s) de texture livrée(s) sans fiche livrée dans src/registry/products/ : ${missing.map((m) => `${m.body}/${m.layer}`).join(', ')}`
    );
  if (input.dependencies.length === 0)
    throw new Error('page /sources : aucune dépendance lue dans package.json');
  const services = liveServiceMismatch(input.connectHosts);
  if (services.undescribed.length > 0 || services.unused.length > 0)
    throw new Error(
      `page /sources : services en direct non alignés sur la CSP (non décrits : ${services.undescribed.join(', ') || 'aucun'} ; décrits mais absents : ${services.unused.join(', ') || 'aucun'})`
    );
  return DOC_LOCALES.map((locale) => sourcesPage(input, locale));
}

function sourcesPage(input: SourcesInput, locale: DocLocale): DocPage {
  const { config, textures, manifest, dependencies, origin, smallBodies } =
    input;
  const L = (text: Bilingual): string => text[locale];
  const name = displayNameResolver(config);
  const flat = flattenBodies(config);
  const sections: string[] = [];

  sections.push(
    `      <section><p>${L({
      en: `Every table below is read at build time from the file that is authoritative for it, so this page cannot fall out of date with what the app actually ships. How positions are computed, and how accurate they are, is explained on the <a href="${docPath('methodology', locale)}">methodology page</a>.`,
      fr: `Chaque tableau ci-dessous est lu au build dans le fichier qui fait foi : cette page ne peut pas se désynchroniser de ce que l’application livre réellement. La façon dont les positions sont calculées, et leur précision, est expliquée sur la <a href="${docPath('methodology', locale)}">page de méthodologie</a>.`,
    })}</p></section>`
  );

  // ── Données physiques ──
  // Tout est COMPTÉ dans le catalogue, avec la même règle que la fiche et les pages de corps
  // (`core/bodyFacts.ts`) : ce qui s'affiche, ce qui est dérivé, ce qui attend encore sa source.
  const FACT_FIELDS: FactField[] = [...ALL_FACT_FIELDS];
  const FIELD_LABELS: Record<FactField, Bilingual> = {
    radiusKm: { en: 'radius', fr: 'rayon' },
    massKg: { en: 'mass', fr: 'masse' },
    gravity: { en: 'gravity', fr: 'gravité' },
    meanTempC: { en: 'mean temperature', fr: 'température moyenne' },
    moonCount: { en: 'known moons', fr: 'lunes connues' },
    axialTilt: { en: 'axial tilt', fr: 'obliquité' },
    distanceAU: { en: 'mean distance', fr: 'distance moyenne' },
    orbitPeriodDays: { en: 'orbital period', fr: 'période orbitale' },
    rotationPeriod: { en: 'sidereal rotation', fr: 'rotation sidérale' },
    launchDate: { en: 'launch date', fr: 'date de lancement' },
    firstObservation: { en: 'first observation', fr: 'première observation' },
    eccentricity: { en: 'eccentricity', fr: 'excentricité' },
    perihelionAU: { en: 'perihelion distance', fr: 'distance de périhélie' },
  };
  const perSource = new Map<
    string,
    { bodies: Set<string>; fields: Set<FactField>; methods: Set<FactMethod> }
  >();
  let shownFacts = 0;
  let derivedFacts = 0;
  let unsourcedFacts = 0;
  let unpublishedFacts = 0;
  // Les onze sondes et les trois interstellaires comptent ici comme n'importe quel corps : ils
  // ont une fiche, et depuis le lot 8b des faits sourcés. Ils n'ont en revanche ni texture ni
  // modèle 3D, donc ils n'entrent pas dans les tableaux qui suivent.
  for (const [body, cfg] of [...flat, ...NAVIGABLE_TARGETS]) {
    if (cfg.kind === 'skybox') continue;
    for (const field of FACT_FIELDS) {
      const entry = bodyFact(cfg, field);
      if (entry.status === 'unknown') {
        if (entry.reason.unsourced) unsourcedFacts++;
        else unpublishedFacts++;
      }
      if (entry.status !== 'value') continue;
      shownFacts++;
      if (entry.provenance.method === 'derived') derivedFacts++;
      const row = perSource.get(entry.provenance.source) ?? {
        bodies: new Set(),
        fields: new Set(),
        methods: new Set(),
      };
      row.bodies.add(body);
      row.fields.add(field);
      row.methods.add(entry.provenance.method);
      perSource.set(entry.provenance.source, row);
    }
  }
  const METHOD_LABELS: Record<FactMethod, Bilingual> = {
    measured: { en: 'measured', fr: 'mesurée' },
    derived: { en: 'derived', fr: 'dérivée' },
    illustrative: { en: 'illustrative', fr: 'illustrative' },
  };
  const factRows = Object.entries(FACT_SOURCES)
    .filter(([id]) => perSource.has(id))
    .map(([id, source]) => {
      const row = perSource.get(id)!;
      const reference = [
        source.kind === 'preprint'
          ? L({ en: 'preprint', fr: 'prépublication' })
          : 'journal' in source
            ? source.journal
            : undefined,
        'published' in source ? source.published.slice(0, 4) : undefined,
      ]
        .filter(Boolean)
        .join(', ');
      return [
        link(source.url, escapeHtml(`${source.publisher}, ${source.title}`)) +
          (reference ? ` (${escapeHtml(reference)})` : ''),
        escapeHtml(
          [...row.bodies]
            .map((b) => name(b, locale))
            .sort((a, b) => a.localeCompare(b, locale))
            .join(', ')
        ),
        escapeHtml(
          FACT_FIELDS.filter((f) => row.fields.has(f))
            .map((f) => L(FIELD_LABELS[f]))
            .join(', ')
        ),
        escapeHtml([...row.methods].map((m) => L(METHOD_LABELS[m])).join(', ')),
      ];
    });
  sections.push(
    docSection(
      'physical-data',
      L({ en: 'Physical data', fr: 'Données physiques' }),
      `<p>${L({
        en: `Each value on a body’s information card and public page cites a primary source: a space agency, an agency database, or a published article, never an encyclopaedia. A <strong>derived</strong> value is computed from published ones (a mass from the published GM, a radius from a diameter), and the card says how. ${shownFacts} values are shown, ${derivedFacts} of them derived. ${unsourcedFacts} values the simulation uses are not shown because they are not yet traced to a primary source, and ${unpublishedFacts} have no single value to publish (a range, an upper limit, or a quantity that varies too much across the body or its orbit for one number): the card says why instead of showing a number.`,
        fr: `Chaque valeur de la fiche d’un corps et de sa page publique cite une source primaire : une agence spatiale, une base de données d’agence ou un article publié, jamais une encyclopédie. Une valeur <strong>dérivée</strong> est calculée à partir de valeurs publiées (une masse depuis le GM publié, un rayon depuis un diamètre), et la fiche dit comment. ${shownFacts} valeurs sont affichées, dont ${derivedFacts} dérivées. ${unsourcedFacts} valeurs utilisées par la simulation ne sont pas affichées faute de source primaire rattachée, et ${unpublishedFacts} n’ont pas de valeur unique à publier (une plage, une limite supérieure, ou une grandeur qui varie trop sur le corps ou son orbite pour un seul chiffre) : la fiche dit pourquoi au lieu d’afficher un chiffre.`,
      })}</p>` +
        docTable(
          L({
            en: 'Primary sources of the physical data',
            fr: 'Sources primaires des données physiques',
          }),
          [
            L({ en: 'Source', fr: 'Source' }),
            L({ en: 'Bodies', fr: 'Corps' }),
            L({ en: 'Values', fr: 'Valeurs' }),
            L({ en: 'Method', fr: 'Méthode' }),
          ],
          factRows
        )
    )
  );

  // ── Textures ──
  const shipped = new Set(
    shippedTextureLayers(config).map((l) => `${l.body}/${l.layer}`)
  );
  const textureRows = textures
    .filter((t) => shipped.has(`${t.body}/${t.layer}`))
    .sort(
      (a, b) =>
        name(a.body, locale).localeCompare(name(b.body, locale), locale) ||
        a.layer.localeCompare(b.layer)
    )
    .map((t) => [
      escapeHtml(name(t.body, locale)),
      escapeHtml(LAYER_LABELS[t.layer]?.[locale] ?? t.layer),
      escapeHtml(LICENSE_LABELS[t.license]?.[locale] ?? t.license),
      // Une texture générée n'a pas de tiers à créditer : on le dit dans la langue de la page
      // plutôt que de citer la note technique du fichier de provenance.
      t.license === 'generated'
        ? L({
            en: 'Procedural texture, no third-party material',
            fr: 'Texture procédurale, aucun contenu tiers',
          })
        : t.sourceUrl
          ? link(t.sourceUrl, escapeHtml(t.credit))
          : escapeHtml(t.credit),
      t.illustrative
        ? L({ en: 'illustrative', fr: 'illustrative' })
        : L({
            en: 'from real data',
            fr: 'issue de données réelles',
          }),
    ]);
  sections.push(
    docSection(
      'textures',
      L({ en: 'Surface textures', fr: 'Textures de surface' }),
      `<p>${L({
        en: 'An <strong>illustrative</strong> surface is not a scientific map: either no spacecraft has imaged the body well enough, or the images were never assembled into a global mosaic. Credits are quoted as recorded in the project’s provenance file.',
        fr: 'Une surface <strong>illustrative</strong> n’est pas une carte scientifique : soit aucune sonde n’a photographié le corps assez bien, soit les images n’ont jamais été assemblées en mosaïque globale. Les crédits sont cités tels qu’inscrits dans le fichier de provenance du projet.',
      })}</p>` +
        docTable(
          L({
            en: 'One row per texture layer the app loads',
            fr: 'Une ligne par couche de texture chargée par l’application',
          }),
          [
            L({ en: 'Body', fr: 'Corps' }),
            L({ en: 'Layer', fr: 'Couche' }),
            L({ en: 'Licence', fr: 'Licence' }),
            L({ en: 'Credit', fr: 'Crédit' }),
            L({ en: 'Nature', fr: 'Nature' }),
          ],
          textureRows
        )
    )
  );

  // ── Modèles de forme ──
  const modelRows = [...flat.entries()]
    .filter(([, cfg]) => cfg.model)
    .map(([body, cfg]) => {
      const model = cfg.model!;
      return [
        escapeHtml(name(body, locale)),
        escapeHtml(model.credit[locale]),
        escapeHtml(
          model.colourSource?.[locale] ??
            L({
              en: 'No global map published: uniform colour at the published albedo',
              fr: 'Aucune carte globale publiée : couleur uniforme à l’albédo publié',
            })
        ),
        `${model.albedo.toString().replace('.', locale === 'fr' ? ',' : '.')} (${escapeHtml(model.albedoSource)})`,
        escapeHtml(model.resolutions.join(', ')),
      ];
    });
  sections.push(
    docSection(
      'models',
      L({ en: '3D shape models', fr: 'Modèles de forme 3D' }),
      `<p>${L({
        en: 'Irregular bodies are drawn from their real mission shape models, reduced for the web without inventing geometry. Brightness is set by the published albedo; contrast and colour come from a mission map when one exists.',
        fr: 'Les corps irréguliers sont dessinés d’après leurs vrais modèles de forme de mission, allégés pour le web sans inventer de géométrie. La luminosité suit l’albédo publié ; contrastes et couleur viennent d’une carte de mission quand elle existe.',
      })}</p>` +
        docTable(
          L({ en: 'Shape models shipped', fr: 'Modèles de forme livrés' }),
          [
            L({ en: 'Body', fr: 'Corps' }),
            L({ en: 'Shape model', fr: 'Modèle de forme' }),
            L({ en: 'Colour source', fr: 'Source de la couleur' }),
            L({ en: 'Albedo (reference)', fr: 'Albédo (référence)' }),
            L({ en: 'Levels of detail', fr: 'Niveaux de détail' }),
          ],
          modelRows
        )
    )
  );

  // ── Éphémérides ──
  const ephemerisRows = Object.entries(manifest.bodies).map(([body, e]) => [
    escapeHtml(name(body, locale)),
    `<code>${escapeHtml(e.target)}</code>`,
    escapeHtml(
      e.center === 'sun'
        ? L({ en: 'Sun', fr: 'Soleil' })
        : name(e.center, locale)
    ),
    String(e.stepDays),
    `${isoFromJd(e.startJdTdb)} → ${isoFromJd(e.startJdTdb + (e.sampleCount - 1) * e.stepDays)}`,
  ]);
  sections.push(
    docSection(
      'ephemerides',
      L({ en: 'Ephemerides', fr: 'Éphémérides' }),
      `<p>${L({
        en: `Precomputed position files come from ${escapeHtml(manifest.source)} (state vectors, frame ${escapeHtml(manifest.frame)}), generated on ${escapeHtml(manifest.generatedAt.slice(0, 10))}. The Horizons target identifier is given so that anyone can request the same data. Planets, the Moon and the Galilean moons otherwise come from ${link('https://github.com/cosinekitty/astronomy', 'astronomy-engine')}; the optional small-body layer reads a snapshot of ${escapeHtml(String(smallBodies.count))} orbits taken from the ${link('https://ssd-api.jpl.nasa.gov/doc/sbdb_query.html', 'JPL Small-Body Database')} on ${escapeHtml(smallBodies.retrieved)} and shipped with the build: queried from a browser, that service replies without the cross-origin header a browser needs in order to accept the reply, so nothing ever reached the page.`,
        fr: `Les fichiers de positions précalculées viennent de ${escapeHtml(manifest.source)} (vecteurs d’état, repère ${escapeHtml(manifest.frame)}), générés le ${escapeHtml(manifest.generatedAt.slice(0, 10))}. L’identifiant de cible Horizons est donné pour que chacun puisse demander les mêmes données. Planètes, Lune et lunes galiléennes viennent sinon d’${link('https://github.com/cosinekitty/astronomy', 'astronomy-engine')} ; la couche optionnelle des petits corps lit un instantané de ${escapeHtml(String(smallBodies.count))} orbites relevé le ${escapeHtml(smallBodies.retrieved)} dans la ${link('https://ssd-api.jpl.nasa.gov/doc/sbdb_query.html', 'JPL Small-Body Database')} et livré avec le build : interrogé depuis un navigateur, ce service répond sans l’en-tête d’origine croisée qu’il faut à celui-ci pour accepter la réponse, et rien n’arrivait donc jamais jusqu’à la page.`,
      })}</p>` +
        docTable(
          L({ en: 'JPL Horizons files', fr: 'Fichiers JPL Horizons' }),
          [
            L({ en: 'Body', fr: 'Corps' }),
            L({ en: 'Horizons target', fr: 'Cible Horizons' }),
            L({ en: 'Centre', fr: 'Centre' }),
            L({ en: 'Step (days)', fr: 'Pas (jours)' }),
            L({ en: 'Coverage (TDB)', fr: 'Couverture (TDB)' }),
          ],
          ephemerisRows,
          3
        )
    )
  );

  // ── Éléments orbitaux ──
  const elementRows = [
    ...SMALL_BODY_ELEMENTS.map((el) => [
      escapeHtml(name(el.name, locale)),
      escapeHtml(el.epoch.slice(0, 10)),
      el.barycentric
        ? L({
            en: 'Solar System barycentre',
            fr: 'barycentre du Système solaire',
          })
        : L({ en: 'Sun', fr: 'Soleil' }),
    ]),
    ...INTERSTELLAR_OBJECTS.map((object) => [
      `${escapeHtml(name(object.name, locale))} (${escapeHtml(object.designation)})`,
      escapeHtml(object.elements.epoch.toISOString().slice(0, 10)),
      L({ en: 'Sun (hyperbolic orbit)', fr: 'Soleil (orbite hyperbolique)' }),
    ]),
  ];
  sections.push(
    docSection(
      'elements',
      L({ en: 'Orbital elements', fr: 'Éléments orbitaux' }),
      `<p>${L({
        en: 'Osculating elements taken from the live NASA/JPL Horizons API at the epoch shown, by the scripts in the repository; they are data values, not copied from a third-party compilation.',
        fr: 'Éléments osculateurs pris dans l’API NASA/JPL Horizons à l’époque indiquée, par les scripts du dépôt ; ce sont des valeurs de données, pas une copie d’une compilation tierce.',
      })}</p>` +
        docTable(
          L({ en: 'Keplerian element sets', fr: 'Jeux d’éléments képlériens' }),
          [
            L({ en: 'Body', fr: 'Corps' }),
            L({ en: 'Epoch', fr: 'Époque' }),
            L({ en: 'Centre', fr: 'Centre' }),
          ],
          elementRows
        )
    )
  );

  // ── Services en direct ──
  sections.push(
    docSection(
      'live-data',
      L({ en: 'Live data services', fr: 'Services de données en direct' }),
      `<p>${L({
        en: 'Your browser contacts these services while the app runs, for the layers that use them. The list is checked at build time against the hosts that the site’s security policy allows.',
        fr: 'Votre navigateur contacte ces services pendant l’utilisation de l’application, pour les couches qui s’en servent. La liste est vérifiée au build contre les hôtes qu’autorise la politique de sécurité du site.',
      })}</p>` +
        docTable(
          L({
            en: 'Services contacted at runtime',
            fr: 'Services contactés à l’exécution',
          }),
          [
            L({ en: 'Service', fr: 'Service' }),
            L({ en: 'Used for', fr: 'Usage' }),
            L({ en: 'Terms and credit', fr: 'Conditions et crédit' }),
          ],
          LIVE_DATA_SERVICES.map((service) => [
            link(service.url, escapeHtml(service.name)),
            escapeHtml(L(service.use)),
            escapeHtml(L(service.terms)),
          ])
        )
    )
  );

  // ── Bibliothèques ──
  sections.push(
    docSection(
      'software',
      L({ en: 'Software', fr: 'Logiciels' }),
      docTable(
        L({
          en: 'Libraries bundled with the app',
          fr: 'Bibliothèques embarquées dans l’application',
        }),
        [
          L({ en: 'Library', fr: 'Bibliothèque' }),
          L({ en: 'Version', fr: 'Version' }),
          L({ en: 'Licence', fr: 'Licence' }),
        ],
        dependencies.map((d) => [
          d.homepage
            ? link(d.homepage, escapeHtml(d.name))
            : escapeHtml(d.name),
          escapeHtml(d.version),
          escapeHtml(d.license),
        ])
      )
    )
  );

  // ── Texte juridique complet ──
  sections.push(
    docSection(
      'notices',
      L({
        en: 'Third-party notices (full text)',
        fr: 'Mentions tierces (texte intégral, en anglais)',
      }),
      `<div class="doc-notices" lang="en">${renderMarkdown(
        // Le titre de premier niveau du fichier doublerait celui de la section.
        // `[^\n]*` et non `.*` : sous Windows le fichier arrive en CRLF, et `.` ne franchit pas
        // le `\r` — le titre restait alors en place, en double.
        input.notices.replace(/^#\s+[^\n]*\n/, ''),
        { repositoryBlobUrl: input.repositoryBlobUrl, headingShift: 1 }
      )}</div>`
    )
  );

  return {
    slug: 'sources',
    locale,
    canonical: `${origin}${docPath('sources', locale)}`,
    title: L({
      en: 'Sources and credits: data, images and licences',
      fr: 'Sources et crédits : données, images et licences',
    }),
    description: L({
      en: 'Where every texture, shape model, ephemeris and orbital element in Galaxy comes from, with its licence and credit, read from the project’s own provenance files.',
      fr: 'D’où vient chaque texture, modèle de forme, éphéméride et élément orbital de Galaxy, avec sa licence et son crédit, lus dans les fichiers de provenance du projet.',
    }),
    body: sections.join('\n'),
    updated: input.updated,
  };
}
