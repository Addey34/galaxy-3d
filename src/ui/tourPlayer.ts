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
import { onLocaleChange, t, getLocale, intlLocale } from '@/i18n';
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
import { resolveEventDate } from '@/config/tourEvents';
import tourCatalogue from 'virtual:tour-catalogue';
import { loadTourScript } from '@/registry/tours/lazy';
import { createIntentLoader } from '@/core/intentLoader';
import { announceLoadFailure } from './loadFailure';
import { trapFocus } from './surfaceFocus';
import type { SurfaceChoiceId } from './surfaceChoices';
import type { SurfacePanelHandle } from './surfacePanel';
import type { setupPlaceDive } from './placeDive';
import type { OverlayCoordinator } from './overlayCoordinator';
import type { PlaybackControls } from './playback';
import type { CraftOpener } from './craftAccess';
import type CelestialObject from '@/components/celestial/CelestialObject';
import { texturePath } from '@/config/catalog';
import { craftModelFor } from '@/config/craftModels';
import type { TextureQuality } from '@/types';
import type { BodySurfaceEditions } from '@/core/surfaceEditions';
import { formatIsoDay } from '@/core/dateText';
import Logger from '@/utils/Logger';

/**
 * Ce que les grandes expéditions empruntent (GAL-TOUR-EXCELLENCE-002) : l'inspection 3D d'un engin,
 * ouverte comme par le bouton de sa fiche, et le moteur des textures du corps, pour poser une
 * observation datée comme le ferait la fiche. Ni l'une ni l'autre n'est dupliquée ici.
 */
export interface TourExpeditionHost {
  openCraft: CraftOpener;
  scene: { getBody(name: string): CelestialObject | undefined };
}

export interface TourPlayer {
  /**
   * Lance une visite par son identifiant ; `false` si aucune ne le porte (`?tour=`, lot 58), si son
   * téléchargement échoue (dit au visiteur) ou si une autre intention l'a remplacée entre-temps.
   * La fiche est téléchargée à la demande (GAL-TOUR-SCALE-001) : la promesse se résout quand la
   * visite a démarré, jamais avant.
   */
  start(id: string): Promise<boolean>;
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

/** Même seuil que le repli de la fiche (`ui/bodyInfo`). */
const NARROW_QUERY = '(max-width: 640px)';

export function setupTourPlayer(
  camera: CameraSystem,
  om: OrbitalMechanics,
  navigation: PlanetNavigation,
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
  overlays: Pick<OverlayCoordinator, 'closeAll'>,
  /**
   * La vitesse, et NON `om.setSimulationSpeed` : `ui/playback` possède le curseur, le libellé,
   * l'ARIA et le plafond du lien. Une visite qui écrivait l'horloge en direct les laissait dire
   * une autre vitesse que celle qui s'appliquait, et remettait 1:1 en dur à la fin (GAL-PRODUCT-013).
   */
  speed: Pick<PlaybackControls, 'borrowSpeed' | 'releaseSpeed'>,
  expedition: TourExpeditionHost
): TourPlayer {
  const helpPopover = document.getElementById('help-popover');
  if (!helpPopover)
    return { start: () => Promise.resolve(false), dispose: () => {} };

  const startButton = document.createElement('button');
  startButton.type = 'button';
  startButton.className = 'stour-start';
  helpPopover.append(startButton);

  const picker = document.createElement('div');
  picker.className = 'stour-picker';
  picker.hidden = true;
  // Le sélecteur lit le catalogue LÉGER (identifiant, titre dans les quatre langues), dérivé des
  // fiches au build : aucune visite n'est téléchargée avant d'être choisie.
  const pickerButtons = tourCatalogue.map((entry) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'stour-picker-item';
    picker.append(btn);
    return { entry, btn };
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
  /**
   * L'observation datée demandée n'a pas pu être posée (GAL-TOUR-EXCELLENCE-002) : la carte de la visite le
   * DIT à côté de la légende qui suit, qui décrit l'observation demandée et non celle qui reste affichée.
   */
  const notice = document.createElement('p');
  notice.className = 'stour-notice';
  notice.hidden = true;
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

  card.append(outline, progress, notice, caption, actions);
  document.body.append(backdrop, card);

  let active = false;
  let signal: TourSignal = { cancelled: false, paused: false };
  /**
   * Le mode dans lequel l'utilisateur était AVANT la visite, ou `null` si elle n'y a pas
   * touché. Symétrique de la vitesse (`speed`) : une visite emprunte l'application, elle ne la
   * reconfigure pas. Et on restaure le mode de DÉPART, jamais « éduc » en dur — l'utilisateur
   * pouvait déjà être en Explo, et le ramener de force serait un autre réglage volé.
   */
  let modeBeforeTour: 'educ' | 'explo' | null = null;
  /** Le fond d'imagerie d'AVANT la visite, rendu à la fin : même raison que le mode. */
  let baseBeforeTour: SurfaceChoiceId | null = null;
  let advanceResolve: (() => void) | null = null;
  let currentScript: TourScript | null = null;
  /**
   * Vrai pendant une inspection 3D ouverte par la visite. La carte de la visite porte `aria-live` :
   * l'inspection ne la masque pas (elle épargne les régions vivantes), donc la visite la retire
   * elle-même, et lui laisse le clavier (Échap ferme l'INSPECTION, les flèches la font tourner).
   */
  let inspecting = false;
  /** Les éditions de surface posées par la visite, rendues à leur défaut à la fin. */
  const editionBodies = new Set<string>();
  /** Les corps dont une édition demandée est encore EN VOL : la fin de visite la rend caduque. */
  const editionsInFlight = new Set<string>();
  /** L'échec d'une observation datée, dit dans la carte ; `null` quand rien n'est à signaler. */
  let editionFailure: { date: string; shown: string } | 'generic' | null = null;
  let editionCatalogue: Record<string, BodySurfaceEditions> | null = null;

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
    for (const { entry, btn } of pickerButtons) {
      btn.textContent = localizedText(entry.title);
    }
    renderOutline();
    if (active && currentScript && currentStep) render(stepIndex, currentStep);
  };

  let stepIndex = 0;
  let currentStep: TourStep | null = null;
  let lastCaptionText = '';

  const editionDay = (iso: string): string =>
    formatIsoDay(iso.slice(0, 10), getLocale(), intlLocale());
  const renderNotice = (): void => {
    notice.hidden = editionFailure === null;
    notice.textContent =
      editionFailure === null
        ? ''
        : editionFailure === 'generic'
          ? t('tours.edition.unavailableGeneric')
          : t('tours.edition.unavailable', {
              date: editionDay(editionFailure.date),
              shown: editionDay(editionFailure.shown),
            });
  };

  const render = (index: number, step: TourStep): void => {
    if (!currentScript) return;
    renderNotice();
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
      case 'setMode':
      case 'diveTo':
      case 'setSurface':
      case 'setEdition':
      case 'inspectCraft':
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
  // Le sélecteur disparaît par le bouton, la croix, Échap ou une autre surface (`help.ts` masque
  // alors le popover entier) : on observe le FAIT « plus visible » plutôt que chaque chemin.
  const pickerWatch =
    typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(() => {
          if (picker.hidden || helpPopover.hidden) abandonPickerRequest();
        });
  pickerWatch?.observe(picker, {
    attributes: true,
    attributeFilter: ['hidden'],
  });
  pickerWatch?.observe(helpPopover, {
    attributes: true,
    attributeFilter: ['hidden'],
  });

  /**
   * Rend l'édition par défaut de chaque corps dont la visite a changé la surface. Le bloc des éditions
   * de la fiche le fait déjà quand la fiche quitte ce corps (mesuré au bureau et à 390 px : retirer cet
   * appel ne change pas l'état final) ; celui-ci couvre une édition posée sur un corps que la fiche
   * n'a jamais montré, ce que le schéma permet.
   */
  const restoreEditions = (): void => {
    for (const body of editionBodies) {
      const cat = editionCatalogue?.[body];
      const object = expedition.scene.getBody(body);
      if (!cat || !object) continue;
      // Une demande encore EN VOL arriverait visite fermée : la demande du défaut, plus récente, la rend
      // caduque (le moteur ne pose que la dernière, `CelestialObject.setLayerEdition`).
      if (
        !editionsInFlight.has(body) &&
        object.appliedTextureBase(cat.layer)?.split('__')[1] ===
          cat.defaultEdition
      )
        continue;
      const e = cat.editions.find((x) => x.edition === cat.defaultEdition);
      if (!e) continue;
      void object.setLayerEdition(
        cat.layer,
        texturePath(body, cat.layer, cat.defaultEdition),
        e.tiers as TextureQuality[]
      );
    }
    editionBodies.clear();
    editionsInFlight.clear();
    editionFailure = null;
    renderNotice();
  };

  const finish = (): void => {
    active = false;
    inspecting = false;
    hideOverlay();
    restoreEditions();
    // La vitesse que le visiteur avait DEMANDÉE avant la visite, signe compris, plafond du lien
    // compris. Sans effet quand la visite n'a pas emprunté la vitesse : elle ne la touche pas.
    speed.releaseSpeed();
    if (modeBeforeTour !== null) modeSwitcher.setMode(modeBeforeTour);
    if (baseBeforeTour !== null) surface.setBase(baseBeforeTour);
    navigation.selectBody('overview');
    permalink.setSuspended(false);
    permalink.sync();
  };

  /**
   * Le téléchargement d'une fiche, avec la règle « le dernier geste gagne » (`core/intentLoader`) :
   * une résolution tardive ne démarre jamais une visite que le visiteur a remplacée ou que la
   * fermeture de l'interface a annulée. Un refus n'est pas mis en cache : le clic suivant réessaie.
   */
  const loader = createIntentLoader(loadTourScript);
  const setLoading = (loading: boolean): void => {
    picker.setAttribute('aria-busy', String(loading));
    for (const { btn } of pickerButtons) btn.disabled = loading;
  };

  /**
   * La demande en vol vient-elle du SÉLECTEUR ? Seule celle-là se retire quand le visiteur ferme
   * le sélecteur : un lien direct (`?tour=`) n'a jamais été demandé par un clic dans l'aide, la
   * fermeture du popover ne doit pas l'annuler.
   */
  let pendingFromPicker = false;

  const request = async (id: string, fromPicker: boolean): Promise<boolean> => {
    // Une visite en cours possède l'écran (carte modale) : un second clic n'a rien à démarrer.
    if (active) return false;
    pendingFromPicker = fromPicker;
    setLoading(true);
    const result = await loader.request(id);
    // Remplacée ou annulée : la demande qui a la main (ou l'annulation) règle l'état du sélecteur.
    if (result.status === 'stale') return false;
    pendingFromPicker = false;
    setLoading(false);
    if (result.status === 'failed') {
      announceLoadFailure('tour-content');
      return false;
    }
    if (result.status === 'unknown') return false;
    begin(result.value);
    return true;
  };
  const start = (id: string): Promise<boolean> => request(id, false);

  /** Le visiteur a fermé le sélecteur : sa demande en vol ne démarrera rien, la réouverture est libre. */
  const abandonPickerRequest = (): void => {
    if (!pendingFromPicker) return;
    pendingFromPicker = false;
    loader.cancel();
    setLoading(false);
  };

  const begin = (script: TourScript): void => {
    closePicker();

    currentScript = script;
    signal = { cancelled: false, paused: false };
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
      flyTo: (body) => {
        // Le signalement d'une observation manquante vaut pour la légende qui la suivait, pas pour la suite.
        editionFailure = null;
        navigation.selectBody(body);
        // Sur téléphone la fiche que la sélection ouvre réduit la scène à une bande sous la carte
        // de visite (mesuré le 2026-11-19, 390 px : fiche y 52 à 224). La visite l'a ouverte
        // elle-même : la replier rend l'état d'avant ; le corps reste sélectionné et le
        // bouton ⓘ la rouvre. Hors téléphone, la fiche reste (la place ne manque pas).
        if (window.matchMedia(NARROW_QUERY).matches) overlays.closeAll();
      },
      isFlying: () => camera.isFlying,
      viewFrom: (body) => camera.viewFromBody(body),
      viewBeside: (body) => camera.viewBesideBody(body),
      viewDistance: (body, radii) => camera.viewAtRadii(body, radii),
      jumpToDate: (date) => om.jumpToDate(date),
      // La date est résolue ICI, au moment où l'étape s'exécute, depuis la date courante de la
      // scène : c'est ce qui remplace l'exception `id === 'eclipse'` que ce module portait.
      // `null` (aucune occurrence dans la fenêtre) ne saute pas plutôt que de sauter à côté.
      jumpToEvent: (event, body) => {
        const date = resolveEventDate(event, om.simulationDate, body);
        if (date) om.jumpToDate(date);
      },
      setTimeScale: (scale) => speed.borrowSpeed(scale),
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
      isDatePending: () => om.pendingJumpDate !== null,
      isSurfaceBusy: () =>
        (camera.renderer.domElement.dataset['surfaceBusy'] ?? '0') !== '0',
      setSurface: (base) => {
        baseBeforeTour ??= surface.base();
        return surface.setBase(base as SurfaceChoiceId);
      },
      waitForAdvance,
      inspectCraft: async (craft) => {
        // La carte se retire : l'inspection est une autre vue, plein écran, qui a son propre Échap.
        // La fiche nomme la SONDE ; l'inspection ouvre un MODÈLE (un modèle peut servir deux sondes).
        const model = craftModelFor(craft);
        if (!model) return false;
        releaseTrap?.();
        releaseTrap = null;
        backdrop.hidden = true;
        card.hidden = true;
        inspecting = true;
        const opened = await expedition
          .openCraft(model.id, null)
          .catch(() => false);
        if (!opened) returnFromInspection();
        return opened;
      },
      isInspecting: () => {
        const open = craftViewOpen();
        if (!open && inspecting) returnFromInspection();
        return open;
      },
      setEdition: async (body, edition) => {
        // La visite qui demande : une réponse tardive n'agit jamais sur une visite fermée ou remplacée.
        const run = signal;
        let catalogue: Record<string, BodySurfaceEditions> | null;
        try {
          catalogue = editionCatalogue ??= (
            await import('virtual:surface-edition-catalogue')
          ).default;
        } catch (error: unknown) {
          // Le morceau du catalogue n'est pas arrivé : la visite continue et le dit.
          Logger.warn('[tourPlayer] catalogue des éditions illisible', error);
          catalogue = null;
        }
        if (run.cancelled) return false;
        const cat = catalogue?.[body];
        const wanted = cat?.editions.find((e) => e.edition === edition);
        const object = expedition.scene.getBody(body);
        if (!cat || !wanted || !object) {
          editionFailure = 'generic';
          renderNotice();
          return false;
        }
        editionBodies.add(body);
        editionsInFlight.add(body);
        let ok = false;
        try {
          ok = await object.setLayerEdition(
            cat.layer,
            texturePath(body, cat.layer, edition),
            wanted.tiers as TextureQuality[]
          );
        } catch (error: unknown) {
          Logger.warn('[tourPlayer] édition non posée', error);
        }
        editionsInFlight.delete(body);
        if (run.cancelled) return false;
        if (ok) editionFailure = null;
        else {
          // La carte qui RESTE affichée, lue sur le moteur comme le fait la fiche.
          const shownEdition =
            object.appliedTextureBase(cat.layer)?.split('__')[1] ??
            cat.defaultEdition;
          const shown =
            cat.editions.find((e) => e.edition === shownEdition) ??
            cat.editions.find((e) => e.edition === cat.defaultEdition);
          editionFailure = shown
            ? { date: wanted.from, shown: shown.from }
            : 'generic';
        }
        renderNotice();
        return ok;
      },
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
    ).then(finish, (error: unknown) => {
      // Une étape qui lève ne doit jamais laisser la visite ouverte, ni le mode, la vitesse ou une édition
      // empruntés : la sortie est la même que la fin normale.
      Logger.warn('[tourPlayer] visite interrompue par une erreur', error);
      finish();
    });
  };

  /** La vue d'inspection est dans le document (`ui/craftInspector`, racine `#craft-view`). */
  const craftViewOpen = (): boolean =>
    document.getElementById('craft-view') !== null;
  /** L'inspection est refermée : la carte revient, avec son piège à focus, sur « Pause ». */
  const returnFromInspection = (): void => {
    inspecting = false;
    if (!active) return;
    showOverlay();
  };

  const close = (): void => {
    if (!active) return;
    signal.cancelled = true;
    triggerAdvance();
  };

  startButton.addEventListener('click', () => {
    picker.hidden = !picker.hidden;
  });
  for (const { entry, btn } of pickerButtons) {
    btn.addEventListener('click', () => void request(entry.id, true));
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
    // Pendant l'inspection, le clavier lui appartient (Échap la ferme, les flèches la font tourner).
    if (!active || inspecting) return;
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
      // Une fiche encore en vol ne démarrera rien une fois l'interface retirée.
      pickerWatch?.disconnect();
      loader.cancel();
      close();
      releaseClearance();
      startButton.remove();
      picker.remove();
      backdrop.remove();
      card.remove();
    },
  };
}
