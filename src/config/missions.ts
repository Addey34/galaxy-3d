/**
 * ACCÈS AUX MISSIONS D'UN CORPS — façade unique, et RIEN au démarrage.
 *
 * Deux choses sont chargées, et aucune des deux n'est dans la clôture statique de l'entrée :
 *   - l'INDEX (`config/missionIndex.json`, écrit par `pnpm missions:generate`) dit combien de
 *     missions porte chaque corps. Il est importé DYNAMIQUEMENT, comme le résumé de validation
 *     que lit `ui/positionProvenance.ts` : personne ne le télécharge sans ouvrir une fiche ;
 *   - la LISTE d'un corps (`public/assets/missions/{corps}.json`) n'arrive qu'à l'ouverture de sa
 *     fiche, et une seule fois.
 *
 * L'ADRESSE EST ABSOLUE, et ce n'est pas un détail : le corps est porté par le CHEMIN de l'URL
 * (`/europa`), donc `assets/missions/europa.json` résoudrait en `/europa/assets/missions/…` et
 * rendrait 404. Le lot 37 l'a payé dans un vrai navigateur, la couche restant vide sans un mot.
 */
import type { MissionRecord } from '@/core/missions';
import { sortMissions } from '@/core/missions';
import Logger from '@/utils/Logger';

/** Ce que l'index publie : par corps, le nombre de missions et le poids de son fichier. */
interface MissionIndex {
  readonly provider: {
    readonly publisher: string;
    readonly title: string;
    readonly url: string;
    readonly citation: string;
  };
  readonly retrieved: string;
  readonly missions: number;
  readonly bodies: Record<string, { count: number; bytes: number }>;
}

let index: MissionIndex | null = null;
let indexPromise: Promise<MissionIndex | null> | null = null;

/**
 * L'index, chargé une seule fois. Un échec n'est pas retenu comme définitif : l'index est
 * demandé à chaque ouverture de fiche, et une panne réseau passagère ne doit pas éteindre le
 * bloc pour le reste de la visite.
 */
export function loadMissionIndex(): Promise<MissionIndex | null> {
  if (index) return Promise.resolve(index);
  indexPromise ??= import('./missionIndex.json')
    .then((module) => {
      index = module.default as unknown as MissionIndex;
      return index;
    })
    .catch((error: unknown) => {
      indexPromise = null;
      Logger.warn(`[Missions] index indisponible : ${String(error)}`);
      return null;
    });
  return indexPromise;
}

/** Combien de missions le registre du PDS déclare pour ce corps, l'index étant arrivé. */
export function missionCount(body: string): number | null {
  return index ? (index.bodies[body]?.count ?? null) : null;
}

/** La provenance à citer sous le bloc, et la date à laquelle le registre a été lu. */
export function missionProvenance(): {
  provider: MissionIndex['provider'];
  retrieved: string;
} | null {
  return index
    ? { provider: index.provider, retrieved: index.retrieved }
    : null;
}

const lists = new Map<string, readonly MissionRecord[]>();
const failed = new Set<string>();

/**
 * Les missions d'un corps. Trois réponses, et la distinction compte :
 *
 *   - une LISTE, y compris vide : le corps est au catalogue, et le registre déclare ce nombre de
 *     missions. Un corps à zéro ne déclenche AUCUNE requête — son fichier n'existe pas, et
 *     demander pour recevoir un 404 serait une requête de trop ;
 *   - `null` : soit l'index n'a pas répondu, soit **ce n'est pas un corps du catalogue**. La
 *     fiche s'ouvre aussi pour une SONDE et pour un objet interstellaire (`config/navigable.ts`),
 *     et l'index ne porte que les corps. Rendre `[]` pour Voyager 1 ferait afficher « aucune
 *     mission ne déclare ce corps », ce qui n'a aucun sens pour une sonde : une mission n'est pas
 *     la cible d'une archive, elle en est l'auteur. Le bloc reste donc masqué.
 */
export async function loadMissions(
  body: string
): Promise<readonly MissionRecord[] | null> {
  const cached = lists.get(body);
  if (cached) return cached;
  if (failed.has(body)) return null;
  const loaded = await loadMissionIndex();
  if (!loaded) return null;
  const entry = loaded.bodies[body];
  if (!entry) return null;
  if (entry.count === 0) return [];
  try {
    const res = await fetch(`/assets/missions/${body}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list = sortMissions((await res.json()) as MissionRecord[]);
    lists.set(body, list);
    return list;
  } catch (error: unknown) {
    failed.add(body);
    Logger.warn(`[Missions] ${body} indisponible : ${String(error)}`);
    return null;
  }
}
