/**
 * Tours guidés scénarisés — séquences caméra + temps + narration (« Naissance d'une éclipse »,
 * « La danse des Galiléennes », « Voyage aux confins »). Distinct du tour d'accueil
 * (`ui/guidedTour.ts`, tooltips DOM statiques sans caméra ni temps) : ce module pilote de
 * vraies étapes async via `core/tourEngine.ts`.
 *
 * Auto-attaché dans `#help-popover` comme `guidedTour.ts`, mais relançable en permanence
 * (pas de gate première-visite) et jamais un remplacement de la palette de sélection : tout vol
 * caméra passe par `PlanetNavigation.selectBody`, jamais par `CameraSystem` en direct, pour que
 * fiche d'info et permalien restent cohérents.
 */
import { TOUR_CLEARANCE_CHANGED } from './tourClearance';
import './tourPlayer.css';
import type { ModeSwitcher } from './modeSwitcher';
import { onLocaleChange, t, getLocale } from '@/i18n';
import { bodyDisplayName } from '@/i18n/bodyText';
import type { CameraSystem } from '@/components/systems/CameraSystem';
import type { OrbitalMechanics } from '@/core/OrbitalMechanics';
import type { PlanetNavigation } from './planetNav';
import type { LocalizedText } from '@/types';
import {
  runTour,
  type TourRuntimeHost,
  type TourScript,
  type TourSignal,
  type TourStep,
} from '@/core/tourEngine';
import { resolveEventDate } from '@/config/tourScripts';
import { trapFocus } from './surfaceFocus';
import type { SurfaceChoiceId } from './surfaceChoices';
import type { SurfacePanelHandle } from './surfacePanel';
import type { setupPlaceDive } from './placeDive';
import type { OverlayCoordinator } from './overlayCoordinator';

export interface TourPlayer {
  /** Lance une visite par son identifiant ; `false` si aucune ne le porte (`?tour=`, lot 58). */
  start(id: string): boolean;
  dispose(): void;
}

/** Permalien : seules les méthodes réellement utilisées ici, pour un couplage minimal. */
export interface TourPlayerPermalink {
  setSuspended(suspended: boolean): void;
  sync(): void;
}

function localizedText(text: LocalizedText): string {
  return text[getLocale()] ?? text.en;
}

export function setupTourPlayer(
  camera: CameraSystem,
  om: OrbitalMechanics,
  navigation: PlanetNavigation,
  scripts: TourScript[],
  permalink: TourPlayerPermalink,
  /**
   * Le sélecteur de mode, et NON `OrbitalMechanics` directement : lui seul met à jour les
   * boutons, `aria-pressed`, la classe du `<body>`, la caméra et le HUD « Voyage ». Une visite
   * qui appellerait `om.setMode` laisserait tout cela dire le contraire de la scène.
   */
  modeSwitcher: ModeSwitcher,
  /**
   * Le fond d'imagerie et la plongée sur un nom : les deux réglages qu'une visite emprunte pour
   * montrer un même lieu à deux dates (`diveTo`, `setSurface`). Le panneau de surface reste leur
   * propriétaire, la visite ne touche à aucun de ses éléments.
   */
  surface: Pick<SurfacePanelHandle, 'base' | 'setBase'>,
  placeDive: ReturnType<typeof setupPlaceDive>,
  /**
   * Plonger sur un lieu, c'est le REGARDER : la fiche du corps, ouverte par le vol, couvrait le
   * centre d'un écran de téléphone et cachait l'imagerie que la visite montre (mesuré à 390 px).
   */
  overlays: Pick<OverlayCoordinator, 'closeAll'>
): TourPlayer {
  const helpPopover = document.getElementById('help-popover');
  if (!helpPopover) return { start: () => false, dispose: () => {} };

  const startButton = document.createElement('button');
  startButton.type = 'button';
  startButton.className = 'stour-start';
  helpPopover.append(startButton);

  const picker = document.createElement('div');
  picker.className = 'stour-picker';
  picker.hidden = true;
  const pickerButtons = scripts.map((script) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'stour-picker-item';
    picker.append(btn);
    return { script, btn };
  });
  helpPopover.append(picker);

  const backdrop = document.createElement('div');
  backdrop.className = 'stour-backdrop';
  backdrop.hidden = true;
  backdrop.setAttribute('aria-hidden', 'true');

  const card = document.createElement('section');
  card.className = 'stour-card';
  card.hidden = true;
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-live', 'polite');
  // Sans nom, la carte était annoncée « dialogue » et rien de plus (défaut D7 du lot 19).
  // Elle n'a pas de titre fixe à désigner — sa légende change à chaque étape — donc un libellé
  // propre plutôt qu'un `aria-labelledby` sur un texte mouvant.
  card.setAttribute('aria-label', t('a11y.tourPlayer'));

  const progress = document.createElement('p');
  progress.className = 'stour-progress';
  const caption = document.createElement('p');
  caption.className = 'stour-caption';
  const actions = document.createElement('div');
  actions.className = 'stour-actions';
  const pauseButton = document.createElement('button');
  pauseButton.type = 'button';
  pauseButton.className = 'stour-pause';
  const nextButton = document.createElement('button');
  nextButton.type = 'button';
  nextButton.className = 'stour-next';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'stour-close';
  actions.append(pauseButton, nextButton, closeButton);

  /**
   * LE SOMMAIRE DE LA VISITE, pour qui ne voit pas la carte.
   *
   * La carte annonçait « Étape 3 sur 8 » : une POSITION, sans rien dire de ce que la visite
   * contient ni d'où elle va. Un visiteur voyant a la scène sous les yeux pour le deviner ;
   * un lecteur d'écran n'a que ce dialogue. Le sommaire liste les légendes — les temps du
   * RÉCIT, et non les `flyTo` ou les `wait`, qui sont de la mécanique — et il est rattaché au
   * dialogue par `aria-describedby`, donc énoncé à l'ouverture, après son nom, et une seule
   * fois. Visuellement absent : la carte est déjà étroite et l'information est redondante avec
   * la scène.
   */
  const outline = document.createElement('p');
  outline.className = 'sr-only';
  outline.id = 'stour-outline';
  card.setAttribute('aria-describedby', outline.id);

  card.append(outline, progress, caption, actions);
  document.body.append(backdrop, card);

  let active = false;
  let signal: TourSignal = { cancelled: false, paused: false };
  let speedChanged = false;
  /**
   * Le mode dans lequel l'utilisateur était AVANT la visite, ou `null` si elle n'y a pas
   * touché. Symétrique de `speedChanged` : une visite emprunte l'application, elle ne la
   * reconfigure pas. Et on restaure le mode de DÉPART, jamais « éduc » en dur — l'utilisateur
   * pouvait déjà être en Explo, et le ramener de force serait un autre réglage volé.
   */
  let modeBeforeTour: 'educ' | 'explo' | null = null;
  /** Le fond d'imagerie d'AVANT la visite, rendu à la fin : même raison que le mode. */
  let baseBeforeTour: SurfaceChoiceId | null = null;
  let advanceResolve: (() => void) | null = null;
  let currentScript: TourScript | null = null;

  const waitForAdvance = (): Promise<void> =>
    new Promise((resolve) => {
      advanceResolve = resolve;
    });
  const triggerAdvance = (): void => {
    advanceResolve?.();
    advanceResolve = null;
  };

  /** Les légendes de la visite, dans l'ordre : ce sont elles qui la racontent. */
  const renderOutline = (): void => {
    if (!currentScript) {
      outline.textContent = '';
      return;
    }
    const beats = currentScript.steps
      .filter((step) => step.kind === 'caption')
      .map((step) => localizedText(step.text));
    outline.textContent = beats.length
      ? t('tours.outline', {
          title: localizedText(currentScript.title),
          count: beats.length,
          beats: beats.join(' · '),
        })
      : '';
  };

  const localize = (): void => {
    // Le nom du dialogue suit la langue comme le reste : posé une fois à la création, il
    // serait resté dans la langue du démarrage.
    card.setAttribute('aria-label', t('a11y.tourPlayer'));
    startButton.textContent = t('tours.start');
    startButton.setAttribute('aria-label', t('tours.start'));
    pauseButton.textContent = t(signal.paused ? 'tours.resume' : 'tours.pause');
    nextButton.textContent = t('tours.next');
    closeButton.textContent = t('tours.close');
    for (const { script, btn } of pickerButtons) {
      btn.textContent = localizedText(script.title);
    }
    renderOutline();
    if (active && currentScript && currentStep) render(stepIndex, currentStep);
  };

  let stepIndex = 0;
  let currentStep: TourStep | null = null;
  let lastCaptionText = '';

  const render = (index: number, step: TourStep): void => {
    if (!currentScript) return;
    progress.textContent = t('tours.progress', {
      current: index + 1,
      total: currentScript.steps.length,
    });
    switch (step.kind) {
      case 'caption':
        lastCaptionText = localizedText(step.text);
        caption.textContent = lastCaptionText;
        nextButton.disabled = step.durationMs != null;
        break;
      case 'flyTo':
        caption.textContent = t('tours.status.flyingTo', {
          body: bodyDisplayName(step.body),
        });
        nextButton.disabled = true;
        break;
      case 'jumpToDate':
      case 'jumpToEvent':
        caption.textContent = t('tours.status.jumping');
        nextButton.disabled = true;
        break;
      case 'setTimeScale':
        caption.textContent = t('tours.status.speeding');
        nextButton.disabled = true;
        break;
      case 'diveTo':
      case 'setSurface':
      case 'wait':
        caption.textContent = lastCaptionText;
        nextButton.disabled = true;
        break;
    }
  };

  /** Libère le piège à focus du dialogue modal ; `null` quand la carte est fermée. */
  let releaseTrap: (() => void) | null = null;

  /**
   * Ce que la carte occupe, publié pour les autres bandeaux (2026-10-20). Le bandeau de provenance
   * de l'imagerie est posé en bas à droite et la carte, au-dessus de lui dans la pile, en cachait
   * les lignes de crédit à 390 px : l'attribution exigée par la licence disparaissait pendant la
   * visite. Il se place désormais AU-DESSUS de la carte (`styles.css`, `[data-tour]`).
   */
  const root = document.documentElement;
  const publishClearance = (): void => {
    root.style.setProperty(
      '--stour-clear',
      `${Math.max(0, window.innerHeight - card.getBoundingClientRect().top)}px`
    );
    window.dispatchEvent(new Event(TOUR_CLEARANCE_CHANGED));
  };
  const clearanceObserver =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(publishClearance);
  const releaseClearance = (): void => {
    clearanceObserver?.disconnect();
    window.removeEventListener('resize', publishClearance);
    root.style.removeProperty('--stour-clear');
    delete root.dataset['tour'];
    window.dispatchEvent(new Event(TOUR_CLEARANCE_CHANGED));
  };

  const showOverlay = (): void => {
    backdrop.hidden = false;
    card.hidden = false;
    root.dataset['tour'] = 'on';
    publishClearance();
    clearanceObserver?.observe(card);
    window.addEventListener('resize', publishClearance);
    pauseButton.focus();
    // `aria-modal="true"` déclare le reste de la page inerte : il faut le tenir (défaut D9).
    releaseTrap?.();
    releaseTrap = trapFocus(card);
  };
  const hideOverlay = (): void => {
    releaseTrap?.();
    releaseTrap = null;
    backdrop.hidden = true;
    card.hidden = true;
    releaseClearance();
    startButton.focus();
  };
  const closePicker = (): void => {
    picker.hidden = true;
  };

  const finish = (): void => {
    active = false;
    hideOverlay();
    if (speedChanged) om.setSimulationSpeed(1);
    if (modeBeforeTour !== null) modeSwitcher.setMode(modeBeforeTour);
    if (baseBeforeTour !== null) surface.setBase(baseBeforeTour);
    navigation.selectBody('overview');
    permalink.setSuspended(false);
    permalink.sync();
  };

  const start = (id: string): boolean => {
    const script = scripts.find((s) => s.id === id);
    if (!script) return false;
    closePicker();

    currentScript = script;
    signal = { cancelled: false, paused: false };
    speedChanged = false;
    modeBeforeTour = null;
    baseBeforeTour = null;
    active = true;
    stepIndex = 0;
    currentStep = null;
    lastCaptionText = '';
    permalink.setSuspended(true);
    // Le sommaire AVANT l'ouverture : `aria-describedby` est lu quand le dialogue prend le
    // focus, et un élément encore vide à cet instant n'est jamais rattrapé.
    localize();
    showOverlay();

    const host: TourRuntimeHost = {
      flyTo: (body) => navigation.selectBody(body),
      isFlying: () => camera.isFlying,
      viewFrom: (body) => camera.viewFromBody(body),
      viewBeside: (body) => camera.viewBesideBody(body),
      jumpToDate: (date) => om.jumpToDate(date),
      // La date est résolue ICI, au moment où l'étape s'exécute, depuis la date courante de la
      // scène : c'est ce qui remplace l'exception `id === 'eclipse'` que ce module portait.
      // `null` (aucune occurrence dans la fenêtre) ne saute pas plutôt que de sauter à côté.
      jumpToEvent: (event, body) => {
        const date = resolveEventDate(event, om.simulationDate, body);
        if (date) om.jumpToDate(date);
      },
      setTimeScale: (scale) => {
        speedChanged = true;
        om.setSimulationSpeed(scale);
      },
      setMode: (mode) => {
        modeBeforeTour ??= modeSwitcher.getMode();
        modeSwitcher.setMode(mode);
      },
      // Le morph glisse de 0 (Éduc) à 1 (Explo) ; l'attente se fait sur ce FAIT, jamais sur une
      // durée recopiée de `MORPH_DURATION_S`, qui deviendrait fausse le jour où elle change.
      isMorphing: () =>
        Math.abs(om.scaleMorph - (modeSwitcher.getMode() === 'explo' ? 1 : 0)) >
        0.001,
      diveTo: (place, frameKm) => {
        overlays.closeAll();
        const body = camera.targetName;
        return body
          ? placeDive.diveToName(body, place, frameKm)
          : Promise.resolve(false);
      },
      isDiving: () => placeDive.isDiving(),
      diveReached: () => placeDive.reached(),
      isSurfaceBusy: () =>
        (camera.renderer.domElement.dataset['surfaceBusy'] ?? '0') !== '0',
      setSurface: (base) => {
        baseBeforeTour ??= surface.base();
        return surface.setBase(base as SurfaceChoiceId);
      },
      waitForAdvance,
    };

    void runTour(
      currentScript,
      host,
      (index, step) => {
        stepIndex = index;
        currentStep = step;
        render(index, step);
      },
      signal
    ).then(finish);
    return true;
  };

  const close = (): void => {
    if (!active) return;
    signal.cancelled = true;
    triggerAdvance();
  };

  startButton.addEventListener('click', () => {
    picker.hidden = !picker.hidden;
  });
  for (const { script, btn } of pickerButtons) {
    btn.addEventListener('click', () => void start(script.id));
  }
  pauseButton.addEventListener('click', () => {
    if (!active) return;
    signal.paused = !signal.paused;
    pauseButton.textContent = t(signal.paused ? 'tours.resume' : 'tours.pause');
  });
  nextButton.addEventListener('click', () => triggerAdvance());
  closeButton.addEventListener('click', close);
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', (event) => {
    if (!active) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === ' ') {
      event.preventDefault();
      pauseButton.click();
    } else if (event.key === 'ArrowRight' && !nextButton.disabled) {
      triggerAdvance();
    }
  });
  onLocaleChange(localize);
  localize();

  return {
    start,
    dispose: () => {
      close();
      releaseClearance();
      startButton.remove();
      picker.remove();
      backdrop.remove();
      card.remove();
    },
  };
}
