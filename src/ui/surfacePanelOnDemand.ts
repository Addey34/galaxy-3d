/**
 * LE PANNEAU D'IMAGERIE DE SURFACE, CHARGÉ QUAND IL SERT (GAL-SATELLITE-TRACKING-001, budget du démarrage).
 *
 * `ui/surfacePanel` (réglages, bandeau de provenance, pilotage du moteur de tuiles, bâtiments 3D) pesait ~13 Kio
 * dans le démarrage alors qu'il ne fait RIEN tant que la caméra n'est pas à moins de `SURFACE_PANEL_LOAD_RADII`
 * rayons d'un corps : sa propre image par image le dit (« rien n'est chargé, et surtout rien n'est DEMANDÉ »). Il
 * est donc monté à la première de ces trois occasions, et jamais avant :
 *  - la caméra s'approche d'un corps (la condition même que le panneau applique avant de charger son moteur) ;
 *  - le visiteur ouvre les réglages, où vivent ses commutateurs ;
 *  - une visite guidée choisit un fond pour le sol de la Terre (le choix est gardé et appliqué à la mise en place).
 *
 * Ce qui change pour le visiteur : un aller-retour réseau de plus (le morceau du panneau, ~13 Kio) AVANT
 * le moteur de tuiles, qui était déjà chargé à la demande ; rien à l'écran tant que la caméra est loin.
 */
import type { PublicAPI } from '@/SolarSystemApp';
import { SURFACE_PANEL_LOAD_RADII } from '@/core/layerDistances';
import Logger from '@/utils/Logger';
import {
  DEFAULT_SURFACE_CHOICE,
  SURFACE_CHOICES,
  type SurfaceChoiceId,
} from './surfaceChoices';
import type { SurfacePanelHandle } from './surfacePanel';

/** Après un échec de chargement (hors ligne), on ne réessaie pas avant ce délai. */
const RETRY_MS = 5000;

export function setupSurfacePanelOnDemand(api: PublicAPI): SurfacePanelHandle {
  let loaded: SurfacePanelHandle | null = null;
  let loading = false;
  let retryAt = 0;
  let disposed = false;
  let chosen: SurfaceChoiceId | null = null;

  const load = (): void => {
    if (loaded || loading || disposed || performance.now() < retryAt) return;
    loading = true;
    void import('./surfacePanel')
      .then((module) => {
        if (disposed) return;
        loaded = module.setupSurfacePanel(api);
        if (chosen !== null) loaded.setBase(chosen);
      })
      .catch((error: unknown) => {
        Logger.warn(`[Surface] panneau indisponible : ${String(error)}`);
        retryAt = performance.now() + RETRY_MS;
      })
      .finally(() => {
        loading = false;
      });
  };

  const unsubscribe = api.animationSystem.onFrame(() => {
    if (loaded) return;
    const name = api.cameraSystem.targetName;
    const distance = api.cameraSystem.getDistanceToTargetSceneUnits();
    if (!name || distance === null) return;
    const radius = api.sceneSystem.getBody(name)?.group.userData['radius'] as
      number | undefined;
    if (radius && radius > 0 && distance / radius <= SURFACE_PANEL_LOAD_RADII)
      load();
  });
  const settings = document.getElementById('settings-trigger');
  settings?.addEventListener('click', load);

  return {
    dispose: () => {
      disposed = true;
      unsubscribe();
      settings?.removeEventListener('click', load);
      loaded?.dispose();
      loaded = null;
    },
    base: () => loaded?.base() ?? chosen ?? DEFAULT_SURFACE_CHOICE,
    setBase: (id) => {
      if (loaded) return loaded.setBase(id);
      if (!SURFACE_CHOICES.includes(id)) return false;
      chosen = id;
      load();
      return true;
    },
  };
}
