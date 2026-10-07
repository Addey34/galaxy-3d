/**
 * LES CORPS SANS MODÈLE DE FORME, ET POURQUOI — la recherche de sources, écrite une fois.
 *
 * Module PUR : il porte le résultat d'une recherche, pas un jugement. La confrontation au
 * catalogue et à l'inventaire vit dans `src/config/shapeModelGaps.test.ts`.
 *
 * POURQUOI CE FICHIER EXISTE. La règle de parité est claire : un manque se comble ou s'écrit avec
 * sa raison. `pnpm inventory:gaps` liste les corps « sans modèle de forme et plus petits que le
 * plus grand corps qui en a un », et cette liste se lisait NUE — sans dire si personne n'avait
 * cherché, ou si la source n'existe pas. Ce sont deux choses très différentes.
 *
 * CE QUI A ÉTÉ CHERCHÉ le 2026-09-29, et où :
 *
 *   - `non_mission/EAR_A_5_DDR_STOOKE_SHAPE_MODELS_V2_0` (la source d'Amalthée et de Protée) :
 *     Ida, Mathilde, Gaspra, Halley, Amalthée, Thébé, Larissa, Protée, Janus, Épiméthée,
 *     Prométhée, Pandore ;
 *   - `non_mission/EAR_A_5_DDR_SHAPE_MODELS_V2_1` (la source de Déimos) : Vesta, Ida, Mathilde,
 *     Gaspra et d'autres astéroïdes ;
 *   - `multi_mission/` : Mimas, Phœbé, Téthys, Dioné, Phobos.
 *
 * MIMAS EN EST SORTI, et c'est le résultat de cette recherche : son modèle est livré depuis le
 * lot 32. Les sept qui restent n'ont rien dans ces trois collections.
 *
 * LE CAS DES QUATRE LUNES DE PLUTON MÉRITE SA PROPRE PHRASE, parce qu'il était plausible que
 * New Horizons les ait modelées : le jeu dérivé de la mission est
 * `urn:nasa:pds:nh_derived:plutosystem_geophysics`, et sa description dit « Mosaics, Topographic
 * Maps, and Bond Albedo Maps for **Pluto and Charon** ». Ni Hydra, ni Nix, ni Kerberos, ni Styx.
 * Le premier essai avait rendu un HTTP 403, qui est un blocage d'agent et NON une absence :
 * conclure dessus aurait été la faute que le lot 28 a apprise sur Nature.
 */

/** Pourquoi un corps n'a pas de modèle de forme. Une raison par CAUSE, jamais une phrase libre. */
export type ShapeGapReason =
  /**
   * Aucune des trois collections de formes du PDS ne le contient. C'est une absence CHERCHÉE,
   * pas une absence supposée.
   */
  | 'no-published-mesh'
  /**
   * La sonde qui aurait pu le modeler ne l'a pas fait : son jeu dérivé nomme d'autres corps.
   * Distingué de la cause précédente parce qu'il se rouvrira si la mission publie plus tard.
   */
  | 'mission-derived-set-excludes-it'
  /**
   * Un maillage EST publié, et sa source est nommée (`source`) ; son import est la vague suivante
   * des cibles de missions (2026-10-04). Un manque écrit, pas une absence : il se referme en
   * livrant le modèle, et la garde exige alors que l'entrée sorte d'ici.
   */
  | 'published-not-imported'
  /**
   * Le jeu est NOMMÉ par l'archive elle-même (`source`), mais son hôte refuse de le servir :
   * HTTP 403 sur tout `pdssbn.astro.umd.edu/holdings/`, mesuré le 2026-10-04, alors que les pages
   * de mission du même serveur répondent 200 et citent ces jeux. Une absence d'accès, pas de
   * source : à re-mesurer avant de conclure quoi que ce soit d'autre. RE-MESURÉ le 2026-10-07 :
   * inchangé, tout `/holdings/` (jeux PDS3 et `pds4-…`) en 403 depuis cette machine ET depuis un
   * autre réseau (WebFetch), alors que l'accueil et les index du serveur répondent 200.
   */
  | 'archive-refuses-access'
  /**
   * Rien trouvé, le 2026-10-04, dans les trois registres interrogés pour les cibles de missions :
   * le registre du PDS par cible (bundles ET collections), le dossier `SHAPE` de la PSA pour
   * Rosetta, et la table `asteroid_models` de DAMIT. Une absence CHERCHÉE.
   */
  | 'not-found-in-registries'
  /**
   * Plusieurs solutions publiées qui se contredisent, sans taille étalonnée (`source`) : en
   * importer une serait présenter un CHOIX comme une mesure, et son échelle viendrait du
   * catalogue, ce qui rendrait tautologique la garde du volume. Leucus, 2026-10-04.
   */
  | 'ambiguous-solutions'
  /**
   * Le jeu est servi, mais il ne déclare AUCUNE licence (`source`), et l'avis général de son
   * éditeur exclut les usages autres qu'éducatifs ou éditoriaux sans licence particulière. On
   * n'importe pas sur une licence supposée : 67P, lu le 2026-10-04. [SUPERSEDED le 2026-10-06 pour
   * 67P : les archives de l'ESA déclarent CC BY-NC 3.0 IGO, l'utilisateur l'a acceptée, son modèle est
   * livré. La cause reste pour un prochain jeu servi sans licence.]
   */
  | 'licence-not-stated';

export interface ShapeModelGap {
  /** Nom du corps au catalogue. */
  readonly body: string;
  /** Rayon moyen publié, en km, tel que la fiche le porte. */
  readonly radiusKm: number;
  readonly reason: ShapeGapReason;
  /** Le jeu publié, pour toute raison qui nomme un jeu (tout sauf les absences cherchées). */
  readonly source?: string;
}

/**
 * LES SEPT du 2026-09-29 (après que Mimas en est sorti), puis les cibles de missions du 2026-10-04. Chiffres LUS du catalogue ; le test les recompare et
 * rougit si un corps gagne un modèle et reste ici, ou en perd un et n'y est pas.
 */
export const SHAPE_MODEL_GAPS: readonly ShapeModelGap[] = [
  { body: 'enceladus', radiusKm: 252.1, reason: 'no-published-mesh' },
  { body: 'miranda', radiusKm: 235.8, reason: 'no-published-mesh' },
  { body: 'nereid', radiusKm: 170, reason: 'no-published-mesh' },
  { body: 'hydra', radiusKm: 18.5, reason: 'mission-derived-set-excludes-it' },
  { body: 'nix', radiusKm: 18, reason: 'mission-derived-set-excludes-it' },
  { body: 'kerberos', radiusKm: 6, reason: 'mission-derived-set-excludes-it' },
  { body: 'styx', radiusKm: 5.2, reason: 'mission-derived-set-excludes-it' },
  // Les cibles de missions entrées au catalogue le 2026-10-04. Rayons LUS des fiches (diamètre
  // SBDB / 2), recomparés par le test.
  {
    body: 'leucus',
    radiusKm: 17.0775,
    reason: 'ambiguous-solutions',
    source:
      'DAMIT, modèles convexes 6692 (pôle 321°, 77°) et 6693 (152°, 51°), qualité 1, taille non étalonnée',
  },
  {
    body: 'wild-2',
    radiusKm: 2,
    reason: 'archive-refuses-access',
    source: 'sdu-c-navcam-5-wild2-shape-model-v2.1',
  },
  {
    body: 'hartley-2',
    radiusKm: 0.8,
    reason: 'archive-refuses-access',
    source: 'dif-c-hriv_mri-5-hartley2-shape-v1.0',
  },
  { body: 'annefrank', radiusKm: 2.4, reason: 'not-found-in-registries' },
  { body: 'masursky', radiusKm: 5.372, reason: 'not-found-in-registries' },
  { body: 'dinkinesh', radiusKm: 0.3595, reason: 'not-found-in-registries' },
  { body: 'eurybates', radiusKm: 31.9425, reason: 'not-found-in-registries' },
  { body: 'polymele', radiusKm: 10.5375, reason: 'not-found-in-registries' },
  { body: 'orus', radiusKm: 25.405, reason: 'not-found-in-registries' },
  // Borrelly (corrigé le 2026-10-07) : la page des types de données comète du même hôte
  // (`data_sb/comet_type.shtml`, § Shape Models) NOMME ce jeu, que la recherche du 2026-10-04
  // n'avait pas vu. Ce sont des cartes d'élévation de la face vue par DS1, pas un maillage fermé :
  // même servi, il ne donnerait pas seul une forme entière.
  {
    body: 'borrelly',
    radiusKm: 2.4,
    reason: 'archive-refuses-access',
    source:
      "ds1-c-micas-5-borrelly-dem-v1.0 (cartes d'elevation de la face vue, pas un maillage ferme)",
  },
  { body: 'giacobini-zinner', radiusKm: 1, reason: 'not-found-in-registries' },
  {
    body: 'grigg-skjellerup',
    radiusKm: 1.3,
    reason: 'not-found-in-registries',
  },
  // Rayon de TRAVAIL, non publié (cf. sa fiche) : Patrocle porte l'axe b de son ellipsoïde
  // d'occultation (le diamètre SBDB décrit la paire).
  { body: 'patroclus', radiusKm: 59, reason: 'not-found-in-registries' },
  // Menoetius (vague 2, 2026-10-04) : rien au registre, seulement les axes d'un ellipsoïde
  // ajusté sur des occultations (Buie et al. 2015), ce qui n'est pas un maillage. Didymos et
  // Dimorphos sont sortis d'ici à la vague 4, lus en DSK chez NAIF.
  { body: 'menoetius', radiusKm: 54, reason: 'not-found-in-registries' },
];

/** Les collections interrogées, pour que la prochaine recherche parte d'où celle-ci s'arrête. */
export const SHAPE_COLLECTIONS_SEARCHED: readonly string[] = [
  'non_mission/EAR_A_5_DDR_STOOKE_SHAPE_MODELS_V2_0',
  'non_mission/EAR_A_5_DDR_SHAPE_MODELS_V2_1',
  'multi_mission/',
  'urn:nasa:pds:nh_derived:plutosystem_geophysics',
  // 2026-10-04, pour les cibles de missions :
  'registre du PDS, par cible (Product_Bundle et Product_Collection)',
  'ESA PSA, INTERNATIONAL-ROSETTA-MISSION/SHAPE/ et les jeux de Steins et Lutetia',
  'DAMIT, table asteroid_models (témoin : Pallas 4395, Psyché 1806)',
  'pdssbn.astro.umd.edu, pages de mission Deep Impact, Stardust, DS1, EPOXI',
  // 2026-10-04, vague 4 : la même forme servie AILLEURS que l'hôte qui refuse.
  'NAIF, archive SPICE PDS4 de DART (dsk/), et serveur SPICE de l’ESA pour Hera (dsk/)',
  'NAIF, archives SPICE de New Horizons (PDS3) et de Lucy (PDS4) : Arrokoth et Donaldjohanson',
  'NAIF, archives SPICE de Deep Impact, EPOXI, Stardust et DS1 : antérieures au format DSK',
  // 2026-10-04, vague 5 : Tempel 1 et Šteins en sont sortis, lus dans l'archive de Rosetta.
  'NAIF, archive SPICE PDS3 de Rosetta (DATA/DSK/) et DSK génériques (generic_kernels/dsk/)',
  'miroir du PSI, collections non_mission de formes : aucune comète',
  // 2026-10-07 : l'index des comètes par type de données, qui nomme le jeu de Borrelly.
  'pds-smallbodies.astro.umd.edu/data_sb/comet_type.shtml (§ Shape Models)',
];

/** Ce qu'on dit d'un manque, en une ligne, pour l'inventaire. */
export function shapeGapLine(gap: ShapeModelGap): string {
  switch (gap.reason) {
    case 'no-published-mesh':
      return 'aucun maillage publie dans les trois collections du PDS';
    case 'mission-derived-set-excludes-it':
      return 'jeu derive de New Horizons : Pluton et Charon seulement';
    case 'published-not-imported':
      return `maillage publie, import a venir : ${gap.source}`;
    case 'archive-refuses-access':
      return `jeu nomme, hote en HTTP 403 : ${gap.source}`;
    case 'not-found-in-registries':
      return 'aucun maillage au registre du PDS, a la PSA ni dans DAMIT';
    case 'ambiguous-solutions':
      return `solutions publiees contradictoires, non importees : ${gap.source}`;
    case 'licence-not-stated':
      return `jeu servi sans licence declaree, non importe : ${gap.source}`;
  }
}
