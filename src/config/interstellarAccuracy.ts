/**
 * CE QUE VAUT LA POSITION D'UN OBJET INTERSTELLAIRE, mesuré et écrit plutôt que tu.
 *
 * Module PUR : il porte la mesure et la règle ; la confrontation au relevé de validation livré
 * vit dans `src/config/interstellarAccuracy.test.ts`.
 *
 * POURQUOI CE FICHIER EXISTE. Le relevé annonce, pour les trois objets, un écart médian de 4,1 à
 * 8,7 MILLIONS de kilomètres, contre quelques kilomètres ou quelques rayons pour tout le reste du
 * catalogue. C'est de très loin le pire chiffre du projet, et la règle de parité de l'utilisateur
 * est sans ambiguïté : un manque se comble ou s'écrit avec sa raison, jamais les deux à la fois.
 *
 * CE QUE LA MESURE A ÉTABLI, ET QUI CHANGE LA LECTURE DE CE CHIFFRE. L'écart a été mesuré contre
 * JPL Horizons à treize instants par objet, du périhélie à ±20 ans (2026-09-29, positions
 * héliocentriques, écliptique ICRF, géométriques). Il n'est PAS uniforme : il est le plus petit
 * au périhélie et croît avec la distance, parce que ce sont des trajectoires HYPERBOLIQUES dont
 * les éléments osculateurs sont ajustés près de leur passage :
 *
 *   - Borisov est à **3 081 km** de sa position réelle au périhélie, et sous 3 700 km sur ±180
 *     jours, c'est-à-dire pendant toute la période où on l'observe ;
 *   - ʻOumuamua est à 122 919 km au périhélie, soit 0,3 % de sa distance au Soleil ce jour-là ;
 *   - la médiane de 4 à 8 millions de km du relevé décrit donc surtout les BORDS de la fenêtre,
 *     où l'objet est à 100 à 245 UA et où il n'y a rien à voir.
 *
 * ET UNE ASYMÉTRIE QUI SE COMPREND : 3I/ATLAS dérive trois fois plus APRÈS son périhélie
 * (37 millions de km à +20 ans) qu'avant (12 millions à −20 ans). Son orbite a été déterminée sur
 * un arc court et récent, l'objet ayant été découvert en 2025 : l'extrapolation vers l'avant est
 * donc la moins contrainte. Rafraîchir les éléments n'y changerait rien, leurs époques étant déjà
 * ancrées près de chaque périhélie (1I 2017-11-23, 2I 2020-01-05, 3I 2026-02-19) ; ce qui croît
 * est l'effet des perturbations planétaires, pas la vétusté d'un ajustement.
 *
 * [SUPERSEDED le 2026-10-08 : les trois objets ont désormais leur fichier Horizons (1I au pas d'un
 * jour, 2I et 3I à 4 jours), servis par une règle unique, `interstellarSceneAU`, au marqueur, à
 * l'ancre de la caméra et à la ligne. Mesuré : médiane de 0,02 à 0,03 km sur toute la fenêtre,
 * 30 km au pire, contre 4 à 8,7 millions pour les éléments, et la validation a montré ce que le
 * paragraphe ci-dessous n'avait pas vu : loin du périhélie le marqueur et sa ligne se seraient
 * séparés de plusieurs unités de scène dès qu'on mélangeait les deux sources. Les mesures de ce
 * module décrivent maintenant les ÉLÉMENTS, qui ne servent plus qu'en repli. Coût : +72 octets
 * par jour simulé, cf. `docs/ARCHITECTURE.md`. Le paragraphe est gardé pour son raisonnement.]
 *
 * POURQUOI CE N'EST PAS COMBLÉ. Un binaire Horizons sur la fenêtre coûterait environ 700 Ko par
 * objet au pas d'un jour, ce qui est abordable ; mais ces objets ne passent PAS par le résolveur
 * de positions : `ui/interstellarOverlay.ts` appelle `keplerianPositionEcliptic` directement.
 * Les servir depuis un binaire demanderait de recâbler ce chemin, pour un gain qui reste
 * SOUS-PIXEL — ils sont dessinés comme des marqueurs d'instrument 2D, jamais comme des maillages,
 * et 123 000 km à 0,26 UA valent 0,3 % d'une distance qui ne se voit déjà pas. La décision est
 * donc d'ÉCRIRE l'écart, ce que la mesure de fin de la ligne 22.7 autorise explicitement.
 */

/** Un écart MESURÉ contre Horizons, à un instant donné, pour un objet donné. */
export interface InterstellarAccuracyPoint {
  /** Jours depuis le périhélie ; négatif avant. */
  readonly daysFromPerihelion: number;
  /** Distance héliocentrique réelle à cet instant, en UA. */
  readonly heliocentricAU: number;
  /** Écart entre la position servie et celle d'Horizons, en km. */
  readonly errorKm: number;
}

export interface InterstellarAccuracy {
  /** Nom du catalogue (`config/interstellar.ts`). */
  readonly body: string;
  /** Époque des éléments livrés, ISO court. */
  readonly elementsEpoch: string;
  /** Les points mesurés, du plus ancien au plus récent. */
  readonly points: readonly InterstellarAccuracyPoint[];
}

/**
 * LE RELEVÉ, mesuré le 2026-09-29 contre JPL Horizons.
 *
 * Treize instants par objet : le périhélie, puis ±30 jours, ±180, ±1 an, ±3 ans, ±10 ans et
 * ±20 ans. Les bornes à ±20 ans sont celles de la fenêtre que `interstellarWindow` calcule et
 * que le relevé de validation utilise, si bien que les deux mesures parlent du même intervalle.
 */
export const INTERSTELLAR_ACCURACY: readonly InterstellarAccuracy[] = [
  {
    body: 'oumuamua',
    elementsEpoch: '2017-11-23',
    points: [
      {
        daysFromPerihelion: -7300,
        heliocentricAU: 116.43,
        errorKm: 18_074_654,
      },
      { daysFromPerihelion: -3650, heliocentricAU: 59.97, errorKm: 9_432_532 },
      { daysFromPerihelion: -1095, heliocentricAU: 19.69, errorKm: 2_686_619 },
      { daysFromPerihelion: -365, heliocentricAU: 7.52, errorKm: 1_139_859 },
      { daysFromPerihelion: -180, heliocentricAU: 4.16, errorKm: 654_894 },
      { daysFromPerihelion: -30, heliocentricAU: 0.97, errorKm: 219_730 },
      { daysFromPerihelion: 0, heliocentricAU: 0.26, errorKm: 122_919 },
      { daysFromPerihelion: 30, heliocentricAU: 0.98, errorKm: 18_655 },
      { daysFromPerihelion: 180, heliocentricAU: 4.16, errorKm: 30_685 },
      { daysFromPerihelion: 365, heliocentricAU: 7.53, errorKm: 132_057 },
      { daysFromPerihelion: 1095, heliocentricAU: 19.7, errorKm: 889_006 },
      { daysFromPerihelion: 3650, heliocentricAU: 59.98, errorKm: 4_410_795 },
      { daysFromPerihelion: 7300, heliocentricAU: 116.45, errorKm: 8_361_582 },
    ],
  },
  {
    body: 'borisov',
    elementsEpoch: '2020-01-05',
    points: [
      { daysFromPerihelion: -7300, heliocentricAU: 139.2, errorKm: 8_756_334 },
      { daysFromPerihelion: -3650, heliocentricAU: 70.6, errorKm: 4_167_636 },
      { daysFromPerihelion: -1095, heliocentricAU: 22.11, errorKm: 907_997 },
      { daysFromPerihelion: -365, heliocentricAU: 7.96, errorKm: 141_045 },
      { daysFromPerihelion: -180, heliocentricAU: 4.39, errorKm: 40_234 },
      { daysFromPerihelion: -30, heliocentricAU: 2.11, errorKm: 3_668 },
      { daysFromPerihelion: 0, heliocentricAU: 2.01, errorKm: 3_081 },
      { daysFromPerihelion: 30, heliocentricAU: 2.11, errorKm: 3_001 },
      { daysFromPerihelion: 180, heliocentricAU: 4.39, errorKm: 2_405 },
      { daysFromPerihelion: 365, heliocentricAU: 7.95, errorKm: 39_519 },
      { daysFromPerihelion: 1095, heliocentricAU: 22.1, errorKm: 641_818 },
      { daysFromPerihelion: 3650, heliocentricAU: 70.58, errorKm: 3_961_853 },
      { daysFromPerihelion: 7300, heliocentricAU: 139.16, errorKm: 8_172_958 },
    ],
  },
  {
    body: 'atlas',
    elementsEpoch: '2026-02-19',
    points: [
      {
        daysFromPerihelion: -7300,
        heliocentricAU: 245.65,
        errorKm: 12_255_289,
      },
      { daysFromPerihelion: -3650, heliocentricAU: 123.28, errorKm: 6_261_433 },
      { daysFromPerihelion: -1095, heliocentricAU: 37.45, errorKm: 555_660 },
      { daysFromPerihelion: -365, heliocentricAU: 12.79, errorKm: 304_188 },
      { daysFromPerihelion: -180, heliocentricAU: 6.52, errorKm: 199_353 },
      { daysFromPerihelion: -30, heliocentricAU: 1.74, errorKm: 96_871 },
      { daysFromPerihelion: 0, heliocentricAU: 1.36, errorKm: 76_607 },
      { daysFromPerihelion: 30, heliocentricAU: 1.74, errorKm: 51_755 },
      { daysFromPerihelion: 180, heliocentricAU: 6.52, errorKm: 248_544 },
      { daysFromPerihelion: 365, heliocentricAU: 12.79, errorKm: 1_336_156 },
      { daysFromPerihelion: 1095, heliocentricAU: 37.45, errorKm: 5_428_150 },
      { daysFromPerihelion: 3650, heliocentricAU: 123.31, errorKm: 18_281_971 },
      { daysFromPerihelion: 7300, heliocentricAU: 245.71, errorKm: 37_226_798 },
    ],
  },
];

/** L'écart mesuré le plus proche d'un instant donné, exprimé en jours depuis le périhélie. */
export function accuracyNear(
  body: string,
  daysFromPerihelion: number
): InterstellarAccuracyPoint | undefined {
  const record = INTERSTELLAR_ACCURACY.find((a) => a.body === body);
  if (!record) return undefined;
  return record.points.reduce((best, point) =>
    Math.abs(point.daysFromPerihelion - daysFromPerihelion) <
    Math.abs(best.daysFromPerihelion - daysFromPerihelion)
      ? point
      : best
  );
}

/**
 * L'écart, rapporté à la distance héliocentrique. C'est la grandeur qui se compare d'un objet à
 * l'autre, et elle dit pourquoi ces millions de kilomètres ne se voient pas : au périhélie de
 * Borisov, 3 081 km sur 2,01 UA valent 1,0e-5.
 */
export function relativeError(point: InterstellarAccuracyPoint): number {
  return point.errorKm / (point.heliocentricAU * 149_597_870.7);
}
