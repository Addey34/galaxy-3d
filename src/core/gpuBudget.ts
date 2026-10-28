/**
 * LE PLAFOND DE MÉMOIRE GPU PAR SCÈNE (lot 56), contre le registre des allocations du PILOTE
 * (`core/gpuLedger.ts`, lu par la sonde `?debug-perf`), et non contre l'estimation des matériaux,
 * qui ne voyait pas la cubemap du ciel (~512 Mio jusqu'au 2026-10-18).
 *
 * Les valeurs sont MESURÉES dans la condition même de la garde : rendu logiciel (SwiftShader,
 * celui de la CI), réseau externe BLOQUÉ, scène datée, après le calme, trois tirages. Le réseau
 * compte : bloqué, les nuages du jour ne répondent pas et la Terre retombe sur sa carte de nuages
 * 8k (171 Mio), absente d'une mesure en ligne (`scripts/measure-perf.mjs`, 861 Mio ce jour-là).
 * Le plafond laisse environ 12 % au-dessus de la mesure ; la cubemap réintroduite ajoutait 897 Mio
 * (cubemap 512, tampons de rendu de la conversion 384) à la Terre en Explo, mesuré le 2026-10-18.
 * Une scène qui gagne une texture LÉGITIMEMENT relève son plafond ici, avec la nouvelle mesure.
 *
 * Garde : `e2e/gpuMemory.spec.ts`, qui exige aussi qu'aucune cubemap ne soit allouée.
 */

/** La date des scènes : la caméra aborde un corps côté Soleil (piège du 2026-10-01). */
const GPU_SCENE_DATE = '2024-07-01T12:00:00Z';

export interface GpuSceneCeiling {
  id: string;
  /** Requête de démarrage, `?debug-perf` et date compris. */
  query: string;
  /** Total du pilote mesuré (plus grand des trois tirages), en Mio. */
  measuredMiB: number;
  measuredOn: string;
  /** Plafond tenu par la garde, en Mio. */
  ceilingMiB: number;
}

export const GPU_SCENE_CEILINGS: readonly GpuSceneCeiling[] = [
  {
    id: 'overview',
    query: `?debug-perf&date=${GPU_SCENE_DATE}`,
    measuredMiB: 382,
    measuredOn: '2026-10-18',
    ceilingMiB: 430,
  },
  {
    id: 'earth-explo',
    query: `?debug-perf&mode=explo&body=earth&date=${GPU_SCENE_DATE}`,
    measuredMiB: 1001,
    measuredOn: '2026-10-18',
    ceilingMiB: 1120,
  },
];

/**
 * LE COÛT DE RENDU PAR SCÈNE, INDÉPENDANT DU PROCESSEUR (2026-10-28) : appels de dessin, triangles
 * et programmes de shaders d'une image au régime, lus sur `renderer.info` par la sonde
 * `?debug-perf`. Un temps d'image varie du simple au double d'un runner GitHub à l'autre (224 à
 * 430 ms pour la même Terre) ; ces trois nombres, eux, ne dépendent que de ce que la scène DESSINE
 * et sont identiques d'un tirage à l'autre (mesuré : trois tirages par scène, un seul programme
 * d'écart, sur la Terre). Une régression qui ajoute des maillages, des couches ou des matériaux
 * s'y lit sans bruit, là où le temps d'image la noie.
 *
 * Mesuré dans la condition de la garde de mémoire ci-dessus (rendu logiciel, réseau externe
 * bloqué, scène datée, après le calme). Le plafond laisse environ 15 % au-dessus de la mesure
 * (25 % pour les programmes, que le chargement paresseux d'une couche fait varier d'un). Une scène
 * qui dessine LÉGITIMEMENT davantage relève son plafond ici, avec sa nouvelle mesure.
 *
 * Garde : `e2e/renderCost.spec.ts`.
 */
export interface RenderCostCeiling {
  id: string;
  query: string;
  measured: { drawCalls: number; triangles: number; programs: number };
  measuredOn: string;
  ceiling: { drawCalls: number; triangles: number; programs: number };
}

export const RENDER_COST_CEILINGS: readonly RenderCostCeiling[] = [
  {
    id: 'overview',
    query: `?debug-perf&date=${GPU_SCENE_DATE}`,
    measured: { drawCalls: 177, triangles: 973_905, programs: 28 },
    measuredOn: '2026-10-28',
    ceiling: { drawCalls: 205, triangles: 1_120_000, programs: 35 },
  },
  {
    id: 'jupiter-educ',
    query: `?debug-perf&body=jupiter&date=${GPU_SCENE_DATE}`,
    measured: { drawCalls: 57, triangles: 225_681, programs: 12 },
    measuredOn: '2026-10-28',
    ceiling: { drawCalls: 66, triangles: 260_000, programs: 15 },
  },
  {
    id: 'saturn-explo',
    query: `?debug-perf&mode=explo&body=saturn&date=${GPU_SCENE_DATE}`,
    measured: { drawCalls: 37, triangles: 56_913, programs: 14 },
    measuredOn: '2026-10-28',
    ceiling: { drawCalls: 43, triangles: 65_000, programs: 17 },
  },
  {
    id: 'earth-explo',
    query: `?debug-perf&mode=explo&body=earth&date=${GPU_SCENE_DATE}`,
    measured: { drawCalls: 44, triangles: 349_533, programs: 20 },
    measuredOn: '2026-10-28',
    ceiling: { drawCalls: 51, triangles: 400_000, programs: 25 },
  },
];
