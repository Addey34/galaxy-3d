/**
 * Registre des SOURCES PRIMAIRES des faits affichés (fiche d'un corps, pages par corps).
 *
 * Chaque valeur que Galaxy présente comme un fait (rayon, masse, gravité, température moyenne,
 * distance, période, rotation, obliquité, nombre de lunes) porte dans le catalogue une
 * provenance (`realData.sources[champ]`) qui nomme une entrée de ce registre, la méthode
 * (mesurée, dérivée, illustrative) et, pour un fait qui évolue, sa date de validité.
 *
 * Règles, chacune tenue par `factProvenance.test.ts` :
 *   - une source primaire : agence (NASA, JPL, ESA, IAU/WGCCRE, USGS), base de données d'agence,
 *     article publié ou prépublication nommée comme telle. Jamais Wikipédia, qui reste le lien
 *     « En savoir plus » et ne cite rien ici ;
 *   - une valeur citée est CONFRONTÉE à la source : `factSources.snapshot.json` (écrit par
 *     `scripts/snapshot-fact-sources.mjs`) garde les tables NASA/JPL telles que lues, et le test
 *     compare chaque valeur à sa ligne ;
 *   - un fait affiché sans provenance n'est pas affiché comme un fait (`core/bodyFacts.ts`), et
 *     le test refuse le catalogue qui en contient un. Une valeur que la simulation utilise mais
 *     qu'aucune source ne porte se déclare `unknown` avec `NOT_YET_SOURCED`.
 */
import type { FactProvenance, UnknownReason } from '@/types';
import { KM_PER_AU } from '@/core/ScaleService';

export type FactSourceKind = 'agency' | 'database' | 'article' | 'preprint';

export interface FactSource {
  /** Qui publie : agence, base, ou auteurs d'un article (« Sicardy et al. »). */
  publisher: string;
  /** Titre tel que publié. */
  title: string;
  url: string;
  kind: FactSourceKind;
  /** Revue et année pour un article, `AAAA` ou `AAAA-MM-JJ`. */
  published?: string;
  journal?: string;
  doi?: string;
  /** Date à laquelle la source a été lue pour ce catalogue. */
  accessed: string;
}

/** Date de relevé des sources de ce registre (celle de `factSources.snapshot.json`). */
const ACCESSED = '2026-09-17';

export const FACT_SOURCES = {
  'nssdca-fact-sheets': {
    publisher: 'NASA NSSDCA',
    title: 'Planetary and Satellite Fact Sheets',
    url: 'https://nssdc.gsfc.nasa.gov/planetary/planetfact.html',
    kind: 'agency',
    accessed: ACCESSED,
  },
  'jpl-ssd-satellite-physical-parameters': {
    publisher: 'NASA JPL Solar System Dynamics',
    title: 'Planetary Satellite Physical Parameters',
    url: 'https://ssd.jpl.nasa.gov/sats/phys_par/',
    kind: 'database',
    accessed: ACCESSED,
  },
  'jpl-ssd-satellite-mean-elements': {
    publisher: 'NASA JPL Solar System Dynamics',
    title: 'Planetary Satellite Mean Elements',
    url: 'https://ssd.jpl.nasa.gov/sats/elem/',
    kind: 'database',
    accessed: ACCESSED,
  },
  'jpl-sbdb': {
    publisher: 'NASA JPL Solar System Dynamics',
    title: 'Small-Body Database',
    url: 'https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html',
    kind: 'database',
    accessed: ACCESSED,
  },
  'jpl-horizons': {
    publisher: 'NASA JPL Solar System Dynamics',
    title: 'Horizons System (osculating orbital elements)',
    url: 'https://ssd.jpl.nasa.gov/horizons/',
    kind: 'database',
    accessed: ACCESSED,
  },
  'nasa-science-jupiter-moons': {
    publisher: 'NASA Science',
    title: 'Jupiter Moons',
    url: 'https://science.nasa.gov/jupiter/moons/',
    kind: 'agency',
    accessed: ACCESSED,
  },
  'nasa-science-saturn-moons': {
    publisher: 'NASA Science',
    title: 'Saturn Moons',
    url: 'https://science.nasa.gov/saturn/moons/',
    kind: 'agency',
    accessed: ACCESSED,
  },
  'nasa-science-uranus-moons': {
    publisher: 'NASA Science',
    title: 'Uranus Moons',
    url: 'https://science.nasa.gov/uranus/moons/',
    kind: 'agency',
    accessed: ACCESSED,
  },
  'nasa-science-neptune-moons': {
    publisher: 'NASA Science',
    title: 'Neptune Moons',
    url: 'https://science.nasa.gov/neptune/moons/',
    kind: 'agency',
    accessed: ACCESSED,
  },
  'nasa-science-mars-moons': {
    publisher: 'NASA Science',
    title: 'Mars Moons',
    url: 'https://science.nasa.gov/mars/moons/',
    kind: 'agency',
    accessed: ACCESSED,
  },
  'sicardy-2011-eris': {
    publisher: 'Sicardy et al.',
    title:
      'A Pluto-like radius and a high albedo for the dwarf planet Eris from an occultation',
    url: 'https://www.nature.com/articles/nature10550',
    kind: 'article',
    journal: 'Nature 478, 493',
    published: '2011',
    doi: '10.1038/nature10550',
    accessed: ACCESSED,
  },
  'szakats-2023-eris': {
    publisher: 'Szakáts et al.',
    title:
      'Tidally locked rotation of the dwarf planet (136199) Eris discovered from long-term ground based and space photometry',
    url: 'https://arxiv.org/abs/2211.07987',
    kind: 'article',
    journal: 'Astronomy & Astrophysics 669, L3',
    published: '2023',
    doi: '10.1051/0004-6361/202245234',
    accessed: ACCESSED,
  },
  'ragozzine-brown-2009-haumea': {
    publisher: 'Ragozzine & Brown',
    title:
      'Orbits and Masses of the Satellites of the Dwarf Planet Haumea = 2003 EL61',
    url: 'https://arxiv.org/abs/0903.4213',
    kind: 'article',
    journal: 'The Astronomical Journal 137, 4766-4776',
    published: '2009',
    doi: '10.1088/0004-6256/137/6/4766',
    accessed: ACCESSED,
  },
  'brown-2013-makemake': {
    publisher: 'Brown',
    title: 'On the size, shape, and density of dwarf planet Makemake',
    url: 'https://arxiv.org/abs/1304.1041',
    kind: 'article',
    journal: 'The Astrophysical Journal Letters 767, L7',
    published: '2013',
    doi: '10.1088/2041-8205/767/1/L7',
    accessed: ACCESSED,
  },
  'kiss-2019-gonggong': {
    publisher: 'Kiss et al.',
    title: 'The mass and density of the dwarf planet (225088) 2007 OR10',
    url: 'https://arxiv.org/abs/1903.05439',
    kind: 'article',
    journal: 'Icarus',
    published: '2019',
    doi: '10.1016/j.icarus.2019.03.013',
    accessed: ACCESSED,
  },
  'margoti-2026-quaoar': {
    publisher: 'Margoti et al.',
    title:
      'Size, shape, density, and atmospheric limit of (50000) Quaoar revealed from 14 years of stellar occultation',
    url: 'https://arxiv.org/abs/2607.06450',
    kind: 'preprint',
    published: '2026-07-07',
    accessed: ACCESSED,
  },
  'pal-2012-sedna': {
    publisher: 'Pál et al.',
    title:
      '"TNOs are Cool": A survey of the trans-Neptunian region, VII. Size and surface characteristics of (90377) Sedna and 2010 EK139',
    url: 'https://arxiv.org/abs/1204.0899',
    kind: 'article',
    journal: 'Astronomy & Astrophysics',
    published: '2012',
    doi: '10.1051/0004-6361/201218874',
    accessed: ACCESSED,
  },
  'kiss-2016-nereid': {
    publisher: 'Kiss et al.',
    title:
      'Nereid from space: Rotation, size and shape analysis from Kepler/K2, Herschel and Spitzer observations',
    url: 'https://arxiv.org/abs/1601.02395',
    kind: 'article',
    journal: 'Monthly Notices of the Royal Astronomical Society',
    published: '2016',
    doi: '10.1093/mnras/stw081',
    accessed: ACCESSED,
  },
} as const satisfies Record<string, FactSource>;

export type FactSourceId = keyof typeof FACT_SOURCES;

/**
 * Hôtes des sources, dérivés du registre : la fiche ne crée un lien que vers l'un d'eux
 * (`utils/safeUrl.ts`), sans liste parallèle à tenir à jour.
 */
export const FACT_SOURCE_HOSTS: ReadonlySet<string> = new Set(
  Object.values(FACT_SOURCES).map((source) => new URL(source.url).hostname)
);

/** Source d'un identifiant, ou `undefined` si le registre ne la connaît pas. */
export function factSource(id: string): FactSource | undefined {
  return (FACT_SOURCES as Record<string, FactSource>)[id];
}

// ── Dérivations : écrites une fois, lisibles dans le catalogue ────────────────────────────────

/**
 * Constante gravitationnelle, CODATA 2018 (NIST, https://physics.nist.gov/cgi-bin/cuu/Value?bg).
 * Les tables d'éphémérides publient GM, connu bien mieux que G : la masse en kilogrammes est
 * une valeur DÉRIVÉE, et sa précision est celle de G (2,2e-5 relatif).
 */
export const G_SI = 6.6743e-11;

/** Masse (kg) depuis GM (km³/s²). */
export const massFromGM = (gmKm3s2: number): number => (gmKm3s2 * 1e9) / G_SI;

/** Gravité de surface (m/s²) d'une sphère de rayon `radiusKm`, sans rotation, depuis GM (km³/s²). */
export const gravityFromGM = (gmKm3s2: number, radiusKm: number): number =>
  (gmKm3s2 * 1e9) / (radiusKm * 1e3) ** 2;

/** Gravité de surface (m/s²) depuis une masse (kg). */
export const gravityFromMass = (massKg: number, radiusKm: number): number =>
  gravityFromGM((massKg * G_SI) / 1e9, radiusKm);

/** Masse (kg) d'une sphère de densité `gPerCm3` et de rayon `radiusKm`. */
export const massFromDensity = (gPerCm3: number, radiusKm: number): number =>
  gPerCm3 * 1000 * (4 / 3) * Math.PI * (radiusKm * 1e3) ** 3;

/** Distance en UA depuis des kilomètres (même UA que la scène, `ScaleService.KM_PER_AU`). */
export const kmToAu = (km: number): number => km / KM_PER_AU;

// ── Raccourcis de provenance pour le catalogue ───────────────────────────────────────────────

export const measured = (
  source: FactSourceId,
  extra: Omit<FactProvenance, 'source' | 'method'> = {}
): FactProvenance => ({ source, method: 'measured', ...extra });

export const derived = (
  source: FactSourceId,
  extra: Omit<FactProvenance, 'source' | 'method'> = {}
): FactProvenance => ({ source, method: 'derived', ...extra });

/**
 * Précisions récurrentes : ce que la source mesure exactement quand le libellé de la fiche est
 * plus large (« Rayon » d'une géante = rayon équatorial au niveau de 1 bar), ou comment une
 * valeur dérivée a été calculée.
 */
export const DETAIL = {
  equatorialRadius1Bar: {
    en: 'equatorial radius at the 1-bar pressure level',
    fr: 'rayon équatorial au niveau de pression de 1 bar',
  },
  meanGravity1Bar: {
    en: 'mean gravity at the 1-bar pressure level',
    fr: 'gravité moyenne au niveau de pression de 1 bar',
  },
  equatorialGravity: {
    en: 'gravity at the equator',
    fr: 'gravité à l’équateur',
  },
  temperature1Bar: {
    en: 'mean temperature at the 1-bar pressure level',
    fr: 'température moyenne au niveau de pression de 1 bar',
  },
  effectiveTemperature: {
    en: 'effective temperature, 5772 K, converted to °C',
    fr: 'température effective, 5772 K, convertie en °C',
  },
  solarRotationAt16Degrees: {
    en: 'adopted period at 16° latitude: the Sun rotates faster at its equator than near its poles',
    fr: 'période adoptée à 16° de latitude : le Soleil tourne plus vite à l’équateur qu’aux pôles',
  },
  obliquityToEcliptic: {
    en: 'obliquity to the ecliptic',
    fr: 'obliquité par rapport à l’écliptique',
  },
  synchronousRotation: {
    en: 'synchronous rotation: equal to the orbital period',
    fr: 'rotation synchrone : égale à la période orbitale',
  },
  massFromGM: {
    en: 'mass = GM / G, with G from CODATA 2018',
    fr: 'masse = GM / G, avec G de CODATA 2018',
  },
  gravityFromGM: {
    en: 'g = GM / R², for a sphere without rotation',
    fr: 'g = GM / R², pour une sphère sans rotation',
  },
  radiusFromDiameter: {
    en: 'half the published diameter',
    fr: 'moitié du diamètre publié',
  },
  equatorialRadiusFromDiameter: {
    en: 'half the published equatorial diameter',
    fr: 'moitié du diamètre équatorial publié',
  },
  volumetricRadiusFromDiameter: {
    en: 'half the published volume-equivalent diameter',
    fr: 'moitié du diamètre équivalent en volume publié',
  },
  itokawaPublishedMass: {
    en: 'published mass quoted in the database notes; the database GM of 2.1e-9 km³/s² does not match it',
    fr: 'masse publiée citée dans les notes de la base ; le GM de 2,1e-9 km³/s² de la base ne lui correspond pas',
  },
  gravityFromSystemMass: {
    en: 'g = G·M / R² with the system mass, for a sphere without rotation',
    fr: 'g = G·M / R² avec la masse du système, pour une sphère sans rotation',
  },
  massFromDensity: {
    en: 'mass = published density × volume of the published radius',
    fr: 'masse = densité publiée × volume du rayon publié',
  },
  gravityFromMass: {
    en: 'g = G·M / R², for a sphere without rotation',
    fr: 'g = G·M / R², pour une sphère sans rotation',
  },
  systemMass: {
    en: 'mass of the whole system, satellite included',
    fr: 'masse du système entier, satellite compris',
  },
  obliquityFromPole: {
    en: 'angle between the published spin pole and the orbit normal',
    fr: 'angle entre le pôle de rotation publié et la normale à l’orbite',
  },
  osculatingSemiMajorAxis: {
    en: 'osculating semi-major axis at the epoch of the elements',
    fr: 'demi-grand axe osculateur à l’époque des éléments',
  },
  keplerPeriod: {
    en: 'Kepler’s third law applied to the osculating semi-major axis',
    fr: 'troisième loi de Kepler appliquée au demi-grand axe osculateur',
  },
  partialLightcurve: {
    en: 'lightcurve period that the source flags as based on less than full coverage',
    fr: 'période de courbe de lumière que la source signale comme fondée sur une couverture incomplète',
  },
  confirmedSatellites: {
    en: 'number of confirmed satellites listed by the database',
    fr: 'nombre de satellites confirmés listés par la base',
  },
} as const;

/**
 * Raison affichée pour une valeur que la simulation porte mais qu'aucune source primaire ne
 * rattache encore. Formulée pour rester VRAIE quel que soit le champ : elle ne prétend pas que
 * la science ignore la valeur, seulement que Galaxy ne l'a pas encore sourcée.
 */
export const NOT_YET_SOURCED: UnknownReason = {
  unsourced: true,
  en: 'Galaxy has not yet traced this value to a primary source (space agency, IAU, peer-reviewed article), so it is not shown.',
  fr: 'Galaxy n’a pas encore rattaché cette valeur à une source primaire (agence spatiale, UAI, article publié) : elle n’est donc pas affichée.',
};
