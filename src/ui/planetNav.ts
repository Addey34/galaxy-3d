/**
 * Navigation entre corps — commande de sélection partagée.
 *
 * `PlanetNavigation.selectBody(name)` est le point d'entrée unique : la palette de recherche
 * (`ui/bodyPalette`), le clic 3D (`ui/bodyPicker`) et les labels projetés (`ui/exploHud`) y
 * passent tous. Ce module pilote la caméra et tient l'état sélectionné ; l'affichage de la
 * liste des corps est délégué à la palette (qui garde le contrat `#orbit-{name}` / `.is-active`).
 */
import type { CameraSystem } from '@/components/systems/CameraSystem';
import { setupBodyPalette, type BodyPalette } from './bodyPalette';
import type { OverlayCoordinator } from './overlayCoordinator';

export interface PlanetNavigation {
  /**
   * Cible un corps (ou la « Vue globale » via `'overview'`) : lance le vol caméra et
   * synchronise l'état actif. Fonctionne aussi pour les corps sans entrée de palette
   * (petits corps naviguables par leur label Explo). `CameraSystem.setTarget` ignore les
   * noms inconnus.
   */
  selectBody(name: string): void;
  /** Corps actuellement sélectionné, `overview` pour la vue globale. */
  getSelectedBody(): string | null;
}

export function setupPlanetControls(
  camera: CameraSystem,
  onSelect?: (name: string) => void,
  coordinator?: OverlayCoordinator
): PlanetNavigation {
  let selectedBody: string | null = 'overview';

  const selectBody = (name: string): void => {
    selectedBody = name;
    palette.setActive(name === 'overview' ? 'overview' : name);
    palette.close();
    if (name === 'overview') {
      camera.goToOverview();
    } else {
      camera.setTarget(name);
    }
    // Un seul point de notification : palette, picker 3D et labels Explo passent tous ici.
    onSelect?.(name);
  };

  // `selectBody` référence `palette`, mais n'est invoqué qu'après cette construction
  // (au clic / à la frappe), donc l'ordre d'initialisation est sûr.
  const palette: BodyPalette = setupBodyPalette(
    (name) => selectBody(name),
    coordinator
  );
  palette.setActive('overview');

  return {
    selectBody,
    getSelectedBody: () => selectedBody,
  };
}
