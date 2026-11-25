/**
 * La couleur INDICATIVE d'un type spectral, partagée par la scène du voisinage et celle d'un système
 * (GAL-UNIVERSE-007 : sortie de `NeighbourhoodScene` pour que l'exploration d'un système du ciel ne
 * télécharge pas la scène du voisinage).
 */
import type { Vec3 } from '@/core/stellarSpace';

/** Couleur indicative du type spectral (première lettre, ou naine blanche « D ») ; blanc sinon. */
export function spectralColour(spectral: string | null): Vec3 {
  const s = (spectral ?? '').trim();
  const first = s[0]?.toUpperCase() ?? '';
  switch (first) {
    case 'O':
    case 'B':
      return [0.65, 0.78, 1];
    case 'A':
      return [0.86, 0.92, 1];
    case 'F':
      return [1, 0.97, 0.86];
    case 'G':
      return [1, 0.9, 0.55];
    case 'K':
      return [1, 0.72, 0.4];
    case 'M':
      return [1, 0.5, 0.36];
    case 'D':
      return [0.84, 0.9, 1];
    default:
      // « sdM4 » (sous-naine) : la lettre utile suit le préfixe.
      return /^sd[A-Z]/.test(s) ? spectralColour(s.slice(2)) : [1, 1, 1];
  }
}
