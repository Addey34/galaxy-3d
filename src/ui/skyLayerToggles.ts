/**
 * Bascules des COUCHES DU CIEL : figures des constellations et repères des systèmes d'exoplanètes.
 * Surface Réglages, section « scène ».
 *
 * Contenu de la scène, donc ÉTEINT par défaut et JAMAIS mémorisé (règle du dépôt : le rendu et la
 * lecture persistent, le contenu de la scène jamais). Chaque case reste désactivée tant que son
 * fichier n'est pas chargé : les fichiers sont facultatifs, un échec laisse le ciel intact.
 */
import type { PerspectiveCamera } from 'three';
import type { Starfield } from '@/components/celestial/Starfield';
import type { SkyCenteringHost } from '@/components/systems/SkyCenteringView';
import type { MessageKey } from '@/i18n/locales';
import { onLocaleChange, t } from '@/i18n';
import type { ConstellationNames } from './constellationNames';
import type { DeepSkyLayer } from './deepSkyLayer';
import type { DeepSkyCard } from './deepSkyCard';
import type { NeighbourLayer } from './neighbourLayer';
import type { NeighbourCard } from './neighbourCard';
import type { StellarHost, StellarView } from './stellarView';
import type { MeteorLayer } from './meteorLayer';
import type { ExoplanetCard } from './exoplanetCard';
import type { OverlayCoordinator } from './overlayCoordinator';

export interface SkyLayer {
  id: string;
  labelKey: MessageKey;
  ready: () => boolean;
  set: (on: boolean) => void;
}

/** Attente de l'arrivée d'un fichier : un court rappel, arrêté dès qu'il est là ou après 30 s. */
const POLL_MS = 500;
const GIVE_UP_MS = 30_000;

export function mount(layer: SkyLayer): void {
  const wrapper = document.createElement('label');
  wrapper.id = `${layer.id}-wrapper`;
  wrapper.className = 'settings-switch';

  const checkbox = document.createElement('input');
  checkbox.id = layer.id;
  checkbox.type = 'checkbox';
  checkbox.className = 'oo-checkbox settings-checkbox';
  checkbox.checked = false;
  checkbox.disabled = !layer.ready();

  const text = document.createElement('span');
  text.className = 'settings-switch-label';

  wrapper.append(checkbox, text);
  const host =
    document.getElementById('settings-section-scene') ?? document.body;
  host.append(wrapper);

  const refresh = (): void => {
    text.textContent = t(layer.labelKey);
    checkbox.setAttribute('aria-label', t(layer.labelKey));
  };
  refresh();

  checkbox.addEventListener('change', () => layer.set(checkbox.checked));
  onLocaleChange(refresh);

  if (checkbox.disabled) {
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (layer.ready()) {
        checkbox.disabled = false;
        window.clearInterval(timer);
      } else if (Date.now() - started > GIVE_UP_MS) window.clearInterval(timer);
    }, POLL_MS);
  }
}

/** Ce dont la fiche d'un système a besoin : la caméra pour viser, le canvas pour cliquer, le coordinateur. */
export interface SkyLayerEnvironment {
  camera: PerspectiveCamera;
  canvas: HTMLElement;
  coordinator: OverlayCoordinator;
  /** Date de la scène : les pluies de météores ne sont actives qu'à certaines dates. */
  simulationDate: () => Date;
  /** La caméra, que la fiche d'un objet du ciel passe au centrage de l'écran (`SkyCenteringView`). */
  centering?: SkyCenteringHost;
  /** Le renderer et la boucle de l'application : la vue du voisinage solaire n'en crée pas d'autre. */
  stellar?: Pick<StellarHost, 'animation' | 'renderer' | 'gaze'>;
}

/** Ce que l'application garde du câblage : rouvrir la vue que l'adresse demande. */
export interface StellarAddressOpener {
  openFromAddress(): void;
  /** Ouvre la vue du voisinage solaire, comme son bouton (GAL-OBSERVATION-001). */
  openNeighbourhood(): void;
}

export function setupSkyLayerToggles(
  starfield: Starfield | null,
  environment: SkyLayerEnvironment
): StellarAddressOpener {
  const noOpener: StellarAddressOpener = {
    openFromAddress: () => undefined,
    openNeighbourhood: () => undefined,
  };
  if (!starfield) return noOpener;
  // La fiche n'existe pas au démarrage : elle se charge à la première activation de la couche.
  let card: Promise<ExoplanetCard> | null = null;
  let wanted = false;
  let names: Promise<ConstellationNames | null> | null = null;
  let deep: Promise<DeepSkyLayer | null> | null = null;
  let deepCard: Promise<DeepSkyCard | null> | null = null;
  let neighbours: Promise<NeighbourLayer | null> | null = null;
  let neighbourCard: Promise<NeighbourCard | null> | null = null;
  // La vue 3D du voisinage solaire : chargée au premier appel, jamais au démarrage.
  let stellar: Promise<StellarView | null> | null = null;
  const openStellar = (
    focus?: string,
    fromAddress = false,
    visit = false
  ): void => {
    const host = environment.stellar;
    if (!host) return;
    void (stellar ??= import('./stellarView').then((m) =>
      m.setupStellarView({
        ...host,
        coordinator: environment.coordinator,
        simulationDate: environment.simulationDate,
      })
    )).then((view) => {
      if (view) view.open(focus, fromAddress, visit);
      else {
        stellar = null;
        // Une adresse qui demandait la vue : on dit pourquoi elle ne s'ouvre pas et on la retire.
        if (fromAddress)
          void import('./stellarView').then((m) => m.abandonStellarAddress());
      }
    });
  };
  // L'exploration d'un système choisi dans le CIEL (GAL-UNIVERSE-007) : l'enveloppe se charge au premier
  // « Explorer ce système » ou pour une adresse `view=system`, jamais au démarrage.
  let systemView: Promise<import('./systemView').SystemView> | null = null;
  const openSystem = (host: string, fromAddress = false): void => {
    const stellarHost = environment.stellar;
    if (!stellarHost) return;
    void (systemView ??= import('./systemView').then((m) =>
      m.setupSystemView({
        animation: stellarHost.animation,
        renderer: stellarHost.renderer,
        coordinator: environment.coordinator,
        skyArchive: () => {
          const hosts = starfield.exoplanetHosts;
          return hosts
            ? { systems: hosts.systems, retrieved: hosts.retrieved }
            : null;
        },
        // Le retour rend l'observation d'origine : la fiche du même système, recentrée, si la couche est allumée.
        onReturn: (name) => {
          if (!wanted) return;
          void card?.then((c) => {
            const system = starfield.exoplanetHosts?.systems.find(
              (s) => s[0] === name
            );
            if (system) c.open(system);
          });
        },
      })
    ))
      .then((view) => view.open(host, fromAddress))
      .catch(() => {
        systemView = null;
      });
  };
  let meteors: Promise<MeteorLayer | null> | null = null;
  mount({
    id: 'constellations-toggle',
    labelKey: 'settings.constellations',
    ready: () => starfield.hasConstellations,
    set: (on) => {
      starfield.setConstellationsVisible(on);
      // Les noms se chargent à la première activation des figures, pas au démarrage.
      void (names ??= import('./constellationNames').then((m) =>
        m.setupConstellationNames({ starfield, ...environment })
      )).then((n) => n?.setActive(on));
    },
  });
  mount({
    id: 'exoplanets-toggle',
    labelKey: 'settings.exoplanets',
    ready: () => starfield.hasExoplanets,
    set: (on) => {
      starfield.setExoplanetsVisible(on);
      wanted = on;
      if (on && !card) {
        card = import('./exoplanetCard').then((m) =>
          m.setupExoplanetCard({
            starfield,
            ...environment,
            onExplore: environment.stellar
              ? (system) => openSystem(system[0])
              : undefined,
          })
        );
      }
      void card?.then((c) => c.setActive(wanted));
    },
  });
  mount({
    id: 'deepsky-toggle',
    labelKey: 'settings.deepsky',
    ready: () => true,
    set: (on) => {
      // Fichier et repères n'existent pas au démarrage : ils se chargent à la première activation.
      if (on || deep)
        void (deep ??= import('./deepSkyLayer').then((m) =>
          m.setupDeepSkyLayer({ starfield, ...environment })
        )).then((l) => {
          l?.setActive(on);
          // La fiche d'un objet se charge avec la couche, à sa première activation.
          if (l && on && !deepCard)
            deepCard = import('./deepSkyCard').then((m) =>
              m.setupDeepSkyCard({
                markers: l.markers,
                file: l.file,
                ...environment,
              })
            );
          void deepCard?.then((c) => c?.setActive(on));
        });
    },
  });
  mount({
    id: 'neighbours-toggle',
    labelKey: 'settings.neighbours',
    ready: () => true,
    set: (on) => {
      // Fichier et repères n'existent pas au démarrage : ils se chargent à la première activation.
      if (on || neighbours)
        void (neighbours ??= import('./neighbourLayer').then((m) =>
          m.setupNeighbourLayer({ starfield, ...environment })
        )).then((l) => {
          l?.setActive(on);
          // La fiche d'une étoile se charge avec la couche, à sa première activation.
          if (l && on && !neighbourCard)
            neighbourCard = import('./neighbourCard').then((m) =>
              m.setupNeighbourCard({
                markers: l.markers,
                file: l.file,
                ...environment,
                openStellar: environment.stellar ? openStellar : undefined,
              })
            );
          void neighbourCard?.then((c) => c?.setActive(on));
        });
    },
  });
  // Le bouton du voisinage solaire en 3D : indépendant de la couche (un bouton, pas une case).
  if (environment.stellar) {
    const button = document.createElement('button');
    button.id = 'stellar-open';
    button.type = 'button';
    button.className = 'settings-button';
    const host =
      document.getElementById('settings-section-scene') ?? document.body;
    host.append(button);
    // La visite guidée du voisinage (GAL-UNIVERSE-005) : la même vue, ouverte sur son premier arrêt.
    const visitButton = document.createElement('button');
    visitButton.id = 'stellar-visit-open';
    visitButton.type = 'button';
    visitButton.className = 'settings-button';
    host.append(visitButton);
    const refresh = (): void => {
      button.textContent = t('settings.stellar');
      visitButton.textContent = t('settings.stellarVisit');
    };
    refresh();
    onLocaleChange(refresh);
    button.addEventListener('click', () => openStellar());
    visitButton.addEventListener('click', () =>
      openStellar(undefined, false, true)
    );
  }
  // Les pluies de météores : la case dit combien de pluies sont actives à la date de la scène.
  // (Il y en a toujours au moins une, gardé par `core/meteors.test.ts` : pas d'état « aucune ».)
  let meteorTimer = 0;
  let meteorStatus: HTMLElement | null = null;
  let meteorLayer: MeteorLayer | null = null;
  let meteorOn = false;
  const showMeteorStatus = (layer: MeteorLayer | null, on: boolean): void => {
    meteorLayer = layer;
    meteorOn = on;
    if (!meteorStatus) return;
    const count = layer?.activeCount() ?? 0;
    const text =
      on && count > 0
        ? t('settings.meteors.active', { count: String(count) })
        : '';
    if (meteorStatus.textContent !== text) meteorStatus.textContent = text;
    meteorStatus.hidden = text === '';
  };
  mount({
    id: 'meteors-toggle',
    labelKey: 'settings.meteors',
    ready: () => true,
    set: (on) => {
      window.clearInterval(meteorTimer);
      if (on || meteors)
        void (meteors ??= import('./meteorLayer').then((m) =>
          m.setupMeteorLayer({ starfield, ...environment })
        )).then((l) => {
          if (!l) {
            // Le fichier est illisible : la case se décoche au lieu de promettre une couche.
            meteors = null;
            const box = document.getElementById(
              'meteors-toggle'
            ) as HTMLInputElement | null;
            if (box) box.checked = false;
            return;
          }
          l.setActive(on);
          showMeteorStatus(l, on);
          if (on && l)
            meteorTimer = window.setInterval(
              () => showMeteorStatus(l, true),
              1000
            );
        });
      else showMeteorStatus(null, false);
    },
  });
  meteorStatus = document.createElement('p');
  meteorStatus.id = 'meteors-status';
  meteorStatus.className = 'settings-hint';
  meteorStatus.hidden = true;
  document.getElementById('meteors-toggle-wrapper')?.after(meteorStatus);
  onLocaleChange(() => showMeteorStatus(meteorLayer, meteorOn));
  return {
    openNeighbourhood: () => openStellar(),
    // L'adresse décrit une observation du voisinage (`?view=neighbourhood`, GAL-UNIVERSE-004) : la
    // vue s'ouvre, le morceau ne se charge que pour elle. Une seule clé est lue ici ; le reste du
    // contrat (étoile, temps) est dans `core/stellarPermalink`, dans le morceau de la vue.
    openFromAddress: () => {
      if (!environment.stellar) return;
      const params = new URLSearchParams(window.location.search);
      const view = params.get('view');
      if (view === 'neighbourhood') openStellar(undefined, true);
      // Un système choisi dans le ciel (`view=system&host=`, GAL-UNIVERSE-007).
      else if (view === 'system') openSystem(params.get('host') ?? '', true);
    },
  };
}
