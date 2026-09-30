/**
 * ACCÈS À L'ARCHIVE D'UNE SONDE — façade unique, et RIEN au démarrage.
 *
 * Même partition que les missions du lot 40, et pour les mêmes raisons :
 *   - l'INDEX (`config/instrumentIndex.json`, écrit par `pnpm instruments:generate`) dit combien
 *     d'instruments et d'investigations porte chaque sonde, et lesquelles sont ABSENTES du
 *     registre. Il est importé DYNAMIQUEMENT : personne ne le télécharge sans ouvrir une fiche ;
 *   - la LISTE d'une sonde (`public/assets/instruments/{sonde}.json`) n'arrive qu'à l'ouverture de
 *     sa fiche, et une seule fois.
 *
 * L'ADRESSE EST ABSOLUE, et ce n'est pas un détail : le corps est porté par le CHEMIN de l'URL
 * (`/voyager1`), donc `assets/instruments/voyager1.json` résoudrait en
 * `/voyager1/assets/instruments/…` et rendrait 404. Le lot 37 l'a payé dans un vrai navigateur, la
 * couche restant vide sans un mot, et le lot 40 a remis la même garde.
 */
import type { SpacecraftArchive } from '@/core/instruments';
import { sortInstruments } from '@/core/instruments';
import { sortMissions } from '@/core/missions';
import Logger from '@/utils/Logger';

/** Ce que l'index publie : par sonde, ses comptes et le poids de son fichier. */
interface InstrumentIndex {
  readonly provider: {
    readonly publisher: string;
    readonly title: string;
    readonly url: string;
    readonly citation: string;
  };
  readonly retrieved: string;
  readonly spacecraft: Record<
    string,
    {
      hosts: number;
      investigations: number;
      instruments: number;
      bytes: number;
    }
  >;
  /**
   * Les sondes que le registre du PDS ne déclare PAS, avec la raison mesurée dans
   * `scripts/pds-archive-targets.json`. Deux au lot 42 : Parker Solar Probe (héliophysique) et le
   * JWST (observatoire). Elles sont NOMMÉES ici plutôt qu'absentes de l'index, parce qu'une sonde
   * absente d'un index et une sonde dont on sait que l'archive n'en parle pas ne se disent pas de
   * la même façon sur une fiche.
   */
  readonly absent: Record<string, true>;
}

let index: InstrumentIndex | null = null;
let indexPromise: Promise<InstrumentIndex | null> | null = null;

/**
 * L'index, chargé une seule fois. Un échec n'est pas retenu comme définitif : l'index est demandé
 * à chaque ouverture de fiche, et une panne réseau passagère ne doit pas éteindre le bloc pour le
 * reste de la visite.
 */
export function loadInstrumentIndex(): Promise<InstrumentIndex | null> {
  if (index) return Promise.resolve(index);
  indexPromise ??= import('./instrumentIndex.json')
    .then((module) => {
      index = module.default as unknown as InstrumentIndex;
      return index;
    })
    .catch((error: unknown) => {
      indexPromise = null;
      Logger.warn(`[Instruments] index indisponible : ${String(error)}`);
      return null;
    });
  return indexPromise;
}

/** La provenance à citer sous le bloc, et la date à laquelle le registre a été lu. */
export function instrumentProvenance(): {
  provider: InstrumentIndex['provider'];
  retrieved: string;
} | null {
  return index
    ? { provider: index.provider, retrieved: index.retrieved }
    : null;
}

/** Le registre du PDS ne déclare rien sur cette sonde, et c'est MESURÉ, pas déduit d'un silence. */
export function isArchiveAbsent(spacecraft: string): boolean {
  return index ? spacecraft in index.absent : false;
}

const archives = new Map<string, SpacecraftArchive>();
const failed = new Set<string>();

/**
 * L'archive d'une sonde. Trois réponses, et la distinction compte :
 *
 *   - une ARCHIVE : le registre déclare ce que porte cette sonde ;
 *   - `'absent'` : le registre n'en déclare RIEN, et c'est une mesure. La fiche le dit, au lieu de
 *     masquer un bloc, parce qu'un visiteur qui ouvre Parker Solar Probe après Cassini verrait
 *     sinon un bloc disparaître sans savoir pourquoi ;
 *   - `null` : soit l'index n'a pas répondu, soit **ce n'est pas une sonde**. La fiche s'ouvre
 *     aussi pour un corps du catalogue et pour un objet interstellaire, qui ne portent aucun
 *     instrument : le bloc reste alors masqué, ce qui est la bonne réponse et non un aveu.
 */
export async function loadSpacecraftArchive(
  spacecraft: string
): Promise<SpacecraftArchive | 'absent' | null> {
  const cached = archives.get(spacecraft);
  if (cached) return cached;
  if (failed.has(spacecraft)) return null;
  const loaded = await loadInstrumentIndex();
  if (!loaded) return null;
  if (spacecraft in loaded.absent) return 'absent';
  if (!(spacecraft in loaded.spacecraft)) return null;
  try {
    const res = await fetch(`/assets/instruments/${spacecraft}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = (await res.json()) as SpacecraftArchive;
    const archive: SpacecraftArchive = {
      hosts: raw.hosts,
      // L'ORDRE VIENT DES MODULES PURS, jamais du fichier : cf. `core/instruments.ts`.
      investigations: sortMissions(raw.investigations),
      instruments: sortInstruments(raw.instruments),
    };
    archives.set(spacecraft, archive);
    return archive;
  } catch (error: unknown) {
    failed.add(spacecraft);
    Logger.warn(`[Instruments] ${spacecraft} indisponible : ${String(error)}`);
    return null;
  }
}
