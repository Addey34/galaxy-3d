/**
 * QUELLES LIGNES D'ORBITE SONT TRACÉES AU DÉMARRAGE : une règle, un propriétaire (2026-10-04).
 *
 * La règle elle-même n'est pas neuve : le tableau « Dans la scène » allume les orbites des
 * planètes et seulement elles (`ui/defaultDisplay.ts`). Ce qui change, c'est que l'application
 * sans DOM (`SolarSystemApp`) doit la connaître AVANT que l'interface existe : une ligne d'orbite
 * coûte une période ENTIÈRE d'éphéméride (333 Ko pour Halley), et le démarrage la téléchargeait
 * pour tous les corps du catalogue, ligne affichée ou non. Mesuré le 2026-10-04 en ajoutant 23
 * cibles de missions : 2 037 696 octets au 2015-06-15 pour un budget de 1 800 000, quand la garde
 * du budget nommait déjà la piste — « ne calculer que les lignes réellement visibles ».
 *
 * Elle vit donc ici, dans `core/`, et l'interface la LIT au lieu de la recopier.
 */
import type { BodyKind } from '@/types';

/** La ligne d'orbite de ce corps est-elle tracée tant que personne n'a touché au tableau ? */
export function orbitLineShownByDefault(kind: BodyKind): boolean {
  return kind === 'planet';
}
