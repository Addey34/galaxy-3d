/**
 * ACCÈS AU PROFIL MESURÉ D'UNE ATMOSPHÈRE (lot 51, pas 3) — façade unique, et RIEN au démarrage.
 *
 * Même partition que les instruments du lot 42 :
 *   - l'INDEX (`config/atmosphereProfileIndex.json`, écrit par `pnpm atmosphere:generate`) dit
 *     quelle géante a un profil et, pour les autres, combien de collections le registre du PDS
 *     leur rattachait le jour de la lecture. Il est importé DYNAMIQUEMENT ;
 *   - le PROFIL (`public/assets/atmosphere-profiles/{corps}.json`, 36 ko pour Jupiter) n'arrive
 *     qu'à l'ouverture de la fiche, une seule fois. L'adresse est ABSOLUE, pour la raison écrite
 *     en tête de `config/instruments.ts` : le corps est porté par le CHEMIN de l'URL.
 */
import type { AtmosphereProfile } from '@/core/atmosphereProfile';
import Logger from '@/utils/Logger';

interface AtmosphereProfileIndex {
  readonly profiles: Record<string, { readonly samples: number }>;
  readonly absent: Record<
    string,
    { readonly collections: number; readonly retrieved: string }
  >;
}

let index: AtmosphereProfileIndex | null = null;
let indexPromise: Promise<AtmosphereProfileIndex | null> | null = null;

/** L'index, chargé une seule fois ; un échec n'est pas retenu comme définitif. */
function loadIndex(): Promise<AtmosphereProfileIndex | null> {
  if (index) return Promise.resolve(index);
  indexPromise ??= import('./atmosphereProfileIndex.json')
    .then((module) => {
      index = module.default as unknown as AtmosphereProfileIndex;
      return index;
    })
    .catch((error: unknown) => {
      indexPromise = null;
      Logger.warn(`[Atmosphère] index indisponible : ${String(error)}`);
      return null;
    });
  return indexPromise;
}

/** Un profil, ou la mesure de son absence, ou rien (ce corps n'est pas une géante). */
export type ProfileAnswer =
  | { readonly kind: 'profile'; readonly profile: AtmosphereProfile }
  | {
      readonly kind: 'absent';
      readonly collections: number;
      readonly retrieved: string;
    };

const profiles = new Map<string, AtmosphereProfile>();

export async function loadAtmosphereProfile(
  body: string
): Promise<ProfileAnswer | null> {
  const cached = profiles.get(body);
  if (cached) return { kind: 'profile', profile: cached };
  const loaded = await loadIndex();
  if (!loaded) return null;
  const absent = loaded.absent[body];
  if (absent) return { kind: 'absent', ...absent };
  if (!(body in loaded.profiles)) return null;
  try {
    const res = await fetch(`/assets/atmosphere-profiles/${body}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const profile = (await res.json()) as AtmosphereProfile;
    profiles.set(body, profile);
    return { kind: 'profile', profile };
  } catch (error) {
    Logger.warn(
      `[Atmosphère] profil de ${body} indisponible : ${String(error)}`
    );
    return null;
  }
}
