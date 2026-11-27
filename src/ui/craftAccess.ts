/**
 * Les types que partagent le démarrage et l'inspection 3D (`ui/craftInspector`) : seulement des types,
 * donc rien au démarrage (GAL-OBJECT-IMMERSION-001).
 */
export type { CraftInspector } from './craftInspector';

/**
 * Ouvre l'inspection du modèle `id` ; `opener` reçoit le focus à la fermeture. Résout `true` quand la
 * vue est OUVERTE (un fait, lu sur l'inspection), `false` si elle ne s'est pas ouverte : une visite
 * l'attend sans deviner (GAL-TOUR-EXCELLENCE-002 ; une fermeture plus rapide qu'une scrutation
 * passait inaperçue). Les boutons des fiches l'ignorent.
 */
export type CraftOpener = (
  id: string,
  opener?: HTMLElement | null
) => Promise<boolean>;
