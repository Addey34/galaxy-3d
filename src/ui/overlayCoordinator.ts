export type SecondaryOverlayId =
  'body-palette' | 'body-info' | 'orbit-options' | 'events' | 'help';

export interface OverlayCoordinator {
  register(id: SecondaryOverlayId, close: () => void): () => void;
  requestOpen(id: SecondaryOverlayId): void;
  /** Ferme toute surface contextuelle ouverte (ex. clic sur le scrim, Échap global). */
  closeAll(): void;
  onOpen(listener: (id: SecondaryOverlayId | null) => void): () => void;
}

/**
 * Coordonne les surfaces contextuelles : une seule ouverte à la fois. Les deux ancres
 * persistantes (recherche de corps dans le dock, contrôles de temps) restent toujours là ;
 * palette, fiche d'info, réglages, événements et aide se partagent un unique emplacement
 * contextuel. Émet `null` quand tout est refermé, pour que le scrim et les états `aria`
 * des déclencheurs se resynchronisent.
 */
export function setupOverlayCoordinator(): OverlayCoordinator {
  const closers = new Map<SecondaryOverlayId, () => void>();
  const listeners = new Set<(id: SecondaryOverlayId | null) => void>();

  const notify = (id: SecondaryOverlayId | null): void => {
    for (const listener of listeners) listener(id);
  };

  return {
    register(id, close) {
      closers.set(id, close);
      return () => closers.delete(id);
    },
    requestOpen(id) {
      for (const [otherId, close] of closers) {
        if (otherId !== id) close();
      }
      notify(id);
    },
    closeAll() {
      for (const close of closers.values()) close();
      notify(null);
    },
    onOpen(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
