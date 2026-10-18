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
export const GPU_SCENE_DATE = '2024-07-01T12:00:00Z';

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
