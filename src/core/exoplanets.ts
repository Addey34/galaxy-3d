/**
 * LES SYSTÈMES D'EXOPLANÈTES : le fichier livré et sa lecture. Pur, sans DOM ni Three.js.
 *
 * `public/assets/sky/exoplanets.json` (`scripts/generate-exoplanets.mjs`) est un instantané daté de
 * la NASA Exoplanet Archive, groupé par étoile hôte. Un système devient une ligne au format du
 * catalogue d'étoiles (`StarRow`), ce qui lui donne gratuitement sa position à n'importe quelle
 * date par son mouvement propre (`starDirection`). Une distance inconnue vaut 100 000 pc, comme
 * dans le catalogue d'étoiles : la direction reste juste, c'est tout ce que le ciel demande.
 */
import type { StarRow } from './starCatalogue';

/** Une planète : nom, période (jours), rayon (R⊕), demi-grand axe (UA), année, méthode. */
export type ExoplanetRow = readonly [
  name: string,
  periodDays: number | null,
  radiusEarth: number | null,
  semiMajorAxisAu: number | null,
  discoveryYear: number | null,
  method: string | null,
];

/** Un système, dans l'ordre de `fields`. */
export type ExoplanetSystem = readonly [
  host: string,
  raDeg: number,
  decDeg: number,
  distPc: number | null,
  vmag: number | null,
  pmRaMas: number | null,
  pmDecMas: number | null,
  planets: readonly ExoplanetRow[],
];

export interface ExoplanetFile {
  source: {
    id: string;
    name: string;
    url: string;
    table: string;
    acknowledgementUrl: string;
    citation: string;
    retrieved: string;
    planets: number;
  };
  fields: string[];
  planetFields: string[];
  count: number;
  systems: ExoplanetSystem[];
}

/** Distance publiée quand la parallaxe manque : la même convention que le catalogue d'étoiles. */
export const UNKNOWN_DISTANCE_PC = 100_000;

/**
 * Le système sous la forme d'une étoile du catalogue. La magnitude est celle de l'hôte (0 si
 * inconnue : elle ne règle ici que le tri, pas le rendu), l'indice de couleur est absent.
 */
export function systemAsStar(system: ExoplanetSystem): StarRow {
  return [
    system[1],
    system[2],
    system[4] ?? 0,
    null,
    system[3] ?? UNKNOWN_DISTANCE_PC,
    system[5] ?? 0,
    system[6] ?? 0,
    0,
    system[0],
  ];
}

/** Années-lumière dans un parsec. */
export const LIGHT_YEARS_PER_PARSEC = 3.261563777;
