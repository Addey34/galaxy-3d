/**
 * Ce que la racine de composition prête au bloc « Poursuivre l'observation » (GAL-OBSERVATION-001) : les
 * commandes que l'application possède DÉJÀ, jamais un chemin à lui. Seulement un type : rien au démarrage.
 */
export interface ObservationActions {
  /** La sélection partagée (`planetNav.selectBody`) : la seule façon de choisir un corps. */
  selectBody(name: string): void;
  setMode(mode: 'educ' | 'explo'): void;
  getMode(): 'educ' | 'explo';
  /** Réécrit l'adresse après un changement de date ou de mode. */
  sync(): void;
  /** Fige la lecture, comme le panneau des événements avant un saut vers un événement. */
  pause(): void;
  /** Lance une visite par le lecteur de visites (chargé à la demande). */
  startTour(id: string): Promise<boolean>;
  /** Allume la couche des satellites en orbite, comme sa case. */
  showSatellites(): void;
  /** Ouvre la vue du voisinage solaire. */
  openNeighbourhood(): void;
}
