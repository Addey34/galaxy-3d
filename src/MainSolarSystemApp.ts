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
import { setupShare } from './ui/share';
import { setupHelp } from './ui/help';
import { setupGuidedTour } from './ui/guidedTour';
import { setupLangSwitch } from './ui/langSwitch';
import { setupPlanetControls } from './ui/planetNav';
import { setupBodyInfo } from './ui/bodyInfo';
import { setupPlayback } from './ui/playback';
import { setupQualitySwitch } from './ui/qualitySwitch';
import { setupTimePanel } from './ui/timePanel';
import { setupModeSwitcher } from './ui/modeSwitcher';
import { setupPermalinks } from './ui/permalink';
import { setupAstronomicalEvents } from './ui/astronomicalEvents';
import { setupOpticalZoom } from './ui/opticalZoom';
import { ExploHud } from './ui/exploHud';
import { SmallBodyOverlay } from './ui/smallBodyOverlay';
import { setupBodyPicker } from './ui/bodyPicker';
import { setupOrbitOptions } from './ui/orbitOptions';
import { setupRealtimeClouds } from './ui/realtimeClouds';
import { setupCloudModelLayer } from './ui/cloudModelLayer';
import { setupPrecipLayer } from './ui/precipLayer';
import { setupPrecipModelLayer } from './ui/precipModelLayer';
import { setupWindLayer } from './ui/windLayer';
import { setupThermalLayer } from './ui/thermalLayer';
import { setupThermalModelLayer } from './ui/thermalModelLayer';
import { setupPressureModelLayer } from './ui/pressureModelLayer';
import { setupHumidityModelLayer } from './ui/humidityModelLayer';
import { setupWeatherLayers } from './ui/weatherLayers';
import type { WeatherLayerHandle } from './ui/earthLayer';
import { setupOverlayCoordinator } from './ui/overlayCoordinator';
import { setupSolarDebug } from './ui/solarDebug';
import { setupEarthDebug } from './ui/earthDebug';
import { setupMeteoDebug } from './ui/meteoDebug';
import { fetchSmallBodies } from './core/sbdb';
import { CELESTIAL_CONFIG } from './config/bodies';
import { flattenBodies } from './config/catalog';

// Traduit les chaînes statiques du HTML avant tout et synchronise <html lang> ; les modules
// dynamiques (loader, bodyInfo…) se retraduisent ensuite via leurs propres abonnements.
initStaticI18n();
setupLangSwitch();
setupFullscreen();
setupShare();
const overlayCoordinator = setupOverlayCoordinator();
setupHelp(overlayCoordinator);
const guidedTour = setupGuidedTour();

// Fermeture au clic extérieur d'une surface contextuelle.
//   - Mobile : le scrim est une couche tactile plein écran (tap hors feuille = fermer).
//   - Desktop : le scrim est volontairement transparent aux évènements (il ne doit pas
//     bloquer la molette/rotation sur la scène) ; on capte donc le clic extérieur au niveau
//     du document, en ignorant les clics dans une surface ou sur un déclencheur du dock.
const surfaceScrim = document.getElementById('surface-scrim');
if (surfaceScrim) {
  overlayCoordinator.onOpen((id) => {
    surfaceScrim.hidden = id === null;
  });
  // Couche tactile mobile.
  surfaceScrim.addEventListener('click', () => overlayCoordinator.closeAll());

  // Clic extérieur desktop : seul un clic DANS LA SCÈNE (canvas WebGL) ferme la surface
  // ouverte. Les autres docks (modes, temps, plein écran) laissent la surface en place —
  // basculer de mode ou lire l'heure ne doit pas refermer la fiche ou les réglages. Les
  // déclencheurs gèrent eux-mêmes leur bascule. `pointerdown` pour devancer le focus.
  document.addEventListener('pointerdown', (event) => {
    if (surfaceScrim.hidden) return; // aucune surface ouverte
    const target = event.target as HTMLElement;
    if (target.tagName === 'CANVAS') overlayCoordinator.closeAll();
  });
}

(async function loadApp(): Promise<void> {
  try {
    updateProgress(0, t('loader.init'));

    const app = new SolarSystemApp();
    const api = await app.init(updateProgress);
    const { cameraSystem, animationSystem, sceneSystem, orbitalMechanics } = api;
    setupSolarDebug(api);
    setupEarthDebug(api);

    // Registre des COUCHES MÉTÉO de la Terre. Chaque `setup*` monte sa couche (données
    // GIBS/Open-Meteo synchronisées sur la date de simulation, repli statique hors-ligne)
    // et renvoie un `WeatherLayerHandle` uniforme. On les collecte dans l'ordre d'affichage :
    // - nuages réels (NASA GIBS), affichés par défaut ;
    // - pluie mondiale (NASA IMERG), affichée par défaut ;
    // - vent (particules Open-Meteo) : null si désactivé (WIND_SETTINGS) ou Terre absente ;
    // - température de surface (MERRA-2) : chargée en fond, masquée par défaut.
    // Le panneau météo construit ses toggles par simple itération sur ce tableau.
    const weatherLayers = [
      setupRealtimeClouds(api),
      setupCloudModelLayer(api),
      setupPrecipLayer(api),
      setupPrecipModelLayer(api),
      setupWindLayer(api),
      setupThermalLayer(api),
      setupThermalModelLayer(api),
      setupPressureModelLayer(api),
      setupHumidityModelLayer(api),
    ].filter((layer): layer is WeatherLayerHandle => layer !== null);

    // Chaque couche satellite/GIBS et son équivalent MODÈLE sont mutuellement exclusifs (ils
    // partagent le même mesh Terre) : nuages, pluie. Les couches modèle COLORÉES (température,
    // pression, humidité) partagent TOUTES le mesh `thermal` → un seul groupe les rend exclusives
    // entre elles ET avec la couche satellite température (activer l'une masque les autres).
    setupWeatherLayers(
      api,
      {
        layers: weatherLayers,
        exclusiveGroups: [
          ['clouds', 'clouds-model'],
          ['precip', 'precip-model'],
          ['thermal', 'thermal-model', 'pressure-model', 'humidity-model'],
        ],
      },
      overlayCoordinator
    );

    setupMeteoDebug(api, weatherLayers);

    // Fiche d'info par corps : s'ouvre pour toute sélection (barre, clic 3D, label Explo),
    // se ferme sur retour Vue Globale. Toutes les sources passent par planetNav.selectBody.
    let syncPermalink = (): void => undefined;
    const bodyInfo = setupBodyInfo(overlayCoordinator);
    const planetNav = setupPlanetControls(
      cameraSystem,
      (name) => {
        if (name === 'overview') bodyInfo.hide();
        else bodyInfo.show(name);
        syncPermalink();
      },
      overlayCoordinator
    );
    const playback = setupPlayback(animationSystem, orbitalMechanics);
    setupQualitySwitch(sceneSystem, overlayCoordinator);
    setupTimePanel(
      orbitalMechanics,
      playback,
      () => {
        syncPermalink();
      },
      overlayCoordinator
    );

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

    // HUD de labels projetés — actif en Éducatif ET Exploration.
    // En Éducatif : labels texte au-dessus de chaque corps avec mesh.
    // En Exploration : point + texte pour tous les corps (corps invisible à l'œil nu).
    const exploHud = new ExploHud(planetNav, cameraSystem.renderer.domElement);
    exploHud.mount();
    // Filtre éduc : corps avec mesh uniquement (planètes, naines texturées — pas astéroïdes/comètes).
    exploHud.setEducFilter(
      new Set(
        [...flattenBodies(CELESTIAL_CONFIG).entries()]
          .filter(([, cfg]) => cfg.kind !== 'skybox')
          .map(([name]) => name)
      )
    );
    exploHud.setMode('educ');
    exploHud.setActive(true);
    setupOrbitOptions(
      sceneSystem,
      (visible) => exploHud.setLabelsVisible(visible),
      overlayCoordinator
    );

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
    const opticalZoom = setupOpticalZoom(cameraSystem);
    const modeSwitcher = setupModeSwitcher(
      orbitalMechanics,
      cameraSystem,
      (mode) => {
        currentMode = mode;
        opticalZoom.setMode(mode);
        exploHud.setMode(mode); // change le style des labels (éduc ↔ explo), reste actif
        smallBodyOverlay.setActive(mode === 'explo');
        syncPermalink();
      }
    );

    const permalink = setupPermalinks(
      orbitalMechanics,
      planetNav,
      modeSwitcher,
      bodyNames
    );
    syncPermalink = permalink.sync;
    permalink.applyInitialState();
    setupAstronomicalEvents(orbitalMechanics, {
      onDateChange: () => syncPermalink(),
      coordinator: overlayCoordinator,
      navigation: planetNav,
      playback,
    });
    hideLoader();
    guidedTour.startIfFirstVisit();
  } catch (err) {
    showError(err instanceof Error ? err : new Error(String(err)));
  }
})();
