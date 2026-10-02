/**
 * ACCÈS AUX ADOPTIONS DE NOMS DE SURFACE PAR DATE — façade unique, RIEN au démarrage (ligne
 * 22.10, front des noms).
 *
 * L'index (`config/gazetteerAdoptionIndex.json`, écrit par `pnpm gazetteer:generate`) est
 * importé DYNAMIQUEMENT, comme celui de la découverte : il compte, par corps et par date, ce que
 * l'UAI a adopté, pour que la fiche réponde sans télécharger les 9 087 noms de la Lune.
 */
import type { BodyAdoptions } from '@/core/nameAdoption';
import Logger from '@/utils/Logger';

interface AdoptionIndex {
  readonly provider: { readonly url: string; readonly accessed: string };
  readonly bodies: Record<string, BodyAdoptions>;
}

let index: AdoptionIndex | null = null;
let indexPromise: Promise<AdoptionIndex | null> | null = null;

function loadIndex(): Promise<AdoptionIndex | null> {
  if (index) return Promise.resolve(index);
  indexPromise ??= import('./gazetteerAdoptionIndex.json')
    .then((module) => {
      index = module.default as unknown as AdoptionIndex;
      return index;
    })
    .catch((error: unknown) => {
      indexPromise = null;
      Logger.warn(`[Noms] index des adoptions indisponible : ${String(error)}`);
      return null;
    });
  return indexPromise;
}

/**
 * Les adoptions d'un corps et la date de lecture du gazetteer, ou `null` quand ce corps ne porte
 * aucun nom de l'UAI (la plupart des petits corps, le Soleil) : la ligne reste alors absente.
 */
export async function loadNameAdoptions(body: string): Promise<{
  adoptions: BodyAdoptions;
  accessed: string;
} | null> {
  const loaded = await loadIndex();
  const adoptions = loaded?.bodies[body];
  if (!loaded || !adoptions) return null;
  return { adoptions, accessed: loaded.provider.accessed };
}
