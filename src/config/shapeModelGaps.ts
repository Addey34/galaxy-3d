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
  | 'mission-derived-set-excludes-it';

export interface ShapeModelGap {
  /** Nom du corps au catalogue. */
  readonly body: string;
  /** Rayon moyen publié, en km, tel que la fiche le porte. */
  readonly radiusKm: number;
  readonly reason: ShapeGapReason;
}

/**
 * LES SEPT, après que Mimas en est sorti. Chiffres LUS du catalogue ; le test les recompare et
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
];

/** Les collections interrogées, pour que la prochaine recherche parte d'où celle-ci s'arrête. */
export const SHAPE_COLLECTIONS_SEARCHED: readonly string[] = [
  'non_mission/EAR_A_5_DDR_STOOKE_SHAPE_MODELS_V2_0',
  'non_mission/EAR_A_5_DDR_SHAPE_MODELS_V2_1',
  'multi_mission/',
  'urn:nasa:pds:nh_derived:plutosystem_geophysics',
];

/** Ce qu'on dit d'un manque, en une ligne, pour l'inventaire. */
export function shapeGapLine(gap: ShapeModelGap): string {
  return gap.reason === 'no-published-mesh'
    ? 'aucun maillage publie dans les trois collections du PDS'
    : 'jeu derive de New Horizons : Pluton et Charon seulement';
}
