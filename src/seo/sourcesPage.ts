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
 *   - blocs de fiche (découverte, missions, instruments, formations observées) et noms de surface :
 *     les `*Index.json` de `src/config/`, lus par `./cardBlockSources` (ligne 44.1) ;
 *   - bibliothèques : `package.json` et le `package.json` de chaque dépendance installée ;
 *   - le texte juridique complet : `THIRD_PARTY_NOTICES.md`, rendu tel quel.
 *
 * Module PUR : données en entrée, pages en sortie.
 */
import type { CelestialConfig } from '@/types';
import { flattenBodies } from '@/config/catalog';
import { FACT_SOURCES } from '@/config/factSources';
import {
  EVENT_PROVIDERS,
  TILE_PROVIDERS,
} from '@/registry/providers/runtimeServices';
import { ALL_FACT_FIELDS, bodyFact } from '@/core/bodyFacts';
import { groundResolutionKm, type TileMatrixShape } from '@/core/tilePyramid';
import type { FactField, FactMethod } from '@/types';
import { SMALL_BODY_ELEMENTS } from '@/config/smallBodies';
import { INTERSTELLAR_OBJECTS } from '@/config/interstellar';
import { NAVIGABLE_TARGETS } from '@/config/navigable';
import { escapeHtml } from './bodyLandingPage';
import {
  type DocText,
  type DocLocale,
  type DocPage,
  DOC_LOCALES,
  docPath,
  docSection,
  docTable,
  formatQuantity,
} from './documentPage';
import { displayNameResolver, type EphemerisManifest } from './methodologyPage';
import { renderMarkdown } from './markdown';
import FLYBY_PLAN from '@/config/flybyEncounters.json';
import { citationSection, type CitationMetadata } from './citation';
import { blockLabel, cardBlockSourceRows } from './cardBlockSources';

export interface TextureProvenance {
  body: string;
  layer: string;
  license: string;
  credit: string;
  sourceUrl?: string;
  illustrative?: boolean;
}

interface DependencyNotice {
  name: string;
  version: string;
  license: string;
  homepage: string | null;
}

/**
 * Un jeu de hauteurs livré (lot 9, phase 9D), tel que `/sources` le publie : ce que la fiche
 * déclare, et ce que le manifeste du cuiseur MESURE. La page ne recopie ni l'un ni l'autre, elle
 * les reçoit.
 */
export interface HeightfieldProvenance {
  body: string;
  title: string;
  mission: string;
  instrument: string;
  credit: string;
  sourceUrl: string;
  /**
   * Niveau le plus FIN du socle global (la Terre en cuit quatre, 3 à 6, parce que son imagerie
   * commence au niveau 3), et la grille de la pyramide telle que le manifeste la déclare : la
   * finesse affichée se calcule sur ELLE, pas sur la grille de Trek (lot 48).
   */
  baseLevel: number;
  /**
   * Les boîtes de GRAND RELIEF (ni socle global, ni aire nommée) : leur nombre et leur niveau le
   * plus fin, ou `null`. Le socle se lisait sur le maximum de TOUTES les entrées non nommées, si
   * bien que la page annonçait la finesse des boîtes de montagne comme celle du socle global (lot
   * 48 : 489 m au lieu de 1,85 km sur la grille de GIBS ; lot 53 : 153 m sur celle de Sentinel-2).
   */
  reliefBoxes: { count: number; level: number } | null;
  matrix: TileMatrixShape;
  /** Hôte qui sert les tuiles quand ce n'est pas le site lui-même, sinon `null`. */
  servedBy: string | null;
  /**
   * Aires nommées cuites plus finement, avec le niveau atteint et la finesse de leur SOURCE
   * (pixels par degré) : la grille servie peut être plus fine que la source qui la nourrit (les
   * aires de Mars : 182 échantillons par degré au niveau 7, pour une source à 128), et la page
   * ne doit pas laisser lire le pas de la grille comme celui de la mesure.
   */
  areas: readonly {
    name: string;
    level: number;
    sourcePixelsPerDegree?: number;
  }[];
  tiles: number;
  bytes: number;
}

/** Le manifeste d'un jeu de hauteurs, dans ce que la page en lit. */
export interface HeightManifestSummary {
  matrix: TileMatrixShape;
  tileOrigin?: string;
  tiles: number;
  bytes: number;
  coverage: {
    level: number;
    levels?: number[];
    global?: boolean;
    area?: { name: string };
    sourcePixelsPerDegree?: number;
  }[];
}

/**
 * La ligne de relief d'un jeu : la fiche pour l'identité, le manifeste du cuiseur pour les
 * MESURES. Une seule lecture, partagée par le plugin Vite et la garde de la page, pour que la
 * page ne soit jamais comparée à une copie d'elle-même.
 */
export function heightfieldProvenance(
  product: {
    body: string;
    title: string;
    mission: string;
    instrument: string;
    providers: readonly { name: string }[];
    links: readonly { rel: string; href: string }[];
  },
  manifest: HeightManifestSummary
): HeightfieldProvenance {
  return {
    body: product.body,
    title: product.title,
    mission: product.mission,
    instrument: product.instrument,
    credit: product.providers.map((p) => p.name).join(' · '),
    sourceUrl:
      product.links.find((l) => l.rel === 'via')?.href ??
      product.links.find((l) => l.rel === 'describedby')!.href,
    baseLevel: Math.max(
      ...manifest.coverage
        .filter((entry) => entry.global)
        .flatMap((entry) => entry.levels ?? [entry.level])
    ),
    reliefBoxes: ((boxes) =>
      boxes.length === 0
        ? null
        : {
            count: boxes.length,
            level: Math.max(
              ...boxes.flatMap((entry) => entry.levels ?? [entry.level])
            ),
          })(manifest.coverage.filter((entry) => !entry.global && !entry.area)),
    matrix: manifest.matrix,
    servedBy: manifest.tileOrigin ? new URL(manifest.tileOrigin).host : null,
    areas: manifest.coverage
      .filter((entry) => entry.area)
      .map((entry) => ({
        name: entry.area!.name,
        level: Math.max(...(entry.levels ?? [entry.level])),
        sourcePixelsPerDegree: entry.sourcePixelsPerDegree,
      })),
    tiles: manifest.tiles,
    bytes: manifest.bytes,
  };
}

/** Le manifeste d'un jeu de bâtiments, dans ce que la page en lit. */
export interface BuildingManifestSummary {
  id: string;
  title: string;
  totals: {
    tiles: number;
    bytes: number;
    sourceFeatures: number;
    byOrigin: Record<string, number>;
  };
  source: {
    name: string;
    license: string;
    licenseUrl: string;
    release?: string;
    readFrom: string;
    readTo: string;
  };
}

/** La ligne d'un jeu de bâtiments : tout vient du manifeste écrit par le cuiseur. */
export interface BuildingSetProvenance {
  id: string;
  title: string;
  source: string;
  license: string;
  licenseUrl: string;
  /** Version de la source quand elle en a une (Overture publie par version datée). */
  release: string | null;
  read: string;
  buildings: number;
  withHeight: number;
  tiles: number;
  bytes: number;
}

export function buildingSetProvenance(
  manifest: BuildingManifestSummary
): BuildingSetProvenance {
  const { totals, source } = manifest;
  return {
    id: manifest.id,
    title: manifest.title,
    source: source.name,
    license: source.license,
    licenseUrl: source.licenseUrl,
    release: source.release ?? null,
    read:
      source.readFrom === source.readTo
        ? source.readFrom
        : `${source.readFrom} → ${source.readTo}`,
    buildings: totals.sourceFeatures,
    // Une hauteur « absente » est une emprise à plat : tout le reste porte une valeur, dont la
    // méthode est dite à l'écran par la légende.
    withHeight: Object.entries(totals.byOrigin)
      .filter(([origin]) => origin !== 'absent')
      .reduce((sum, [, n]) => sum + n, 0),
    tiles: totals.tiles,
    bytes: totals.bytes,
  };
}

export interface SourcesInput {
  /** Lue dans `CITATION.cff`, seul endroit où le DOI est écrit (cf. `seo/citation.ts`). */
  citation: CitationMetadata;
  config: CelestialConfig;
  textures: readonly TextureProvenance[];
  /** Jeux de hauteurs livrés, avec les mesures de leur manifeste. */
  heightfields: readonly HeightfieldProvenance[];
  /** Jeux de bâtiments livrés, avec les mesures de leur manifeste. */
  buildings: readonly BuildingSetProvenance[];
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
  use: DocText;
  terms: DocText;
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
    host: 'galaxy-data.adrianguichard.dev',
    name: 'Galaxy data service (NOAA GFS, ECMWF ERA5)',
    url: 'https://www.nco.ncep.noaa.gov/pmb/products/gfs/',
    use: {
      en: 'Model weather layers from 1940 to sixteen days ahead, at 1°, served to every visitor from our own server: the ERA5 reanalysis for the past (hourly, from the public ARCO-ERA5 copy, built once per requested hour), then the NOAA GFS model, fetched once per model run, for the last days and the forecast.',
      fr: 'Couches météo de modèle de 1940 à seize jours à venir, au pas de 1°, servies à tous les visiteurs depuis notre propre serveur : la réanalyse ERA5 pour le passé (horaire, depuis la copie publique ARCO-ERA5, construite une fois par heure demandée), puis le modèle GFS de la NOAA, récupéré une fois par cycle, pour les derniers jours et la prévision.',
      es: 'Capas meteorológicas modelizadas desde 1940 hasta dieciséis días por delante, a 1°, servidas a todos los visitantes desde nuestro propio servidor: el reanálisis ERA5 para el pasado (horario, desde la copia pública ARCO-ERA5, construido una vez por hora solicitada) y luego el modelo GFS de la NOAA, obtenido una vez por ciclo, para los últimos días y el pronóstico.',
      'pt-BR':
        'Camadas meteorológicas modeladas de 1940 até dezesseis dias à frente, a 1°, servidas a todos os visitantes a partir do nosso próprio servidor: a reanálise ERA5 para o passado (horária, a partir da cópia pública ARCO-ERA5, construída uma vez por hora solicitada) e depois o modelo GFS da NOAA, obtido uma vez por ciclo, para os últimos dias e a previsão.',
    },
    terms: {
      en: 'NOAA NCEP GFS, a U.S. Government work in the public domain; NOAA is credited as the source. ERA5 under CC BY 4.0: Hersbach, H. et al. (2023), ERA5 hourly data on single levels from 1940 to present, ECMWF, doi:10.24381/cds.adbb2d47, read through ARCO-ERA5 (Google Research). Modified: subsampled from 0.25° to 1° and quantised; relative humidity derived from temperature and dew point. Generated using Copernicus Climate Change Service information.',
      fr: 'NOAA NCEP GFS, œuvre du gouvernement des États-Unis, dans le domaine public ; la NOAA est citée comme source. ERA5 sous CC BY 4.0 : Hersbach, H. et al. (2023), ERA5 hourly data on single levels from 1940 to present, ECMWF, doi:10.24381/cds.adbb2d47, lu par ARCO-ERA5 (Google Research). Modifié : sous-échantillonné de 0,25° à 1° et quantifié ; humidité relative dérivée de la température et du point de rosée. Generated using Copernicus Climate Change Service information.',
      es: 'NOAA NCEP GFS, obra del Gobierno de los Estados Unidos en el dominio público; se cita a la NOAA como fuente. ERA5 bajo CC BY 4.0: Hersbach, H. et al. (2023), ERA5 hourly data on single levels from 1940 to present, ECMWF, doi:10.24381/cds.adbb2d47, leído a través de ARCO-ERA5 (Google Research). Modificado: submuestreado de 0,25° a 1° y cuantificado; humedad relativa derivada de la temperatura y del punto de rocío. Generado con información del Servicio de Cambio Climático de Copernicus.',
      'pt-BR':
        'NOAA NCEP GFS, obra do Governo dos Estados Unidos em domínio público; a NOAA é citada como fonte. ERA5 sob CC BY 4.0: Hersbach, H. et al. (2023), ERA5 hourly data on single levels from 1940 to present, ECMWF, doi:10.24381/cds.adbb2d47, lido através do ARCO-ERA5 (Google Research). Modificado: subamostrado de 0,25° para 1° e quantizado; umidade relativa derivada da temperatura e do ponto de orvalho. Gerado com informações do Serviço de Mudanças Climáticas do Copernicus.',
    },
  },
  {
    host: 'galaxy-static.galaxy-3d.workers.dev',
    name: 'Galaxy static files (textures, shape models)',
    url: 'https://developers.cloudflare.com/workers/static-assets/',
    use: {
      en: 'The textures and shape models that dress the bodies, published by this project and served by Cloudflare.',
      fr: 'Les textures et les modèles de forme qui habillent les corps, publiés par ce projet et servis par Cloudflare.',
      es: 'Las texturas y los modelos de forma que visten los cuerpos, publicados por este proyecto y servidos por Cloudflare.',
      'pt-BR':
        'As texturas e os modelos de forma que revestem os corpos, publicados por este projeto e servidos pela Cloudflare.',
    },
    terms: {
      en: 'Files we publish ourselves; the provenance and licence of each texture are on its own page.',
      fr: 'Des fichiers que nous publions nous-mêmes ; la provenance et la licence de chaque texture sont sur sa propre page.',
      es: 'Archivos que publicamos nosotros mismos; la procedencia y la licencia de cada textura están en su propia página.',
      'pt-BR':
        'Arquivos que nós mesmos publicamos; a procedência e a licença de cada textura estão na sua própria página.',
    },
  },
  {
    host: 'api.open-meteo.com',
    name: 'Open-Meteo',
    url: 'https://open-meteo.com/',
    use: {
      en: 'The same model layers when the Galaxy data service does not answer.',
      fr: 'Les mêmes couches de modèle quand le service de données de Galaxy ne répond pas.',
      es: 'Las mismas capas modelizadas cuando el servicio de datos de Galaxy no responde.',
      'pt-BR':
        'As mesmas camadas modeladas quando o serviço de dados da Galaxy não responde.',
    },
    terms: {
      en: 'Weather data by Open-Meteo.com, licensed under CC BY 4.0; values are resampled into map textures. Free API used under its non-commercial terms.',
      fr: 'Données météo par Open-Meteo.com, sous licence CC BY 4.0 ; les valeurs sont rééchantillonnées en textures de carte. API gratuite utilisée selon ses conditions non commerciales.',
      es: 'Datos meteorológicos de Open-Meteo.com, bajo licencia CC BY 4.0; los valores se remuestrean en texturas de mapa. API gratuita usada según sus condiciones no comerciales.',
      'pt-BR':
        'Dados meteorológicos da Open-Meteo.com, sob licença CC BY 4.0; os valores são reamostrados em texturas de mapa. API gratuita usada conforme os seus termos não comerciais.',
    },
  },
  {
    host: 'archive-api.open-meteo.com',
    name: 'Open-Meteo Historical Weather API (ERA5)',
    url: 'https://open-meteo.com/en/docs/historical-weather-api',
    use: {
      en: 'The same model layers for past dates, from the ERA5 reanalysis, when the Galaxy data service does not answer or has reached its hourly cap.',
      fr: 'Les mêmes couches de modèle pour les dates passées, d’après la réanalyse ERA5, quand le service de données de Galaxy ne répond pas ou a atteint son plafond horaire.',
      es: 'Las mismas capas modelizadas para fechas pasadas, a partir del reanálisis ERA5, cuando el servicio de datos de Galaxy no responde o ha alcanzado su límite horario.',
      'pt-BR':
        'As mesmas camadas modeladas para datas passadas, a partir da reanálise ERA5, quando o serviço de dados da Galaxy não responde ou atingiu o seu limite por hora.',
    },
    terms: {
      en: 'CC BY 4.0 through Open-Meteo. Hersbach, H. et al. (2023), ERA5 hourly data on single levels from 1940 to present, ECMWF, doi:10.24381/cds.adbb2d47. Generated using Copernicus Climate Change Service information.',
      fr: 'CC BY 4.0 via Open-Meteo. Hersbach, H. et al. (2023), ERA5 hourly data on single levels from 1940 to present, ECMWF, doi:10.24381/cds.adbb2d47. Generated using Copernicus Climate Change Service information.',
      es: 'CC BY 4.0 a través de Open-Meteo. Hersbach, H. et al. (2023), ERA5 hourly data on single levels from 1940 to present, ECMWF, doi:10.24381/cds.adbb2d47. Generado con información del Servicio de Cambio Climático de Copernicus.',
      'pt-BR':
        'CC BY 4.0 através da Open-Meteo. Hersbach, H. et al. (2023), ERA5 hourly data on single levels from 1940 to present, ECMWF, doi:10.24381/cds.adbb2d47. Gerado com informações do Serviço de Mudanças Climáticas do Copernicus.',
    },
  },
  ...[...Object.values(EVENT_PROVIDERS), ...Object.values(TILE_PROVIDERS)].map(
    (provider): LiveDataService => ({
      host: provider.host,
      // Virgule et non deux-points : le tableau est rendu dans les deux langues, et le
      // français demande une espace avant le deux-points. La virgule évite la règle.
      name: `${provider.publisher}, ${provider.title}`,
      url: provider.url,
      use: provider.use,
      terms: provider.terms,
    })
  ),
  {
    host: 'cloudflareinsights.com',
    name: 'Cloudflare Web Analytics',
    url: '/privacy.html',
    use: {
      en: 'Not a data source: cookieless visit counting, described in the privacy policy.',
      fr: 'Pas une source de données : comptage de visites sans cookie, décrit dans la politique de confidentialité.',
      es: 'No es una fuente de datos: recuento de visitas sin cookies, descrito en la política de privacidad.',
      'pt-BR':
        'Não é uma fonte de dados: contagem de visitas sem cookies, descrita na política de privacidade.',
    },
    terms: {
      en: 'See the privacy policy.',
      fr: 'Voir la politique de confidentialité.',
      es: 'Véase la política de privacidad.',
      'pt-BR': 'Veja a política de privacidade.',
    },
  },
];

/** Forme minimale de `firebase.json` lue pour la CSP. */
export interface FirebaseHostingConfig {
  hosting: { headers: { headers: { key: string; value: string }[] }[] };
}

/** Hôtes HTTPS de la directive `connect-src` de la CSP servie par Firebase. */
/**
 * Le separateur decimal par langue. Trois ternaires `fr ? ',' : '.'` vivaient ici, et chacun
 * servait un point a l'espagnol et au portugais du Bresil, qui ecrivent la virgule.
 */
const DECIMAL: DocText = { en: '.', fr: ',', es: ',', 'pt-BR': ',' };

/** Un libellé de l'application cité dans le texte, avec les guillemets de chaque langue. */
const QUOTE: Record<DocLocale, (text: string) => string> = {
  en: (text) => `“${text}”`,
  fr: (text) => `«\u00a0${text}\u00a0»`,
  es: (text) => `«${text}»`,
  'pt-BR': (text) => `“${text}”`,
};

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

const LICENSE_LABELS: Record<string, DocText> = {
  'public-domain': {
    en: 'Public domain',
    fr: 'Domaine public',
    es: 'Dominio público',
    'pt-BR': 'Domínio público',
  },
  generated: {
    en: 'Generated by this project',
    fr: 'Générée par ce projet',
    es: 'Generado por este proyecto',
    'pt-BR': 'Gerado por este projeto',
  },
};

const LAYER_LABELS: Record<string, DocText> = {
  surface: {
    en: 'surface',
    fr: 'surface',
    es: 'superficie',
    'pt-BR': 'superfície',
  },
  clouds: { en: 'clouds', fr: 'nuages', es: 'nubes', 'pt-BR': 'nuvens' },
  lights: {
    en: 'night lights',
    fr: 'lumières nocturnes',
    es: 'luces nocturnas',
    'pt-BR': 'luzes noturnas',
  },
  normalMap: {
    en: 'relief (normal map)',
    fr: 'relief (normal map)',
    es: 'relieve (mapa de normales)',
    'pt-BR': 'relevo (mapa de normais)',
  },
  spec: {
    en: 'land/ocean mask',
    fr: 'masque terre/mer',
    es: 'máscara tierra/océano',
    'pt-BR': 'máscara terra/oceano',
  },
  ring: { en: 'ring', fr: 'anneau', es: 'anillo', 'pt-BR': 'anel' },
};

const JD_UNIX_EPOCH = 2_440_587.5;
const isoFromJd = (jd: number): string =>
  new Date((jd - JD_UNIX_EPOCH) * 86_400_000).toISOString().slice(0, 10);
/** La même date à la minute : un segment de survol couvre quelques jours, pas des années. */
const isoMinuteFromJd = (jd: number): string =>
  new Date(Math.round((jd - JD_UNIX_EPOCH) * 1440) * 60_000)
    .toISOString()
    .slice(0, 16)
    .replace('T', ' ');

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
  const L = (text: DocText): string => text[locale];
  const name = displayNameResolver(config);
  const flat = flattenBodies(config);
  const sections: string[] = [];

  sections.push(
    `      <section><p>${L({
      en: `Every table below is read at build time from the file that is authoritative for it, so this page cannot fall out of date with what the app actually ships. How positions are computed, and how accurate they are, is explained on the <a href="${docPath('methodology', locale)}">methodology page</a>.`,
      fr: `Chaque tableau ci-dessous est lu au build dans le fichier qui fait foi : cette page ne peut pas se désynchroniser de ce que l’application livre réellement. La façon dont les positions sont calculées, et leur précision, est expliquée sur la <a href="${docPath('methodology', locale)}">page de méthodologie</a>.`,
      es: `Cada tabla de esta página se lee en la compilación en el archivo que es su fuente autorizada, de modo que esta página no puede quedar desfasada respecto a lo que la aplicación entrega realmente. Cómo se calculan las posiciones, y con qué exactitud, se explica en la <a href="${docPath('methodology', locale)}">página de metodología</a>.`,
      'pt-BR': `Cada tabela desta página é lida na compilação no arquivo que é a sua fonte autorizada, de modo que esta página não pode ficar defasada em relação ao que o aplicativo realmente entrega. Como as posições são calculadas, e com que exatidão, está explicado na <a href="${docPath('methodology', locale)}">página de metodologia</a>.`,
    })}</p></section>`
  );

  // ── Données physiques ──
  // Tout est COMPTÉ dans le catalogue, avec la même règle que la fiche et les pages de corps
  // (`core/bodyFacts.ts`) : ce qui s'affiche, ce qui est dérivé, ce qui attend encore sa source.
  const FACT_FIELDS: FactField[] = [...ALL_FACT_FIELDS];
  const FIELD_LABELS: Record<FactField, DocText> = {
    temperature1BarK: {
      en: 'temperature at 1 bar',
      fr: 'température à 1 bar',
      es: 'temperatura a 1 bar',
      'pt-BR': 'temperatura a 1 bar',
    },
    temperature01BarK: {
      en: 'temperature at 0.1 bar',
      fr: 'température à 0,1 bar',
      es: 'temperatura a 0,1 bar',
      'pt-BR': 'temperatura a 0,1 bar',
    },
    density1BarKgM3: {
      en: 'density at 1 bar',
      fr: 'masse volumique à 1 bar',
      es: 'densidad a 1 bar',
      'pt-BR': 'densidade a 1 bar',
    },
    scaleHeightKm: {
      en: 'scale height',
      fr: 'hauteur d’échelle',
      es: 'altura de escala',
      'pt-BR': 'altura de escala',
    },
    windSpeedMs: {
      en: 'winds',
      fr: 'vents',
      es: 'vientos',
      'pt-BR': 'ventos',
    },
    meanMolecularWeight: {
      en: 'mean molecular weight',
      fr: 'masse molaire moyenne',
      es: 'masa molecular media',
      'pt-BR': 'massa molecular média',
    },
    radiusKm: { en: 'radius', fr: 'rayon', es: 'radio', 'pt-BR': 'raio' },
    massKg: { en: 'mass', fr: 'masse', es: 'masa', 'pt-BR': 'massa' },
    gravity: {
      en: 'gravity',
      fr: 'gravité',
      es: 'gravedad',
      'pt-BR': 'gravidade',
    },
    // Noms NEUTRES (2026-10-03) : ce compte regroupe tous les corps, et le champ n'y désigne pas
    // la même grandeur partout (moyenne, à 1 bar, effective, de surface ; sidérale, synodique).
    // Le libellé exact de chaque corps vient de `core/factQuantity.ts`.
    meanTempC: {
      en: 'temperature',
      fr: 'température',
      es: 'temperatura',
      'pt-BR': 'temperatura',
    },
    moonCount: {
      en: 'known moons',
      fr: 'lunes connues',
      es: 'lunas conocidas',
      'pt-BR': 'luas conhecidas',
    },
    axialTilt: {
      en: 'axial tilt',
      fr: 'obliquité',
      es: 'inclinación axial',
      'pt-BR': 'inclinação axial',
    },
    distanceAU: {
      en: 'mean distance',
      fr: 'distance moyenne',
      es: 'distancia media',
      'pt-BR': 'distância média',
    },
    orbitPeriodDays: {
      en: 'orbital period',
      fr: 'période orbitale',
      es: 'periodo orbital',
      'pt-BR': 'período orbital',
    },
    rotationPeriod: {
      en: 'rotation period',
      fr: 'période de rotation',
      es: 'periodo de rotación',
      'pt-BR': 'período de rotação',
    },
    launchDate: {
      en: 'launch date',
      fr: 'date de lancement',
      es: 'fecha de lanzamiento',
      'pt-BR': 'data de lançamento',
    },
    firstObservation: {
      en: 'first observation',
      fr: 'première observation',
      es: 'primera observación',
      'pt-BR': 'primeira observação',
    },
    eccentricity: {
      en: 'eccentricity',
      fr: 'excentricité',
      es: 'excentricidad',
      'pt-BR': 'excentricidade',
    },
    perihelionAU: {
      en: 'perihelion distance',
      fr: 'distance de périhélie',
      es: 'distancia del perihelio',
      'pt-BR': 'distância do periélio',
    },
    launchVehicle: {
      en: 'launch vehicle',
      fr: 'lanceur',
      es: 'lanzador',
      'pt-BR': 'veículo lançador',
    },
    launchSite: {
      en: 'launch site',
      fr: 'site de lancement',
      es: 'base de lanzamiento',
      'pt-BR': 'base de lançamento',
    },
    absoluteMagnitude: {
      en: 'absolute magnitude',
      fr: 'magnitude absolue',
      es: 'magnitud absoluta',
      'pt-BR': 'magnitude absoluta',
    },
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
  const METHOD_LABELS: Record<FactMethod, DocText> = {
    measured: {
      en: 'measured',
      fr: 'mesurée',
      es: 'medido',
      'pt-BR': 'medido',
    },
    derived: {
      en: 'derived',
      fr: 'dérivée',
      es: 'derivado',
      'pt-BR': 'derivado',
    },
    illustrative: {
      en: 'illustrative',
      fr: 'illustrative',
      es: 'ilustrativo',
      'pt-BR': 'ilustrativo',
    },
  };
  const factRows = Object.entries(FACT_SOURCES)
    .filter(([id]) => perSource.has(id))
    .map(([id, source]) => {
      const row = perSource.get(id)!;
      const reference = [
        source.kind === 'preprint'
          ? L({
              en: 'preprint',
              fr: 'prépublication',
              es: 'prepublicación',
              'pt-BR': 'pré-publicação',
            })
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
      L({
        en: 'Physical data',
        fr: 'Données physiques',
        es: 'Datos físicos',
        'pt-BR': 'Dados físicos',
      }),
      `<p>${L({
        en: `Each value on a body’s information card and public page cites a primary source: a space agency, an agency database, or a published article, never an encyclopaedia. A <strong>derived</strong> value is computed from published ones (a mass from the published GM, a radius from a diameter), and the card says how. ${shownFacts} values are shown, ${derivedFacts} of them derived. ${unsourcedFacts} values the simulation uses are not shown because they are not yet traced to a primary source, and ${unpublishedFacts} have no single value to publish (a range, an upper limit, a quantity that varies too much across the body or its orbit for one number, or a published figure that describes a different quantity): the card says why instead of showing a number.`,
        fr: `Chaque valeur de la fiche d’un corps et de sa page publique cite une source primaire : une agence spatiale, une base de données d’agence ou un article publié, jamais une encyclopédie. Une valeur <strong>dérivée</strong> est calculée à partir de valeurs publiées (une masse depuis le GM publié, un rayon depuis un diamètre), et la fiche dit comment. ${shownFacts} valeurs sont affichées, dont ${derivedFacts} dérivées. ${unsourcedFacts} valeurs utilisées par la simulation ne sont pas affichées faute de source primaire rattachée, et ${unpublishedFacts} n’ont pas de valeur unique à publier (une plage, une limite supérieure, une grandeur qui varie trop sur le corps ou son orbite pour un seul chiffre, ou un chiffre publié qui décrit une autre grandeur) : la fiche dit pourquoi au lieu d’afficher un chiffre.`,
        es: `Cada valor de la ficha de un cuerpo y de su página pública cita una fuente primaria: una agencia espacial, una base de datos de agencia o un artículo publicado, nunca una enciclopedia. Un valor <strong>derivado</strong> se calcula a partir de valores publicados (una masa a partir del GM publicado, un radio a partir de un diámetro), y la ficha dice cómo. Se muestran ${shownFacts} valores, ${derivedFacts} de ellos derivados. ${unsourcedFacts} valores que la simulación usa no se muestran porque aún no están rastreados hasta una fuente primaria, y ${unpublishedFacts} no tienen un valor único que publicar (un rango, un límite superior, una magnitud que varía demasiado en el cuerpo o en su órbita para un solo número, o una cifra publicada que describe otra magnitud): la ficha dice por qué en lugar de mostrar un número.`,
        'pt-BR': `Cada valor da ficha de um corpo e da sua página pública cita uma fonte primária: uma agência espacial, uma base de dados de agência ou um artigo publicado, nunca uma enciclopédia. Um valor <strong>derivado</strong> é calculado a partir de valores publicados (uma massa a partir do GM publicado, um raio a partir de um diâmetro), e a ficha diz como. São exibidos ${shownFacts} valores, ${derivedFacts} deles derivados. ${unsourcedFacts} valores que a simulação usa não são exibidos porque ainda não estão rastreados até uma fonte primária, e ${unpublishedFacts} não têm um valor único a publicar (um intervalo, um limite superior, uma grandeza que varia demais no corpo ou na sua órbita para um único número, ou um número publicado que descreve outra grandeza): a ficha diz por quê em vez de exibir um número.`,
      })}</p>` +
        docTable(
          L({
            en: 'Primary sources of the physical data',
            fr: 'Sources primaires des données physiques',
            es: 'Fuentes primarias de los datos físicos',
            'pt-BR': 'Fontes primárias dos dados físicos',
          }),
          [
            L({ en: 'Source', fr: 'Source', es: 'Fuente', 'pt-BR': 'Fonte' }),
            L({ en: 'Bodies', fr: 'Corps', es: 'Cuerpos', 'pt-BR': 'Corpos' }),
            L({
              en: 'Values',
              fr: 'Valeurs',
              es: 'Valores',
              'pt-BR': 'Valores',
            }),
            L({ en: 'Method', fr: 'Méthode', es: 'Método', 'pt-BR': 'Método' }),
          ],
          factRows
        )
    )
  );

  // ── Blocs de fiche (ligne 44.1) ──
  // Lus dans les index livrés, jamais recopiés : cf. `./cardBlockSources`.
  const cardBlockRows = cardBlockSourceRows().map((row) => [
    link(row.url, escapeHtml(`${row.publisher}, ${row.title}`)) +
      (row.rights
        ? ` (${link(row.rights.statedAt, escapeHtml(LICENSE_LABELS[row.rights.id]?.[locale] ?? row.rights.id))})`
        : ''),
    escapeHtml(
      row.usedBy.map((key) => QUOTE[locale](blockLabel(key, locale))).join(', ')
    ),
    escapeHtml(row.coverage(locale)),
    escapeHtml(row.asOf),
  ]);
  sections.push(
    docSection(
      'card-blocks',
      L({
        en: 'Discovery, missions, instruments and surface names',
        fr: 'Découverte, missions, instruments et noms de surface',
        es: 'Descubrimiento, misiones, instrumentos y nombres de superficie',
        'pt-BR': 'Descoberta, missões, instrumentos e nomes de superfície',
      }),
      `<p>${L({
        en: 'Several blocks of a body’s information card, and the surface feature names drawn on a body, are read from indexes built offline from primary sources, and their per-body data is downloaded on demand, never at startup. Each card block names its source on the card itself; this table lists them all, with what each one covers and the date of its data, both read in the shipped index.',
        fr: 'Plusieurs blocs de la fiche d’un corps, ainsi que les noms de formations dessinés sur un corps, sont lus dans des index construits hors ligne depuis des sources primaires, et leurs données par corps sont téléchargées à la demande, jamais au démarrage. Chaque bloc de fiche nomme sa source sur la fiche même ; ce tableau les réunit, avec ce que chacune couvre et la date de ses données, toutes deux lues dans l’index livré.',
        es: 'Varios bloques de la ficha de un cuerpo, así como los nombres de formaciones dibujados sobre un cuerpo, se leen en índices construidos fuera de línea a partir de fuentes primarias, y sus datos por cuerpo se descargan bajo demanda, nunca al inicio. Cada bloque de la ficha nombra su fuente en la propia ficha; esta tabla las reúne, con lo que cubre cada una y la fecha de sus datos, ambas leídas en el índice entregado.',
        'pt-BR':
          'Vários blocos da ficha de um corpo, assim como os nomes de formações desenhados sobre um corpo, são lidos em índices construídos offline a partir de fontes primárias, e os seus dados por corpo são baixados sob demanda, nunca na inicialização. Cada bloco da ficha nomeia a sua fonte na própria ficha; esta tabela as reúne, com o que cada uma cobre e a data dos seus dados, ambas lidas no índice entregue.',
      })}</p>` +
        docTable(
          L({
            en: 'Sources of the information card blocks',
            fr: 'Sources des blocs de la fiche',
            es: 'Fuentes de los bloques de la ficha',
            'pt-BR': 'Fontes dos blocos da ficha',
          }),
          [
            L({ en: 'Source', fr: 'Source', es: 'Fuente', 'pt-BR': 'Fonte' }),
            L({
              en: 'Shown in',
              fr: 'Affichée dans',
              es: 'Se muestra en',
              'pt-BR': 'Exibida em',
            }),
            L({
              en: 'Coverage',
              fr: 'Couverture',
              es: 'Cobertura',
              'pt-BR': 'Cobertura',
            }),
            L({
              en: 'Data as of',
              fr: 'Données au',
              es: 'Datos a fecha de',
              'pt-BR': 'Dados em',
            }),
          ],
          cardBlockRows
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
            es: 'Textura procedimental, sin material de terceros',
            'pt-BR': 'Textura procedural, sem material de terceiros',
          })
        : t.sourceUrl
          ? link(t.sourceUrl, escapeHtml(t.credit))
          : escapeHtml(t.credit),
      t.illustrative
        ? L({
            en: 'illustrative',
            fr: 'illustrative',
            es: 'ilustrativa',
            'pt-BR': 'ilustrativa',
          })
        : L({
            en: 'from real data',
            fr: 'issue de données réelles',
            es: 'a partir de datos reales',
            'pt-BR': 'a partir de dados reais',
          }),
    ]);
  sections.push(
    docSection(
      'textures',
      L({
        en: 'Surface textures',
        fr: 'Textures de surface',
        es: 'Texturas de superficie',
        'pt-BR': 'Texturas de superfície',
      }),
      `<p>${L({
        en: 'An <strong>illustrative</strong> surface is not a scientific map: either no spacecraft has imaged the body well enough, or the images were never assembled into a global mosaic. Credits are quoted as recorded in the project’s provenance file.',
        fr: 'Une surface <strong>illustrative</strong> n’est pas une carte scientifique : soit aucune sonde n’a photographié le corps assez bien, soit les images n’ont jamais été assemblées en mosaïque globale. Les crédits sont cités tels qu’inscrits dans le fichier de provenance du projet.',
        es: 'Una superficie <strong>ilustrativa</strong> no es un mapa científico: o ninguna sonda ha fotografiado el cuerpo lo bastante bien, o las imágenes nunca se ensamblaron en un mosaico global. Los créditos se citan tal como están registrados en el archivo de procedencia del proyecto.',
        'pt-BR':
          'Uma superfície <strong>ilustrativa</strong> não é um mapa científico: ou nenhuma sonda fotografou o corpo bem o bastante, ou as imagens nunca foram montadas em um mosaico global. Os créditos são citados tal como registrados no arquivo de procedência do projeto.',
      })}</p>` +
        docTable(
          L({
            en: 'One row per texture layer the app loads',
            fr: 'Une ligne par couche de texture chargée par l’application',
            es: 'Una fila por capa de textura que carga la aplicación',
            'pt-BR': 'Uma linha por camada de textura que o aplicativo carrega',
          }),
          [
            L({ en: 'Body', fr: 'Corps', es: 'Cuerpo', 'pt-BR': 'Corpo' }),
            L({ en: 'Layer', fr: 'Couche', es: 'Capa', 'pt-BR': 'Camada' }),
            L({
              en: 'Licence',
              fr: 'Licence',
              es: 'Licencia',
              'pt-BR': 'Licença',
            }),
            L({
              en: 'Credit',
              fr: 'Crédit',
              es: 'Crédito',
              'pt-BR': 'Crédito',
            }),
            L({
              en: 'Nature',
              fr: 'Nature',
              es: 'Naturaleza',
              'pt-BR': 'Natureza',
            }),
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
          model.albedo === undefined
            ? L({
                en: 'Draped with the body’s own surface texture, credited in the texture table',
                fr: 'Drapé de la texture de surface du corps, créditée dans le tableau des textures',
                es: 'Drapeado con la propia textura de superficie del cuerpo, acreditada en la tabla de texturas',
                'pt-BR':
                  'Drapeado com a própria textura de superfície do corpo, creditada na tabela de texturas',
              })
            : (model.colourSource?.[locale] ??
                L({
                  en: 'No global map published: uniform colour at the published albedo',
                  fr: 'Aucune carte globale publiée : couleur uniforme à l’albédo publié',
                  es: 'Ningún mapa global publicado: color uniforme al albedo publicado',
                  'pt-BR':
                    'Nenhum mapa global publicado: cor uniforme no albedo publicado',
                }))
        ),
        model.albedo === undefined
          ? L({
              en: 'not used',
              fr: 'sans objet',
              es: 'no utilizado',
              'pt-BR': 'não utilizado',
            })
          : `${model.albedo.toString().replace('.', DECIMAL[locale])} (${escapeHtml(model.albedoSource ?? '')})`,
        escapeHtml(model.resolutions.join(', ')),
      ];
    });
  sections.push(
    docSection(
      'models',
      L({
        en: '3D shape models',
        fr: 'Modèles de forme 3D',
        es: 'Modelos de forma 3D',
        'pt-BR': 'Modelos de forma 3D',
      }),
      `<p>${L({
        en: 'Irregular bodies are drawn from their real mission shape models, reduced for the web without inventing geometry. Brightness is set by the published albedo; contrast and colour come from a mission map when one exists.',
        fr: 'Les corps irréguliers sont dessinés d’après leurs vrais modèles de forme de mission, allégés pour le web sans inventer de géométrie. La luminosité suit l’albédo publié ; contrastes et couleur viennent d’une carte de mission quand elle existe.',
        es: 'Los cuerpos irregulares se dibujan a partir de sus modelos de forma reales de misión, reducidos para la web sin inventar geometría. El brillo lo fija el albedo publicado; el contraste y el color vienen de un mapa de misión cuando existe.',
        'pt-BR':
          'Os corpos irregulares são desenhados a partir dos seus modelos de forma reais de missão, reduzidos para a web sem inventar geometria. O brilho é fixado pelo albedo publicado; o contraste e a cor vêm de um mapa de missão quando ele existe.',
      })}</p>` +
        docTable(
          L({
            en: 'Shape models shipped',
            fr: 'Modèles de forme livrés',
            es: 'Modelos de forma entregados',
            'pt-BR': 'Modelos de forma entregues',
          }),
          [
            L({ en: 'Body', fr: 'Corps', es: 'Cuerpo', 'pt-BR': 'Corpo' }),
            L({
              en: 'Shape model',
              fr: 'Modèle de forme',
              es: 'Modelo de forma',
              'pt-BR': 'Modelo de forma',
            }),
            L({
              en: 'Colour source',
              fr: 'Source de la couleur',
              es: 'Fuente del color',
              'pt-BR': 'Fonte da cor',
            }),
            L({
              en: 'Albedo (reference)',
              fr: 'Albédo (référence)',
              es: 'Albedo (referencia)',
              'pt-BR': 'Albedo (referência)',
            }),
            L({
              en: 'Levels of detail',
              fr: 'Niveaux de détail',
              es: 'Niveles de detalle',
              'pt-BR': 'Níveis de detalhe',
            }),
          ],
          modelRows
        )
    )
  );

  // ── Relief ──
  if (input.heightfields.length > 0) {
    const format = (value: number): string =>
      value >= 1000
        ? `${(value / 1000).toFixed(2).replace('.', DECIMAL[locale])} km`
        : `${Math.round(value)} m`;
    const radiusOf = (body: string): number =>
      flat.get(body)?.realData?.radiusKm ?? 0;
    const metres = (
      body: string,
      level: number,
      matrix: TileMatrixShape
    ): string =>
      format(groundResolutionKm(level, radiusOf(body), matrix) * 1000);
    /**
     * Le pas de la SOURCE d'une aire, dit seulement quand il est plus GROSSIER que celui de la
     * grille servie : la ligne `Olympus Mons (325 m)` se lisait comme une mesure à 325 m, alors
     * que MOLA est à 128 pixels par degré, soit 462 m.
     */
    const sourcePitch = (
      body: string,
      area: { level: number; sourcePixelsPerDegree?: number },
      matrix: TileMatrixShape
    ): string => {
      if (!area.sourcePixelsPerDegree) return '';
      const sourceM =
        ((2 * Math.PI * radiusOf(body)) / 360 / area.sourcePixelsPerDegree) *
        1000;
      const gridM =
        groundResolutionKm(area.level, radiusOf(body), matrix) * 1000;
      return sourceM > gridM * 1.05
        ? `, ${L({ en: 'source', fr: 'source', es: 'fuente', 'pt-BR': 'fonte' })} ${format(sourceM)}`
        : '';
    };
    const reliefRows = input.heightfields.map((set) => [
      escapeHtml(name(set.body, locale)),
      set.sourceUrl
        ? link(set.sourceUrl, escapeHtml(set.title))
        : escapeHtml(set.title),
      escapeHtml(
        metres(set.body, set.baseLevel, set.matrix) +
          (set.reliefBoxes
            ? ` · ${L({
                en: `${set.reliefBoxes.count} high-relief boxes: `,
                fr: `${set.reliefBoxes.count} boîtes de grand relief : `,
                es: `${set.reliefBoxes.count} cajas de gran relieve: `,
                'pt-BR': `${set.reliefBoxes.count} caixas de grande relevo: `,
              })}${metres(set.body, set.reliefBoxes.level, set.matrix)}`
            : '')
      ),
      set.areas.length === 0
        ? L({ en: 'none', fr: 'aucune', es: 'ninguno', 'pt-BR': 'nenhum' })
        : escapeHtml(
            set.areas
              .map(
                (area) =>
                  `${area.name} (${metres(set.body, area.level, set.matrix)}${sourcePitch(set.body, area, set.matrix)})`
              )
              .join(', ')
          ),
      escapeHtml(
        `${set.tiles} · ${(set.bytes / 1e6)
          .toFixed(1)
          .replace(
            '.',
            DECIMAL[locale]
          )} ${L({ en: 'MB', fr: 'Mo', es: 'MB', 'pt-BR': 'MB' })}`
      ) +
        (set.servedBy
          ? ` · ${L({
              en: 'served by',
              fr: 'servies par',
              es: 'servidas por',
              'pt-BR': 'servidas por',
            })} ${escapeHtml(set.servedBy)}`
          : ''),
    ]);
    sections.push(
      docSection(
        'relief',
        L({ en: 'Relief', fr: 'Relief', es: 'Relieve', 'pt-BR': 'Relevo' }),
        `<p>${L({
          en: 'On approach, the ground is displaced by measured altitudes, never by invented detail: no fractal relief, and no shaded-relief image used as geometry. The tiles are cooked offline from a published elevation model, because no tiled height source is served with the cross-origin header a browser needs. A global base covers the whole body; a few named areas, framed on their published feature, are cooked finer.',
          fr: 'À l’approche, le sol est déplacé par des altitudes mesurées, jamais par du détail inventé : aucun relief fractal, et aucune image d’ombrage employée comme géométrie. Les tuiles sont cuites hors ligne depuis un modèle d’élévation publié, faute de source de hauteurs tuilée servie avec l’en-tête d’origine croisée qu’exige un navigateur. Un socle global couvre le corps entier ; quelques aires nommées, cadrées sur leur entité publiée, sont cuites plus finement.',
          es: 'Al acercarse, el suelo se desplaza con altitudes medidas, nunca con detalle inventado: sin relieve fractal, y sin usar una imagen de relieve sombreado como geometría. Las teselas se cuecen fuera de línea a partir de un modelo de elevación publicado, porque ninguna fuente de alturas en teselas se sirve con el encabezado de origen cruzado que un navegador necesita. Una base global cubre todo el cuerpo; unas pocas áreas nombradas, encuadradas en su formación publicada, se cuecen más finas.',
          'pt-BR':
            'Na aproximação, o solo é deslocado por altitudes medidas, nunca por detalhe inventado: sem relevo fractal, e sem usar uma imagem de relevo sombreado como geometria. Os blocos são cozidos offline a partir de um modelo de elevação publicado, porque nenhuma fonte de alturas em blocos é servida com o cabeçalho de origem cruzada que um navegador precisa. Uma base global cobre todo o corpo; algumas áreas nomeadas, enquadradas na sua formação publicada, são cozidas mais finas.',
        })}</p><p>${L({
          en: 'On the Earth, the elevation model gives the floor under the water (the oceans, and a few large lakes), whereas the imagery shows its surface. The bodies of water whose floor it publishes are therefore brought back to their level before cooking, outlined by the NASA GIBS water mask, and the manifest lists every body changed with its level. These tiles are too heavy for the site host and are served by the Galaxy data service.',
          fr: 'Sur la Terre, le modèle d’élévation donne le fond sous l’eau (les océans, et quelques grands lacs), alors que l’imagerie en montre la surface. Les étendues dont il publie le fond sont donc ramenées à leur niveau avant la cuisson, délimitées par le masque d’eau de NASA GIBS, et le manifeste liste chaque étendue modifiée avec son niveau. Ces tuiles sont trop lourdes pour l’hébergeur du site et sont servies par le service de données de Galaxy.',
          es: 'En la Tierra, el modelo de elevación da el fondo bajo el agua (los océanos y algunos grandes lagos), mientras que las imágenes muestran su superficie. Las masas de agua cuyo fondo publica se devuelven por tanto a su nivel antes de la cocción, delimitadas por la máscara de agua de NASA GIBS, y el manifiesto enumera cada masa modificada con su nivel. Estas teselas pesan demasiado para el alojamiento del sitio y las sirve el servicio de datos de Galaxy.',
          'pt-BR':
            'Na Terra, o modelo de elevação dá o fundo sob a água (os oceanos e alguns grandes lagos), enquanto as imagens mostram a sua superfície. As massas de água cujo fundo ele publica são portanto levadas de volta ao seu nível antes do cozimento, delimitadas pela máscara de água da NASA GIBS, e o manifesto lista cada massa modificada com o seu nível. Esses blocos são pesados demais para a hospedagem do site e são servidos pelo serviço de dados do Galaxy.',
        })}</p>` +
          docTable(
            L({
              en: 'Height tile sets',
              fr: 'Jeux de tuiles de hauteurs',
              es: 'Conjuntos de teselas de altura',
              'pt-BR': 'Conjuntos de blocos de altura',
            }),
            [
              L({ en: 'Body', fr: 'Corps', es: 'Cuerpo', 'pt-BR': 'Corpo' }),
              L({
                en: 'Elevation model',
                fr: 'Modèle d’élévation',
                es: 'Modelo de elevación',
                'pt-BR': 'Modelo de elevação',
              }),
              L({
                en: 'Global base',
                fr: 'Socle global',
                es: 'Base global',
                'pt-BR': 'Base global',
              }),
              L({
                en: 'Named areas',
                fr: 'Aires nommées',
                es: 'Áreas nombradas',
                'pt-BR': 'Áreas nomeadas',
              }),
              L({
                en: 'Tiles',
                fr: 'Tuiles',
                es: 'Teselas',
                'pt-BR': 'Blocos',
              }),
            ],
            reliefRows
          )
      )
    );
  }

  // ── Bâtiments ──
  if (input.buildings.length > 0) {
    const mb = (bytes: number): string =>
      `${(bytes / 1e6).toFixed(2).replace('.', DECIMAL[locale])} ${L({ en: 'MB', fr: 'Mo', es: 'MB', 'pt-BR': 'MB' })}`;
    const count = (n: number): string =>
      String(n).replace(/\B(?=(\d{3})+(?!\d))/g, locale === 'en' ? ',' : ' ');
    const buildingRows = input.buildings.map((set) => [
      escapeHtml(set.title),
      escapeHtml(set.source) +
        (set.release ? ` (${escapeHtml(set.release)})` : ''),
      link(set.licenseUrl, escapeHtml(set.license)),
      escapeHtml(set.read),
      escapeHtml(
        `${count(set.buildings)} · ${Math.round((100 * set.withHeight) / set.buildings)} %`
      ),
      escapeHtml(`${set.tiles} · ${mb(set.bytes)}`),
    ]);
    sections.push(
      docSection(
        'buildings',
        L({
          en: 'Buildings',
          fr: 'Bâtiments',
          es: 'Edificios',
          'pt-BR': 'Edifícios',
        }),
        `<p>${L({
          en: 'Near the ground, building footprints are drawn from open datasets, one set per source and never merged: each set keeps its own licence. A footprint without a published height stays flat, and the legend says where each height comes from.',
          fr: 'Près du sol, les emprises de bâtiments viennent de jeux ouverts, un jeu par source et jamais fusionnés : chaque jeu garde sa licence. Une emprise sans hauteur publiée reste à plat, et la légende dit d’où vient chaque hauteur.',
          es: 'Cerca del suelo, las huellas de edificios proceden de conjuntos abiertos, uno por fuente y nunca fusionados: cada conjunto conserva su licencia. Una huella sin altura publicada queda plana, y la leyenda dice de dónde viene cada altura.',
          'pt-BR':
            'Perto do solo, as pegadas de edifícios vêm de conjuntos abertos, um por fonte e nunca mesclados: cada conjunto mantém a sua licença. Uma pegada sem altura publicada fica plana, e a legenda diz de onde vem cada altura.',
        })}</p><p>${L({
          en: 'The sets drawn from OpenStreetMap through Overture Maps are databases derived from an ODbL database, and they are served under the ODbL. As that licence requires (section 4.6), the method that produced them is available free of charge: the baking script is in this project’s public repository, and the Overture release it reads is named in the table. The other sets are served under their own licence.',
          fr: 'Les jeux issus d’OpenStreetMap par Overture Maps sont des bases dérivées d’une base ODbL, et ils sont servis sous l’ODbL. Comme cette licence l’exige (section 4.6), la méthode qui les a produits est accessible gratuitement : le script de cuisson est dans le dépôt public du projet, et la version d’Overture qu’il lit est nommée dans le tableau. Les autres jeux sont servis sous leur propre licence.',
          es: 'Los conjuntos procedentes de OpenStreetMap a través de Overture Maps son bases derivadas de una base ODbL, y se sirven bajo la ODbL. Como exige esa licencia (sección 4.6), el método que los produjo es accesible gratuitamente: el script de cocción está en el repositorio público del proyecto, y la versión de Overture que lee figura en la tabla. Los demás conjuntos se sirven bajo su propia licencia.',
          'pt-BR':
            'Os conjuntos vindos do OpenStreetMap por meio do Overture Maps são bases derivadas de uma base ODbL, e são servidos sob a ODbL. Como essa licença exige (seção 4.6), o método que os produziu está disponível gratuitamente: o script de geração está no repositório público do projeto, e a versão do Overture que ele lê consta na tabela. Os demais conjuntos são servidos sob a sua própria licença.',
        })}</p>` +
          docTable(
            L({
              en: 'Building sets',
              fr: 'Jeux de bâtiments',
              es: 'Conjuntos de edificios',
              'pt-BR': 'Conjuntos de edifícios',
            }),
            [
              L({ en: 'Set', fr: 'Jeu', es: 'Conjunto', 'pt-BR': 'Conjunto' }),
              L({ en: 'Source', fr: 'Source', es: 'Fuente', 'pt-BR': 'Fonte' }),
              L({
                en: 'Licence',
                fr: 'Licence',
                es: 'Licencia',
                'pt-BR': 'Licença',
              }),
              L({
                en: 'Read on',
                fr: 'Lu le',
                es: 'Leído el',
                'pt-BR': 'Lido em',
              }),
              L({
                en: 'Buildings · with a height',
                fr: 'Bâtiments · avec hauteur',
                es: 'Edificios · con altura',
                'pt-BR': 'Edifícios · com altura',
              }),
              L({
                en: 'Tiles · size',
                fr: 'Tuiles · poids',
                es: 'Teselas · tamaño',
                'pt-BR': 'Blocos · tamanho',
              }),
            ],
            buildingRows
          )
      )
    );
  }

  // ── Éphémérides ──
  // Les segments de SURVOL (ligne 45.10) ont leur table à eux, plus bas : ils sont des dizaines.
  const ephemerisRows = Object.entries(manifest.bodies)
    .filter(([, e]) => !e.flyby && !e.detail)
    .map(([body, e]) => [
      // Un SEGMENT porte le nom de la sonde qu'il prolonge, pas sa clé de fichier.
      escapeHtml(name(e.segmentOf ?? body, locale)),
      // La solution substituée sur un intervalle (2026-10-06) : sans elle, qui redemande la cible
      // obtient d'autres vecteurs que le fichier (67P : jusqu'à 1 318 km en 2014-2016).
      `<code>${escapeHtml(e.target)}</code>` +
        (e.primary
          ? `<br>${L({
              en: `replaced by <code>${escapeHtml(e.primary.target)}</code> from ${escapeHtml(isoFromJd(e.primary.fromJdTdb))} to ${escapeHtml(isoFromJd(e.primary.toJdTdb))}`,
              fr: `remplacée par <code>${escapeHtml(e.primary.target)}</code> du ${escapeHtml(isoFromJd(e.primary.fromJdTdb))} au ${escapeHtml(isoFromJd(e.primary.toJdTdb))}`,
              es: `sustituida por <code>${escapeHtml(e.primary.target)}</code> del ${escapeHtml(isoFromJd(e.primary.fromJdTdb))} al ${escapeHtml(isoFromJd(e.primary.toJdTdb))}`,
              'pt-BR': `substituída por <code>${escapeHtml(e.primary.target)}</code> de ${escapeHtml(isoFromJd(e.primary.fromJdTdb))} a ${escapeHtml(isoFromJd(e.primary.toJdTdb))}`,
            })}`
          : '') +
        (e.segmentOf
          ? `<br>${L({
              en: `segment, ${e.impulses?.length ?? 0} manoeuvre${e.impulses?.length === 1 ? '' : 's'} read in the trajectory`,
              fr: `segment, ${e.impulses?.length ?? 0} manœuvre${e.impulses?.length === 1 ? ' lue' : 's lues'} dans la trajectoire`,
              es: `segmento, ${e.impulses?.length ?? 0} maniobra${e.impulses?.length === 1 ? ' leída' : 's leídas'} en la trayectoria`,
              'pt-BR': `segmento, ${e.impulses?.length ?? 0} manobra${e.impulses?.length === 1 ? ' lida' : 's lidas'} na trajetória`,
            })}`
          : ''),
      escapeHtml(
        e.center === 'sun'
          ? L({ en: 'Sun', fr: 'Soleil', es: 'Sol', 'pt-BR': 'Sol' })
          : name(e.center, locale)
      ),
      String(e.stepDays),
      `${isoFromJd(e.startJdTdb)} → ${isoFromJd(e.startJdTdb + (e.sampleCount - 1) * e.stepDays)}`,
    ]);
  // Les segments de DÉTAIL (ligne 45.10, 2026-10-11) : quelques heures au pas de quelques
  // minutes, là où la trajectoire change trop vite pour le pas de la phase (des manœuvres
  // rapprochées près d'un petit corps ; une mise en orbite autour de Mars, ligne 45.11).
  const detailRows = Object.values(manifest.bodies)
    .filter((e) => e.detail)
    .sort((a, b) => a.startJdTdb - b.startJdTdb)
    .map((e) => [
      escapeHtml(name(e.segmentOf!, locale)),
      escapeHtml(name(e.center, locale)),
      String(Math.round(e.stepDays * 1440)),
      `${isoMinuteFromJd(e.startJdTdb)} → ${isoMinuteFromJd(e.startJdTdb + (e.sampleCount - 1) * e.stepDays)}`,
    ]);
  const flybyRows = Object.values(manifest.bodies)
    .filter((e) => e.flyby)
    .sort((a, b) => a.startJdTdb - b.startJdTdb)
    .map((e) => [
      escapeHtml(name(e.segmentOf!, locale)),
      escapeHtml(name(e.center, locale)),
      String(Math.round(e.stepDays * 1440)),
      `${isoMinuteFromJd(e.startJdTdb)} → ${isoMinuteFromJd(e.startJdTdb + (e.sampleCount - 1) * e.stepDays)}`,
    ]);
  sections.push(
    docSection(
      'ephemerides',
      L({
        en: 'Ephemerides',
        fr: 'Éphémérides',
        es: 'Efemérides',
        'pt-BR': 'Efemérides',
      }),
      `<p>${L({
        en: `Precomputed position files come from ${escapeHtml(manifest.source)} (state vectors, frame ${escapeHtml(manifest.frame)}), generated on ${escapeHtml(manifest.generatedAt.slice(0, 10))}. The Horizons target identifier is given so that anyone can request the same data. Where a file carries another Horizons solution over an interval (one consistent with a satellite or a spacecraft that the app places relative to that body), the replacing identifier and its interval follow. Planets, the Moon and the Galilean moons otherwise come from ${link('https://github.com/cosinekitty/astronomy', 'astronomy-engine')}; the optional small-body layer reads a snapshot of ${escapeHtml(String(smallBodies.count))} orbits taken from the ${link('https://ssd-api.jpl.nasa.gov/doc/sbdb_query.html', 'JPL Small-Body Database')} on ${escapeHtml(smallBodies.retrieved)} and shipped with the build: queried from a browser, that service replies without the cross-origin header a browser needs in order to accept the reply, so nothing ever reached the page.`,
        fr: `Les fichiers de positions précalculées viennent de ${escapeHtml(manifest.source)} (vecteurs d’état, repère ${escapeHtml(manifest.frame)}), générés le ${escapeHtml(manifest.generatedAt.slice(0, 10))}. L’identifiant de cible Horizons est donné pour que chacun puisse demander les mêmes données. Quand un fichier porte une autre solution d’Horizons sur un intervalle (une solution cohérente avec un satellite ou une sonde que l’application place par rapport à ce corps), l’identifiant qui la remplace et son intervalle suivent. Planètes, Lune et lunes galiléennes viennent sinon d’${link('https://github.com/cosinekitty/astronomy', 'astronomy-engine')} ; la couche optionnelle des petits corps lit un instantané de ${escapeHtml(String(smallBodies.count))} orbites relevé le ${escapeHtml(smallBodies.retrieved)} dans la ${link('https://ssd-api.jpl.nasa.gov/doc/sbdb_query.html', 'JPL Small-Body Database')} et livré avec le build : interrogé depuis un navigateur, ce service répond sans l’en-tête d’origine croisée qu’il faut à celui-ci pour accepter la réponse, et rien n’arrivait donc jamais jusqu’à la page.`,
        es: `Los archivos de posición precalculados vienen de ${escapeHtml(manifest.source)} (vectores de estado, marco ${escapeHtml(manifest.frame)}), generados el ${escapeHtml(manifest.generatedAt.slice(0, 10))}. Se indica el identificador de destino Horizons para que cualquiera pueda pedir los mismos datos. Cuando un archivo lleva otra solución de Horizons durante un intervalo (una solución coherente con un satélite o una sonda que la aplicación sitúa respecto de ese cuerpo), siguen el identificador que la sustituye y su intervalo. Los planetas, la Luna y las lunas galileanas vienen por lo demás de ${link('https://github.com/cosinekitty/astronomy', 'astronomy-engine')}; la capa opcional de cuerpos menores lee una muestra de ${escapeHtml(String(smallBodies.count))} órbitas tomada de la ${link('https://ssd-api.jpl.nasa.gov/doc/sbdb_query.html', 'JPL Small-Body Database')} el ${escapeHtml(smallBodies.retrieved)} y entregada con la compilación: consultado desde un navegador, ese servicio responde sin el encabezado de origen cruzado que un navegador necesita para aceptar la respuesta, así que nada llegaba nunca a la página.`,
        'pt-BR': `Os arquivos de posição pré-calculados vêm de ${escapeHtml(manifest.source)} (vetores de estado, referencial ${escapeHtml(manifest.frame)}), gerados em ${escapeHtml(manifest.generatedAt.slice(0, 10))}. O identificador de alvo Horizons é indicado para que qualquer pessoa possa pedir os mesmos dados. Quando um arquivo traz outra solução do Horizons durante um intervalo (uma solução coerente com um satélite ou uma sonda que o aplicativo posiciona em relação a esse corpo), seguem o identificador que a substitui e o seu intervalo. Os planetas, a Lua e as luas galileanas vêm, de resto, de ${link('https://github.com/cosinekitty/astronomy', 'astronomy-engine')}; a camada opcional de corpos menores lê uma amostra de ${escapeHtml(String(smallBodies.count))} órbitas tirada da ${link('https://ssd-api.jpl.nasa.gov/doc/sbdb_query.html', 'JPL Small-Body Database')} em ${escapeHtml(smallBodies.retrieved)} e entregue com a compilação: consultado de um navegador, esse serviço responde sem o cabeçalho de origem cruzada que um navegador precisa para aceitar a resposta, então nada nunca chegava à página.`,
      })}</p>` +
        docTable(
          L({
            en: 'JPL Horizons files',
            fr: 'Fichiers JPL Horizons',
            es: 'Archivos JPL Horizons',
            'pt-BR': 'Arquivos JPL Horizons',
          }),
          [
            L({ en: 'Body', fr: 'Corps', es: 'Cuerpo', 'pt-BR': 'Corpo' }),
            L({
              en: 'Horizons target',
              fr: 'Cible Horizons',
              es: 'Destino Horizons',
              'pt-BR': 'Alvo Horizons',
            }),
            L({ en: 'Centre', fr: 'Centre', es: 'Centro', 'pt-BR': 'Centro' }),
            L({
              en: 'Step (days)',
              fr: 'Pas (jours)',
              es: 'Paso (días)',
              'pt-BR': 'Passo (dias)',
            }),
            L({
              en: 'Coverage (TDB)',
              fr: 'Couverture (TDB)',
              es: 'Cobertura (TDB)',
              'pt-BR': 'Cobertura (TDB)',
            }),
          ],
          ephemerisRows,
          3
        ) +
        (flybyRows.length > 0
          ? `<p>${L({
              en: `During a planetary flyby, or a departure from the Earth, a short file relative to the centre of the planet takes over from the spacecraft’s file for a few days (${flybyRows.length} files). Each passage is detected in the true trajectory, and each step is the coarsest that keeps the position within ${formatQuantity(FLYBY_PLAN.segmentShare * 100, locale)} % of the distance to the planet, measured against Horizons.`,
              fr: `Pendant un survol de planète, ou un départ de la Terre, un fichier court relatif au centre de la planète prend le relais du fichier de la sonde pour quelques jours (${flybyRows.length} fichiers). Chaque passage est détecté dans la trajectoire vraie, et chaque pas est le plus grossier qui garde la position à moins de ${formatQuantity(FLYBY_PLAN.segmentShare * 100, locale)} % de la distance à la planète, mesuré contre Horizons.`,
              es: `Durante un sobrevuelo de un planeta, o una salida desde la Tierra, un archivo corto relativo al centro del planeta toma el relevo del archivo de la sonda durante unos días (${flybyRows.length} archivos). Cada paso se detecta en la trayectoria real, y cada paso es el más grueso que mantiene la posición a menos del ${formatQuantity(FLYBY_PLAN.segmentShare * 100, locale)} % de la distancia al planeta, medido contra Horizons.`,
              'pt-BR': `Durante um sobrevoo de planeta, ou uma partida da Terra, um arquivo curto relativo ao centro do planeta assume no lugar do arquivo da sonda por alguns dias (${flybyRows.length} arquivos). Cada passagem é detectada na trajetória real, e cada passo é o mais grosso que mantém a posição a menos de ${formatQuantity(FLYBY_PLAN.segmentShare * 100, locale)} % da distância ao planeta, medido contra o Horizons.`,
            })}</p>` +
            docTable(
              L({
                en: 'Flyby and departure segments',
                fr: 'Segments de survol et de départ',
                es: 'Segmentos de sobrevuelo y de salida',
                'pt-BR': 'Segmentos de sobrevoo e de partida',
              }),
              [
                L({
                  en: 'Spacecraft',
                  fr: 'Sonde',
                  es: 'Sonda',
                  'pt-BR': 'Sonda',
                }),
                L({
                  en: 'Planet',
                  fr: 'Planète',
                  es: 'Planeta',
                  'pt-BR': 'Planeta',
                }),
                L({
                  en: 'Step (minutes)',
                  fr: 'Pas (minutes)',
                  es: 'Paso (minutos)',
                  'pt-BR': 'Passo (minutos)',
                }),
                L({
                  en: 'Coverage (TDB)',
                  fr: 'Couverture (TDB)',
                  es: 'Cobertura (TDB)',
                  'pt-BR': 'Cobertura (TDB)',
                }),
              ],
              flybyRows,
              2
            )
          : '') +
        (detailRows.length > 0
          ? `<p>${L({
              en: `Where the trajectory changes within hours (manoeuvres near a small body, an orbit insertion around a planet), a short file relative to the body as it is drawn takes over from the phase around it for those hours (${detailRows.length} files), every few minutes, under the same bound.`,
              fr: `Là où la trajectoire change en quelques heures (des manœuvres près d’un petit corps, une mise en orbite autour d’une planète), un fichier court relatif au corps tel qu’il est dessiné prend le relais de la phase qui l’entoure pour ces heures-là (${detailRows.length} fichiers), toutes les quelques minutes, sous la même borne.`,
              es: `Donde la trayectoria cambia en pocas horas (maniobras cerca de un cuerpo pequeño, una inserción en órbita alrededor de un planeta), un archivo corto relativo al cuerpo tal como se dibuja toma el relevo de la fase que lo rodea durante esas horas (${detailRows.length} archivos), cada pocos minutos, bajo el mismo límite.`,
              'pt-BR': `Onde a trajetória muda em poucas horas (manobras perto de um corpo pequeno, uma inserção em órbita ao redor de um planeta), um arquivo curto relativo ao corpo tal como é desenhado assume no lugar da fase que o envolve durante essas horas (${detailRows.length} arquivos), a cada poucos minutos, sob o mesmo limite.`,
            })}</p>` +
            docTable(
              L({
                en: 'Detail segments',
                fr: 'Segments de détail',
                es: 'Segmentos de detalle',
                'pt-BR': 'Segmentos de detalhe',
              }),
              [
                L({
                  en: 'Spacecraft',
                  fr: 'Sonde',
                  es: 'Sonda',
                  'pt-BR': 'Sonda',
                }),
                L({
                  en: 'Body',
                  fr: 'Corps',
                  es: 'Cuerpo',
                  'pt-BR': 'Corpo',
                }),
                L({
                  en: 'Step (minutes)',
                  fr: 'Pas (minutes)',
                  es: 'Paso (minutos)',
                  'pt-BR': 'Passo (minutos)',
                }),
                L({
                  en: 'Coverage (TDB)',
                  fr: 'Couverture (TDB)',
                  es: 'Cobertura (TDB)',
                  'pt-BR': 'Cobertura (TDB)',
                }),
              ],
              detailRows,
              2
            )
          : '')
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
            es: 'Baricentro del Sistema Solar',
            'pt-BR': 'Baricentro do Sistema Solar',
          })
        : L({ en: 'Sun', fr: 'Soleil', es: 'Sol', 'pt-BR': 'Sol' }),
    ]),
    ...INTERSTELLAR_OBJECTS.map((object) => [
      `${escapeHtml(name(object.name, locale))} (${escapeHtml(object.designation)})`,
      escapeHtml(object.elements.epoch.toISOString().slice(0, 10)),
      L({
        en: 'Sun (hyperbolic orbit)',
        fr: 'Soleil (orbite hyperbolique)',
        es: 'Sol (órbita hiperbólica)',
        'pt-BR': 'Sol (órbita hiperbólica)',
      }),
    ]),
  ];
  sections.push(
    docSection(
      'elements',
      L({
        en: 'Orbital elements',
        fr: 'Éléments orbitaux',
        es: 'Elementos orbitales',
        'pt-BR': 'Elementos orbitais',
      }),
      `<p>${L({
        en: 'Osculating elements taken from the live NASA/JPL Horizons API at the epoch shown, by the scripts in the repository; they are data values, not copied from a third-party compilation.',
        fr: 'Éléments osculateurs pris dans l’API NASA/JPL Horizons à l’époque indiquée, par les scripts du dépôt ; ce sont des valeurs de données, pas une copie d’une compilation tierce.',
        es: 'Elementos osculadores tomados de la API NASA/JPL Horizons en directo en la época indicada, por los scripts del repositorio; son valores de datos, no copiados de una compilación de terceros.',
        'pt-BR':
          'Elementos osculadores tirados da API NASA/JPL Horizons ao vivo na época indicada, pelos scripts do repositório; são valores de dados, não copiados de uma compilação de terceiros.',
      })}</p>` +
        docTable(
          L({
            en: 'Keplerian element sets',
            fr: 'Jeux d’éléments képlériens',
            es: 'Conjuntos de elementos keplerianos',
            'pt-BR': 'Conjuntos de elementos keplerianos',
          }),
          [
            L({ en: 'Body', fr: 'Corps', es: 'Cuerpo', 'pt-BR': 'Corpo' }),
            L({ en: 'Epoch', fr: 'Époque', es: 'Época', 'pt-BR': 'Época' }),
            L({ en: 'Centre', fr: 'Centre', es: 'Centro', 'pt-BR': 'Centro' }),
          ],
          elementRows
        )
    )
  );

  // ── Services en direct ──
  sections.push(
    docSection(
      'live-data',
      L({
        en: 'Live data services',
        fr: 'Services de données en direct',
        es: 'Servicios de datos en directo',
        'pt-BR': 'Serviços de dados ao vivo',
      }),
      `<p>${L({
        en: 'Your browser contacts these services while the app runs, for the layers that use them. The list is checked at build time against the hosts that the site’s security policy allows.',
        fr: 'Votre navigateur contacte ces services pendant l’utilisation de l’application, pour les couches qui s’en servent. La liste est vérifiée au build contre les hôtes qu’autorise la politique de sécurité du site.',
        es: 'Su navegador contacta estos servicios mientras la aplicación funciona, para las capas que los usan. La lista se verifica en la compilación contra los hosts que la política de seguridad del sitio autoriza.',
        'pt-BR':
          'O seu navegador contata estes serviços enquanto o aplicativo funciona, para as camadas que os usam. A lista é verificada na compilação contra os hosts que a política de segurança do site autoriza.',
      })}</p>` +
        docTable(
          L({
            en: 'Services contacted at runtime',
            fr: 'Services contactés à l’exécution',
            es: 'Servicios contactados en ejecución',
            'pt-BR': 'Serviços contatados em execução',
          }),
          [
            L({
              en: 'Service',
              fr: 'Service',
              es: 'Servicio',
              'pt-BR': 'Serviço',
            }),
            L({
              en: 'Used for',
              fr: 'Usage',
              es: 'Utilizado para',
              'pt-BR': 'Utilizado para',
            }),
            L({
              en: 'Terms and credit',
              fr: 'Conditions et crédit',
              es: 'Condiciones y crédito',
              'pt-BR': 'Termos e crédito',
            }),
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
      L({
        en: 'Software',
        fr: 'Logiciels',
        es: 'Software',
        'pt-BR': 'Software',
      }),
      docTable(
        L({
          en: 'Libraries bundled with the app',
          fr: 'Bibliothèques embarquées dans l’application',
          es: 'Bibliotecas incluidas en la aplicación',
          'pt-BR': 'Bibliotecas incluídas no aplicativo',
        }),
        [
          L({
            en: 'Library',
            fr: 'Bibliothèque',
            es: 'Biblioteca',
            'pt-BR': 'Biblioteca',
          }),
          L({ en: 'Version', fr: 'Version', es: 'Versión', 'pt-BR': 'Versão' }),
          L({
            en: 'Licence',
            fr: 'Licence',
            es: 'Licencia',
            'pt-BR': 'Licença',
          }),
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
        es: 'Avisos de terceros (texto completo)',
        'pt-BR': 'Avisos de terceiros (texto completo)',
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

  // Dernière section : comment citer ce travail, rendue par le même module que /methodology.
  sections.push(citationSection(input.citation, locale));

  return {
    slug: 'sources',
    locale,
    canonical: `${origin}${docPath('sources', locale)}`,
    title: L({
      en: 'Sources and credits: data, images and licences',
      fr: 'Sources et crédits : données, images et licences',
      es: 'Fuentes y créditos: datos, imágenes y licencias',
      'pt-BR': 'Fontes e créditos: dados, imagens e licenças',
    }),
    description: L({
      en: 'Where every texture, shape model, ephemeris and orbital element in Galaxy comes from, with its licence and credit, read from the project’s own provenance files.',
      fr: 'D’où vient chaque texture, modèle de forme, éphéméride et élément orbital de Galaxy, avec sa licence et son crédit, lus dans les fichiers de provenance du projet.',
      es: 'De dónde viene cada textura, modelo de forma, efeméride y elemento orbital de Galaxy, con su licencia y su crédito, leídos en los propios archivos de procedencia del proyecto.',
      'pt-BR':
        'De onde vem cada textura, modelo de forma, efeméride e elemento orbital da Galaxy, com a sua licença e o seu crédito, lidos nos próprios arquivos de procedência do projeto.',
    }),
    body: sections.join('\n'),
    updated: input.updated,
  };
}
