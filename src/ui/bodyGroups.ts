/**
 * Groupes de corps, dans l'ordre où l'interface les présente, et leur nom.
 *
 * Une seule liste pour la palette de recherche ET pour le tableau des Réglages : les deux
 * surfaces nomment donc les mêmes familles avec les mêmes mots (« Lunes », « Sondes »…), au
 * lieu que chacune invente les siens.
 */
import type { BodyKind } from '@/types';

export interface BodyGroup {
  /** Clé i18n du nom du groupe, aussi posée en `data-group`. */
  key: string;
  kinds: ReadonlySet<BodyKind>;
}

export const BODY_GROUPS: readonly BodyGroup[] = [
  { key: 'nav.group.star', kinds: new Set<BodyKind>(['star']) },
  { key: 'nav.group.planet', kinds: new Set<BodyKind>(['planet']) },
  { key: 'nav.group.moon', kinds: new Set<BodyKind>(['moon']) },
  { key: 'nav.group.dwarf', kinds: new Set<BodyKind>(['dwarf']) },
  {
    key: 'nav.group.other',
    kinds: new Set<BodyKind>(['asteroid', 'comet']),
  },
  // Couche instrument : peinte par-dessus la scène, cherchable et réglable comme un corps
  // (cf. `config/navigable.ts`).
  { key: 'nav.group.spacecraft', kinds: new Set<BodyKind>(['spacecraft']) },
  {
    key: 'nav.group.interstellar',
    kinds: new Set<BodyKind>(['interstellar']),
  },
];
