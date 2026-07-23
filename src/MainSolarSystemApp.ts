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
import { t } from './i18n';
import { initStaticI18n } from './i18n/dom';
import { updateProgress, hideLoader, showError } from './ui/loader';
import { setupFullscreen } from './ui/fullscreen';
import { setupHelp } from './ui/help';
import { setupLangSwitch } from './ui/langSwitch';
import { setupPlanetControls } from './ui/planetNav';
import { setupBodyInfo } from './ui/bodyInfo';
import { setupPlayback } from './ui/playback';
import { setupTimePanel } from './ui/timePanel';
import { setupModeSwitcher } from './ui/modeSwitcher';
import { ExploHud } from './ui/exploHud';
import { SmallBodyOverlay } from './ui/smallBodyOverlay';
import { setupBodyPicker } from './ui/bodyPicker';
import { initOnboarding } from './ui/onboarding';
import { setupOrbitOptions } from './ui/orbitOptions';
import { fetchSmallBodies } from './core/sbdb';
import { CELESTIAL_CONFIG } from './config/bodies';
import { flattenBodies } from './config/catalog';

// Traduit les chaînes statiques du HTML avant tout et synchronise <html lang> ; les modules
// dynamiques (loader, bodyInfo…) se retraduisent ensuite via leurs propres abonnements.
initStaticI18n();
setupLangSwitch();
setupFullscreen();
setupHelp();

(async function loadApp(): Promise<void> {
  try {
    updateProgress(10, t('loader.core'));

    const app = new SolarSystemApp();
    const { cameraSystem, animationSystem, sceneSystem, orbitalMechanics } =
      await app.init(updateProgress);

    // Fiche d'info par corps : s'ouvre pour toute sélection (barre, clic 3D, label Explo),
    // se ferme sur retour Vue Globale. Toutes les sources passent par planetNav.selectBody.
    setupOrbitOptions(sceneSystem);
    const bodyInfo = setupBodyInfo();
    const planetNav = setupPlanetControls(cameraSystem, (name) => {
      if (name === 'overview') bodyInfo.hide();
      else bodyInfo.show(name);
    });
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

    // Le bloc live de la fiche (distance réelle + temps-lumière) n'a de sens qu'en Explo,
    // pour la cible suivie ; en Éducatif ou en vue libre on passe `null` → bloc masqué.
    let currentMode: 'educ' | 'explo' = 'educ';
    animationSystem.onFrame(() => {
      exploHud.update(cameraSystem.camera, cameraSystem, sceneSystem);
      smallBodyOverlay.update(
        cameraSystem.camera,
        orbitalMechanics.simulationDate
      );
      bodyInfo.updateLive(
        currentMode === 'explo'
          ? cameraSystem.getDistanceToTargetSceneUnits()
          : null
      );
    });
    setupModeSwitcher(orbitalMechanics, cameraSystem, (mode) => {
      currentMode = mode;
      // Le changement de mode remet la sélection sur la Vue Globale → referme la fiche.
      bodyInfo.hide();
      exploHud.setActive(mode === 'explo');
      smallBodyOverlay.setActive(mode === 'explo');
    });

    hideLoader();
    initOnboarding();
  } catch (err) {
    showError(err instanceof Error ? err : new Error(String(err)));
  }
})();
