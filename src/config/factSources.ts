/**
 * Registre des SOURCES PRIMAIRES des faits affichés (fiche d'un corps, pages par corps).
 *
 * **Depuis le lot 7 (phase 1), la DONNÉE n'est plus ici** : les 18 sources vivent dans
 * `src/registry/providers/*.json`, validées par le schéma Zod de `src/registry/schema/`.
 * Ce module reste la façade que lisent `ui/bodyInfo.ts`, `seo/sourcesPage.ts`,
 * `utils/safeUrl.ts` et `factProvenance.test.ts` : `FACT_SOURCES` est maintenant DÉRIVÉ du
 * registre, dans l'ordre que celui-ci déclare, et les helpers de dérivation et de provenance
 * (`measured`, `derived`, `massFromGM`…) restent ici, car ce sont du code, pas de la donnée.
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
import { FACT_SOURCE_PROVIDERS } from '@/registry/providers';

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

/**
 * Sources primaires des faits, DÉRIVÉES du registre `src/registry/providers/`, dans l'ordre
 * qu'il déclare. Cet ordre est une donnée publiée : `seo/sourcesPage.ts` écrit le tableau des
 * sources primaires de `/sources` en parcourant cet objet.
 */
export const FACT_SOURCES = FACT_SOURCE_PROVIDERS satisfies Record<
  string,
  FactSource
>;

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
    es: 'radio ecuatorial en el nivel de presión de 1 bar',
    'pt-BR': 'raio equatorial no nível de pressão de 1 bar',
  },
  meanGravity1Bar: {
    en: 'mean gravity at the 1-bar pressure level',
    fr: 'gravité moyenne au niveau de pression de 1 bar',
    es: 'gravedad media en el nivel de presión de 1 bar',
    'pt-BR': 'gravidade média no nível de pressão de 1 bar',
  },
  equatorialGravity: {
    en: 'gravity at the equator',
    fr: 'gravité à l’équateur',
    es: 'gravedad en el ecuador',
    'pt-BR': 'gravidade no equador',
  },
  temperature1Bar: {
    en: 'mean temperature at the 1-bar pressure level',
    fr: 'température moyenne au niveau de pression de 1 bar',
    es: 'temperatura media en el nivel de presión de 1 bar',
    'pt-BR': 'temperatura média no nível de pressão de 1 bar',
  },
  effectiveTemperature: {
    en: 'effective temperature, 5772 K, converted to °C',
    fr: 'température effective, 5772 K, convertie en °C',
    es: 'temperatura efectiva, 5772 K, convertida a °C',
    'pt-BR': 'temperatura efetiva, 5772 K, convertida para °C',
  },
  solarRotationAt16Degrees: {
    en: 'adopted period at 16° latitude: the Sun rotates faster at its equator than near its poles',
    fr: 'période adoptée à 16° de latitude : le Soleil tourne plus vite à l’équateur qu’aux pôles',
    es: 'periodo adoptado a 16° de latitud: el Sol gira más rápido en el ecuador que en los polos',
    'pt-BR':
      'período adotado a 16° de latitude: o Sol gira mais rápido no equador que nos polos',
  },
  obliquityToEcliptic: {
    en: 'obliquity to the ecliptic',
    fr: 'obliquité par rapport à l’écliptique',
    es: 'oblicuidad respecto a la eclíptica',
    'pt-BR': 'obliquidade em relação à eclíptica',
  },
  synchronousRotation: {
    en: 'synchronous rotation: equal to the orbital period',
    fr: 'rotation synchrone : égale à la période orbitale',
    es: 'rotación sincrónica: igual al periodo orbital',
    'pt-BR': 'rotação sincronizada: igual ao período orbital',
  },
  massFromGM: {
    en: 'mass = GM / G, with G from CODATA 2018',
    fr: 'masse = GM / G, avec G de CODATA 2018',
    es: 'masa = GM / G, con G de CODATA 2018',
    'pt-BR': 'massa = GM / G, com G de CODATA 2018',
  },
  gravityFromGM: {
    en: 'g = GM / R², for a sphere without rotation',
    fr: 'g = GM / R², pour une sphère sans rotation',
    es: 'g = GM / R², para una esfera sin rotación',
    'pt-BR': 'g = GM / R², para uma esfera sem rotação',
  },
  radiusFromDiameter: {
    en: 'half the published diameter',
    fr: 'moitié du diamètre publié',
    es: 'la mitad del diámetro publicado',
    'pt-BR': 'metade do diâmetro publicado',
  },
  equatorialRadiusFromDiameter: {
    en: 'half the published equatorial diameter',
    fr: 'moitié du diamètre équatorial publié',
    es: 'la mitad del diámetro ecuatorial publicado',
    'pt-BR': 'metade do diâmetro equatorial publicado',
  },
  volumetricRadiusFromDiameter: {
    en: 'half the published volume-equivalent diameter',
    fr: 'moitié du diamètre équivalent en volume publié',
    es: 'la mitad del diámetro equivalente en volumen publicado',
    'pt-BR': 'metade do diâmetro equivalente em volume publicado',
  },
  itokawaPublishedMass: {
    en: 'published mass quoted in the database notes; the database GM of 2.1e-9 km³/s² does not match it',
    fr: 'masse publiée citée dans les notes de la base ; le GM de 2,1e-9 km³/s² de la base ne lui correspond pas',
    es: 'masa publicada citada en las notas de la base; el GM de 2,1e-9 km³/s² de la base no le corresponde',
    'pt-BR':
      'massa publicada citada nas notas da base; o GM de 2,1e-9 km³/s² da base não corresponde a ela',
  },
  gravityFromSystemMass: {
    en: 'g = G·M / R² with the system mass, for a sphere without rotation',
    fr: 'g = G·M / R² avec la masse du système, pour une sphère sans rotation',
    es: 'g = G·M / R² con la masa del sistema, para una esfera sin rotación',
    'pt-BR': 'g = G·M / R² com a massa do sistema, para uma esfera sem rotação',
  },
  massFromDensity: {
    en: 'mass = published density × volume of the published radius',
    fr: 'masse = densité publiée × volume du rayon publié',
    es: 'masa = densidad publicada × volumen del radio publicado',
    'pt-BR': 'massa = densidade publicada × volume do raio publicado',
  },
  gravityFromMass: {
    en: 'g = G·M / R², for a sphere without rotation',
    fr: 'g = G·M / R², pour une sphère sans rotation',
    es: 'g = G·M / R², para una esfera sin rotación',
    'pt-BR': 'g = G·M / R², para uma esfera sem rotação',
  },
  systemMass: {
    en: 'mass of the whole system, satellite included',
    fr: 'masse du système entier, satellite compris',
    es: 'masa del sistema entero, satélite incluido',
    'pt-BR': 'massa do sistema inteiro, satélite incluído',
  },
  obliquityFromPole: {
    en: 'angle between the published spin pole and the orbit normal',
    fr: 'angle entre le pôle de rotation publié et la normale à l’orbite',
    es: 'ángulo entre el polo de rotación publicado y la normal a la órbita',
    'pt-BR': 'ângulo entre o polo de rotação publicado e a normal à órbita',
  },
  osculatingSemiMajorAxis: {
    en: 'osculating semi-major axis at the epoch of the elements',
    fr: 'demi-grand axe osculateur à l’époque des éléments',
    es: 'semieje mayor osculador en la época de los elementos',
    'pt-BR': 'semieixo maior osculador na época dos elementos',
  },
  keplerPeriod: {
    en: 'Kepler’s third law applied to the osculating semi-major axis',
    fr: 'troisième loi de Kepler appliquée au demi-grand axe osculateur',
    es: 'tercera ley de Kepler aplicada al semieje mayor osculador',
    'pt-BR': 'terceira lei de Kepler aplicada ao semieixo maior osculador',
  },
  partialLightcurve: {
    en: 'lightcurve period that the source flags as based on less than full coverage',
    fr: 'période de courbe de lumière que la source signale comme fondée sur une couverture incomplète',
    es: 'periodo de curva de luz que la fuente señala como basado en una cobertura incompleta',
    'pt-BR':
      'período de curva de luz que a fonte indica como baseado em uma cobertura incompleta',
  },
  confirmedSatellites: {
    en: 'number of confirmed satellites listed by the database',
    fr: 'nombre de satellites confirmés listés par la base',
    es: 'número de satélites confirmados listados por la base',
    'pt-BR': 'número de satélites confirmados listados pela base',
  },
  /**
   * Le champ « Mass » du bloc « Facts in Brief » du NSSDCA Master Catalog n'a pas le même sens
   * d'une mission à l'autre : masse sèche pour New Horizons (385 kg, quand sa propre page écrit
   * « The 465 kg launch mass includes 80 kg of propellant »), masse au lancement pour OSIRIS-REx
   * (1528 kg contre « Launch mass including propellant is 1529 kg »). La précision affichée ne
   * prétend donc PAS trancher : elle nomme le champ lu, et l'identifiant COSPAR cité permet de
   * retrouver la fiche. BepiColombo, dont ce champ décrit le seul module de propulsion, ne
   * publie pas de masse du tout.
   */
  nssdcaFactsInBrief: {
    en: 'mass as listed in the catalogue’s “Facts in Brief” for this spacecraft',
    fr: 'masse telle que listée dans les « Facts in Brief » du catalogue pour cette sonde',
    es: 'masa tal como figura en los «Facts in Brief» del catálogo para esta sonda',
    'pt-BR':
      'massa tal como consta nos “Facts in Brief” do catálogo para esta sonda',
  },
  firstObservationUsed: {
    en: 'first observation used by the published orbit solution',
    fr: 'première observation retenue par la solution d’orbite publiée',
    es: 'primera observación utilizada por la solución de órbita publicada',
    'pt-BR': 'primeira observação usada pela solução de órbita publicada',
  },
  osculatingEccentricity: {
    en: 'osculating eccentricity of the published orbit solution; above 1, the orbit is open and the object leaves the Solar System',
    fr: 'excentricité osculatrice de la solution d’orbite publiée ; au-dessus de 1 l’orbite est ouverte et l’objet quitte le Système solaire',
    es: 'excentricidad osculadora de la solución de órbita publicada; por encima de 1 la órbita es abierta y el objeto abandona el Sistema Solar',
    'pt-BR':
      'excentricidade osculadora da solução de órbita publicada; acima de 1 a órbita é aberta e o objeto deixa o Sistema Solar',
  },
  /**
   * La SBDB publie H pour ʻOumuamua, classé « Hyperbolic Asteroid », et M1 pour les deux
   * comètes : M1 est la magnitude TOTALE de la loi de brillance cométaire, chevelure comprise,
   * donc une autre grandeur, qui ne s'affiche pas sous le même libellé.
   */
  absoluteMagnitudeH: {
    en: 'absolute magnitude H: the brightness the object would have 1 AU from both the Sun and the observer, at zero phase angle',
    fr: 'magnitude absolue H : l’éclat qu’aurait l’objet à 1 UA du Soleil et de l’observateur, sous un angle de phase nul',
    es: 'magnitud absoluta H: el brillo que tendría el objeto a 1 UA del Sol y del observador, con un ángulo de fase nulo',
    'pt-BR':
      'magnitude absoluta H: o brilho que o objeto teria a 1 UA do Sol e do observador, com ângulo de fase nulo',
  },
  perihelionFromElements: {
    en: 'q = a (1 − e), from the published osculating elements',
    fr: 'q = a (1 − e), d’après les éléments osculateurs publiés',
    es: 'q = a (1 − e), según los elementos osculadores publicados',
    'pt-BR': 'q = a (1 − e), conforme os elementos osculadores publicados',
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
  es: 'Galaxy aún no ha vinculado este valor a una fuente primaria (agencia espacial, UAI, artículo publicado): por eso no se muestra.',
  'pt-BR':
    'A Galaxy ainda não vinculou este valor a uma fonte primária (agência espacial, UAI, artigo publicado): por isso ele não é exibido.',
};
