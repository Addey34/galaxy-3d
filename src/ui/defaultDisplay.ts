/**
 * CE QUE MONTRE LA PREMIÈRE VUE : UNE RÈGLE, PAS UNE SOMME DE DÉFAUTS LOCAUX.
 *
 * Chaque ligne du tableau Réglages a trois cases (étiquette, objet, orbite), et chaque couche
 * décidait jusqu'ici de son propre défaut : les planètes nommées, les lunes non, les sondes et
 * les objets interstellaires nommés ET dessinés (mesuré au 2026-09-22 : BepiColombo,
 * OSIRIS-REx, Parker Solar Probe, Juno et 3I/ATLAS nommés dès le chargement, le nom
 * d'OSIRIS-REx sur celui de Vénus). La règle, écrite une fois :
 *
 *   - le Soleil, les huit planètes et la Lune sont nommés (`MAJOR_BODIES`) ;
 *   - tout corps du catalogue est dessiné, puisque c'est la scène elle-même ;
 *   - seules les orbites des planètes sont tracées ;
 *   - les OBJETS D'INSTRUMENT (sondes, objets interstellaires) sont en option : ni point ni
 *     nom, comme les orbites des petits corps. Ce sont des aides de navigation peintes
 *     par-dessus la scène, pas des corps qu'elle contient.
 *
 * Une exception, dans toutes les couches : l'objet SÉLECTIONNÉ est toujours dessiné et nommé.
 * Sans elle, choisir Juno dans la palette ouvrirait une vue sur un point que rien ne dessine.
 */
import { MAJOR_BODIES } from './exploHud';
import type { BodyKind } from '@/types';

export interface DisplayDefaults {
  label: boolean;
  object: boolean;
  orbit: boolean;
}

/** Les catégories peintes par la couche instrument, en option au premier chargement. */
export const INSTRUMENT_KINDS: ReadonlySet<BodyKind> = new Set<BodyKind>([
  'spacecraft',
  'interstellar',
]);

export function defaultDisplay(name: string, kind: BodyKind): DisplayDefaults {
  if (INSTRUMENT_KINDS.has(kind))
    return { label: false, object: false, orbit: false };
  return {
    label: MAJOR_BODIES.has(name),
    object: true,
    orbit: kind === 'planet',
  };
}
