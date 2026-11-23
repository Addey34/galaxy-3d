/**
 * Les types que partagent le démarrage et l'inspection 3D (`ui/craftInspector`) : seulement des types,
 * donc rien au démarrage (GAL-OBJECT-IMMERSION-001).
 */
export type { CraftInspector } from './craftInspector';

/** Ouvre l'inspection du modèle `id` ; `opener` reçoit le focus à la fermeture. */
export type CraftOpener = (id: string, opener?: HTMLElement | null) => void;
