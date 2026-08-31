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
import { setupCapture } from './ui/capture';
import { setupWebXR } from './ui/webxr';
import { setupHelp } from './ui/help';
import { setupGuidedTour } from './ui/guidedTour';
import { setupTourPlayer } from './ui/tourPlayer';
import { TOUR_SCRIPTS } from './config/tourScripts';
import { setupLangSwitch } from './ui/langSwitch';
import { setupPlanetControls } from './ui/planetNav';
import { setupBodyInfo } from './ui/bodyInfo';
import { setupPlayback } from './ui/playback';
import { setupQualitySwitch } from './ui/qualitySwitch';
import { setupTimePanel } from './ui/timePanel';
import { setupModeSwitcher } from './ui/modeSwitcher';
import { setupExploTourNudge } from './ui/exploTourNudge';
import { setupExploScaleBadge } from './ui/exploScaleBadge';
import { setupPermalinks } from './ui/permalink';
import { setupAstronomicalEvents } from './ui/astronomicalEvents';
import { setupOpticalZoom } from './ui/opticalZoom';
import { ExploHud } from './ui/exploHud';
import { SmallBodyOverlay } from './ui/smallBodyOverlay';
import { setupSmallBodyFilters } from './ui/smallBodyFilters';
import { SpacecraftOverlay } from './ui/spacecraftOverlay';
import { SPACECRAFT_MISSIONS } from './config/spacecraft';
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
import {
  setupOverlayCoordinator,
  type SecondaryOverlayId,
} from './ui/overlayCoordinator';
import { setupContextRecovery } from './ui/contextRecovery';
import { setupSolarDebug } from './ui/solarDebug';
import { setupEarthDebug } from './ui/earthDebug';
import { setupMeteoDebug } from './ui/meteoDebug';
import { fetchAllSmallBodies } from './core/sbdb';
import { CELESTIAL_CONFIG } from './config/bodies';
import { flattenBodies } from './config/catalog';

// Traduit les chaînes statiques du HTML avant tout et synchronise <html lang> ; les modules
// dynamiques (loader, bodyInfo…) se retraduisent ensuite via leurs propres abonnements.
initStaticI18n();
setupLangSwitch();
setupFullscreen();
const overlayCoordinator = setupOverlayCoordinator();
setupHelp(overlayCoordinator);
const guidedTour = setupGuidedTour();
const CONTEXTUAL_SURFACE_ANCHORS: Partial<
  Record<SecondaryOverlayId, { trigger: string; panel: string }>
> = {
  'body-info': { trigger: '#info-trigger', panel: '#body-info' },
  'orbit-options': { trigger: '#settings-trigger', panel: '#orbit-options' },
  'weather-layers': { trigger: '#weather-trigger', panel: '#weather-layers' },
  'small-body-filters': {
    trigger: '#smallbody-filters-trigger',
    panel: '#smallbody-filters',
  },
  events: { trigger: '#events-trigger', panel: '#astronomical-events' },
  help: { trigger: '#help-btn', panel: '#help-popover' },
  'quality-menu': { trigger: '#quality-btn', panel: '#quality-menu' },
};

function positionContextualSurface(id: SecondaryOverlayId): void {
  const anchor = CONTEXTUAL_SURFACE_ANCHORS[id];
  if (!anchor) return;

  const trigger = document.querySelector<HTMLElement>(anchor.trigger);
  const panel = document.querySelector<HTMLElement>(anchor.panel);
  if (!trigger || !panel) return;

  const triggerRect = trigger.getBoundingClientRect();
  const gap = 8;
  panel.style.setProperty(
    '--surface-anchor-top',
    `${Math.round(triggerRect.top)}px`
  );
  panel.style.setProperty(
    '--surface-anchor-right',
    `${Math.max(8, Math.round(window.innerWidth - triggerRect.left + gap))}px`
  );
}

// Fermeture au clic extérieur d'une surface contextuelle.
//   - Mobile : le scrim est une couche tactile plein écran (tap hors feuille = fermer).
//   - Desktop : le scrim est volontairement transparent aux évènements (il ne doit pas
//     bloquer la molette/rotation sur la scène) ; on capte donc le clic extérieur au niveau
//     du document, en ignorant les clics dans une surface ou sur un déclencheur du dock.
const surfaceScrim = document.getElementById('surface-scrim');
if (surfaceScrim) {
  let activeSurfaceId: SecondaryOverlayId | null = null;
  overlayCoordinator.onOpen((id) => {
    activeSurfaceId = id;
    if (id) positionContextualSurface(id);
    surfaceScrim.hidden = id === null;
  });
  window.addEventListener('resize', () => {
    if (activeSurfaceId) positionContextualSurface(activeSurfaceId);
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
    const {
      cameraSystem,
      animationSystem,
      sceneSystem,
      orbitalMechanics,
      horizonsEphemeris,
    } = api;
    setupSolarDebug(api);
    setupEarthDebug(api);
    setupContextRecovery(sceneSystem);

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
    const exploScaleBadge = setupExploScaleBadge();
    const planetNav = setupPlanetControls(
      cameraSystem,
      (name) => {
        if (name === 'overview') bodyInfo.hide();
        else bodyInfo.show(name);
        exploScaleBadge.setHasTarget(name !== 'overview');
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
    setupOrbitOptions(sceneSystem, exploHud, overlayCoordinator);

    // Champ de masse des petits corps (SBDB) — couche instrument 2D, chargée en tâche de
    // fond. Dégradation propre : si le fetch échoue (offline), l'overlay reste vide.
    const smallBodyOverlay = new SmallBodyOverlay();
    smallBodyOverlay.mount();
    void fetchAllSmallBodies().then((bodies) =>
      smallBodyOverlay.setBodies(bodies)
    );
    const smallBodyFilters = setupSmallBodyFilters(
      smallBodyOverlay,
      overlayCoordinator
    );

    // Couche instrument 2D des sondes spatiales — positions réelles Horizons (mêmes binaires
    // que planètes/lunes), jamais avant leur lancement (getHeliocentricAU renvoie null hors
    // couverture, cf. spacecraftOverlay.ts).
    const spacecraftOverlay = new SpacecraftOverlay(SPACECRAFT_MISSIONS);
    spacecraftOverlay.mount();

    // Le bloc live de la fiche (distance réelle + temps-lumière) n'a de sens qu'en Explo,
    // pour la cible suivie ; en Éducatif ou en vue libre on passe `null` → bloc masqué.
    let currentMode: 'educ' | 'explo' = 'educ';
    animationSystem.onFrame(() => {
      exploHud.update(cameraSystem.camera, cameraSystem, sceneSystem);
      smallBodyOverlay.update(
        cameraSystem.camera,
        orbitalMechanics.simulationDate
      );
      spacecraftOverlay.update(
        cameraSystem.camera,
        orbitalMechanics.simulationDate,
        horizonsEphemeris
      );
      bodyInfo.updateLive(
        currentMode === 'explo'
          ? cameraSystem.getDistanceToTargetSceneUnits()
          : null
      );
    });
    const opticalZoom = setupOpticalZoom(cameraSystem);
    const webxr = setupWebXR(
      cameraSystem,
      sceneSystem,
      animationSystem,
      planetNav,
      bodyNames
    );
    const exploTourNudge = setupExploTourNudge();
    const modeSwitcher = setupModeSwitcher(
      orbitalMechanics,
      cameraSystem,
      (mode) => {
        currentMode = mode;
        opticalZoom.setMode(mode);
        exploHud.setMode(mode); // change le style des labels (éduc ↔ explo), reste actif
        smallBodyOverlay.setActive(mode === 'explo');
        smallBodyFilters.setTriggerVisible(mode === 'explo');
        spacecraftOverlay.setActive(mode === 'explo');
        webxr.setMode(mode);
        exploScaleBadge.setMode(mode);
        if (mode === 'explo') exploTourNudge.notifyExploEntered();
        syncPermalink();
      }
    );

    const permalink = setupPermalinks(
      orbitalMechanics,
      planetNav,
      modeSwitcher,
      bodyNames,
      cameraSystem
    );
    syncPermalink = permalink.sync;
    permalink.applyInitialState();
    setupShare(cameraSystem, permalink);
    setupCapture(cameraSystem, orbitalMechanics, planetNav);
    setupAstronomicalEvents(orbitalMechanics, {
      onDateChange: () => syncPermalink(),
      coordinator: overlayCoordinator,
      navigation: planetNav,
      playback,
    });
    setupTourPlayer(
      cameraSystem,
      orbitalMechanics,
      planetNav,
      TOUR_SCRIPTS,
      permalink
    );
    hideLoader();
    guidedTour.startIfFirstVisit();
  } catch (err) {
    showError(err instanceof Error ? err : new Error(String(err)));
  }
})();
