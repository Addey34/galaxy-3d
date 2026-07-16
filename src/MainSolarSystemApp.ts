/**
 * Point d'entrée de l'application — racine de composition de la couche UI.
 *
 * Démarre `SolarSystemApp` puis câble chaque module d'interface (`ui/`) sur la `PublicAPI`.
 * Chaque module possède ses propres références DOM ; ce fichier ne fait qu'orchestrer :
 *   - `ui/loader`       — progression et écran d'erreur ;
 *   - `ui/fullscreen`   — bouton plein écran ;
 *   - `ui/planetNav`    — boutons de navigation entre corps ;
 *   - `ui/playback`     — lecture/pause et vitesse ;
 *   - `ui/timePanel`    — panneau date-heure (voyage temporel) ;
 *   - `ui/modeSwitcher` — bascule Éducatif ↔ Exploration.
 */
import { SolarSystemApp } from './SolarSystemApp';
import { updateProgress, hideLoader, showError } from './ui/loader';
import { setupFullscreen } from './ui/fullscreen';
import { setupPlanetControls } from './ui/planetNav';
import { setupPlayback } from './ui/playback';
import { setupTimePanel } from './ui/timePanel';
import { setupModeSwitcher } from './ui/modeSwitcher';
import { ExploHud } from './ui/exploHud';
import { SmallBodyOverlay } from './ui/smallBodyOverlay';
import { setupBodyPicker } from './ui/bodyPicker';
import { fetchSmallBodies } from './core/sbdb';
import { CELESTIAL_CONFIG } from './config/settings';
import { flattenBodies } from './config/catalog';

setupFullscreen();

(async function loadApp(): Promise<void> {
  try {
    updateProgress(10, 'Loading core components...');

    const app = new SolarSystemApp();
    const { cameraSystem, animationSystem, sceneSystem, orbitalMechanics } =
      await app.init(updateProgress);

    const planetNav = setupPlanetControls(cameraSystem);
    const playback = setupPlayback(animationSystem, orbitalMechanics);
    setupTimePanel(orbitalMechanics, playback);

    // Clic 3D : sélectionner un corps en cliquant son mesh (surtout en Éducatif), via la
    // même commande de navigation partagée que la barre et les labels.
    const bodyNames = new Set(
      [...flattenBodies(CELESTIAL_CONFIG).entries()]
        .filter(([, cfg]) => cfg.kind !== 'skybox')
        .map(([name]) => name)
    );
    setupBodyPicker(
      sceneSystem.scene,
      cameraSystem.camera,
      cameraSystem.renderer.domElement,
      planetNav,
      bodyNames
    );

    // HUD « Voyage spatial » — actif uniquement en mode Exploration. Ses labels projetés
    // ciblent les corps via la commande de navigation partagée.
    const exploHud = new ExploHud(planetNav, cameraSystem.renderer.domElement);
    exploHud.mount();

    // Champ de masse des petits corps (SBDB) — couche instrument 2D, chargée en tâche de
    // fond. Dégradation propre : si le fetch échoue (offline), l'overlay reste vide.
    const smallBodyOverlay = new SmallBodyOverlay();
    smallBodyOverlay.mount();
    void fetchSmallBodies().then((bodies) =>
      smallBodyOverlay.setBodies(bodies)
    );

    animationSystem.onFrame(() => {
      exploHud.update(cameraSystem.camera, cameraSystem, sceneSystem);
      smallBodyOverlay.update(
        cameraSystem.camera,
        orbitalMechanics.simulationDate
      );
    });
    setupModeSwitcher(orbitalMechanics, cameraSystem, (mode) => {
      exploHud.setActive(mode === 'explo');
      smallBodyOverlay.setActive(mode === 'explo');
    });

    hideLoader();
  } catch (err) {
    showError(err instanceof Error ? err : new Error(String(err)));
  }
})();
