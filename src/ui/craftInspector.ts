/**
 * L'INSPECTION 3D D'UN ENGIN : sélection, ouverture, rotation et zoom, informations et provenance,
 * retour exactement à la scène précédente (GAL-OBJECT-IMMERSION-001). Chargée à la demande (le bouton
 * « Inspecter en 3D » d'une fiche de sonde, ou celui de l'ISS), jamais au démarrage.
 *
 * Une seule boucle, un seul renderer : comme la vue du voisinage solaire, l'inspection pose un rendu de
 * remplacement dans `AnimationSystem` (`setRenderOverride`), qui fige la simulation et dessine
 * `CraftScene` à la place. La scène astronomique n'est PAS touchée : ni sa caméra, ni sa date, ni son
 * état ne bougent, et `close()` rend le renderer, le focus et les éléments rendus inertes tels qu'ils
 * étaient. Les distances et les dimensions de la scène astronomique restent vraies ; l'engin n'est
 * agrandi QUE dans l'inspection, et elle le dit.
 *
 * Les contrôles sont attachés à une SURFACE posée au-dessus du canevas (les écouteurs de la scène
 * solaire ne reçoivent rien). Mouvement réduit : pas d'amortissement. Clavier complet : flèches, + et -,
 * Origine, Échap. Les pièces nommées du fichier sont des boutons (même accès que le toucher).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CraftScene } from '@/components/craft/CraftScene';
import {
  craftModelById,
  type CraftModel,
  type CraftPart,
} from '@/config/craftModels';
import { turn, zoom, type Pose } from '@/core/craftFit';
import { loadDeferredMessages } from '@/i18n/deferredMessages';
import { getLocale, onLocaleChange, t } from '@/i18n';
import { prefersReducedMotion } from '@/utils/reducedMotion';
import type { LocalizedText } from '@/types';
import Logger from '@/utils/Logger';
import { getAnnouncer } from './announcer';
import { claimHistory } from './permalink';
import type { OverlayCoordinator } from './overlayCoordinator';
import {
  maskElements,
  restoreElements,
  type MaskedElement,
} from './stellarMask';
import './craftView.css';

const MARKER = 'data-craft-hidden';
/** Le fond de l'inspection : posé sur le renderer (la scène solaire possède `scene.background`), rendu à la fermeture. */
const BACKDROP = 0x05070d;
const KEY_TURN_RAD = (8 * Math.PI) / 180;
const KEY_ZOOM = 1.15;
const MIN_DISTANCE = 0.35;
const MAX_FACTOR = 3;

/** Ce que l'inspection demande à l'application : le renderer et la boucle (un seul de chaque). */
export interface CraftHost {
  animation: {
    setRenderOverride(render: ((delta: number) => void) | null): void;
  };
  renderer: THREE.WebGLRenderer;
  coordinator: OverlayCoordinator;
}

export interface CraftInspector {
  /** Ouvre l'inspection du modèle `id` ; `opener` reçoit le focus à la fermeture. */
  open(id: string, opener?: HTMLElement | null): void;
  close(): void;
  readonly isOpen: boolean;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  id?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (id) node.id = id;
  return node;
}

const localized = (text: LocalizedText): string => text[getLocale()] ?? text.en;

interface Session {
  scene: CraftScene;
  controls: OrbitControls;
  root: HTMLElement;
  cleanups: Array<() => void>;
  inert: MaskedElement[];
  opener: HTMLElement | null;
  close(viaHistory?: boolean): void;
}

export async function setupCraftInspector(
  host: CraftHost
): Promise<CraftInspector> {
  // Les phrases de l'inspection sont hors démarrage : `t()` rendrait les clés brutes sans elles.
  await loadDeferredMessages();

  let opened: Session | null = null;
  /** Vrai quand CETTE ouverture a ajouté son entrée d'historique : fermer la retire par « Retour ». */
  let pushed = false;
  /** Le prochain Retour du navigateur est celui que `close()` vient de demander : il n'y a rien d'autre à faire. */
  let ownBack = false;

  claimHistory((): boolean => {
    if (ownBack) {
      ownBack = false;
      return true;
    }
    if (!opened) return false;
    opened.close(true);
    return true;
  });

  function open(id: string, openerHint?: HTMLElement | null): void {
    if (opened) return;
    const model = craftModelById(id);
    if (!model) return;
    if (host.renderer.xr.isPresenting) return;
    if (host.renderer.getContext().isContextLost()) {
      getAnnouncer().announce(t('craft.unavailable'));
      return;
    }
    // Le déclencheur se lit AVANT de fermer les surfaces : `closeAll` déplace le focus.
    const active =
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
        ? document.activeElement
        : null;
    const opener: HTMLElement | null =
      openerHint ??
      (active?.closest('.surface--info')
        ? document.getElementById('info-trigger')
        : active?.closest('#orbit-options')
          ? document.getElementById('settings-trigger')
          : active);
    host.coordinator.closeAll();
    const reduced = prefersReducedMotion();
    const cleanups: Array<() => void> = [];
    const canvas = host.renderer.domElement;
    const scene = new CraftScene(
      window.innerWidth / Math.max(1, window.innerHeight)
    );

    // ---- le DOM de l'inspection
    const root = el('section', 'craft-view', 'craft-view');
    root.setAttribute('aria-labelledby', 'craft-title');
    const head = el('div', 'cv-head');
    const top = el('header', 'cv-top');
    const title = el('h2', 'cv-title', 'craft-title');
    const reset = el('button', 'cv-button', 'craft-reset');
    reset.type = 'button';
    const close = el('button', 'cv-button cv-close', 'craft-close');
    close.type = 'button';
    top.append(title, reset, close);
    const scale = el('p', 'cv-note cv-scale', 'craft-scale');
    const status = el('p', 'cv-note cv-status', 'craft-status');
    status.setAttribute('role', 'status');
    head.append(top, scale, status);
    const surface = el('div', 'cv-surface', 'craft-surface');
    surface.tabIndex = 0;
    surface.setAttribute('role', 'group');
    surface.setAttribute('aria-describedby', 'craft-help');
    const help = el('p', 'cv-help', 'craft-help');
    const side = el('aside', 'cv-side');
    const partsTitle = el('h3', 'cv-heading');
    const parts = el('ul', 'cv-list', 'craft-parts');
    const partsNote = el('p', 'cv-note');
    const instrumentsTitle = el('h3', 'cv-heading');
    instrumentsTitle.hidden = true;
    const instruments = el('ul', 'cv-list', 'craft-instruments');
    const instrumentsNote = el('p', 'cv-note');
    instrumentsNote.hidden = true;
    const provenanceTitle = el('h3', 'cv-heading');
    const facts = el('ul', 'cv-facts', 'craft-provenance');
    const fidelity = el('p', 'cv-note');
    const rights = el('p', 'cv-note');
    side.append(
      partsTitle,
      parts,
      partsNote,
      instrumentsTitle,
      instruments,
      instrumentsNote,
      provenanceTitle,
      facts,
      fidelity,
      rights
    );
    root.append(surface, head, help, side);
    document.body.append(root);

    // ---- les éléments de la scène solaire : rendus inertes et invisibles, rétablis à la fermeture
    const toMask: Element[] = [];
    for (const child of Array.from(document.body.children)) {
      if (
        child === root ||
        child === canvas ||
        /^(SCRIPT|STYLE|LINK|NOSCRIPT)$/.test(child.tagName) ||
        child.hasAttribute('aria-live') ||
        child.classList.contains('sr-only') ||
        child.hasAttribute(MARKER) ||
        child.hasAttribute('data-stellar-hidden')
      )
        continue;
      toMask.push(child);
    }
    const inert = maskElements(toMask, MARKER);
    document.body.classList.add('craft-view-active');

    // ---- les contrôles, sur la surface (jamais sur le canevas solaire)
    const controls = new OrbitControls(scene.camera, surface);
    controls.enablePan = false;
    controls.enableDamping = !reduced;
    controls.target.set(0, 0, 0);
    controls.minDistance = MIN_DISTANCE;
    controls.maxDistance = scene.homeDistance() * MAX_FACTOR;
    const placeCamera = (distance: number): void => {
      scene.camera.position
        .set(0.55, 0.32, 1)
        .normalize()
        .multiplyScalar(distance);
      scene.camera.lookAt(0, 0, 0);
      controls.update();
    };
    placeCamera(scene.homeDistance());

    const readPose = (): Pose => {
      const p = scene.camera.position;
      const distance = p.length();
      return {
        azimuth: Math.atan2(p.x, p.z),
        polar: Math.acos(Math.min(1, Math.max(-1, p.y / distance))),
        distance,
      };
    };
    const writePose = (pose: Pose): void => {
      const s = Math.sin(pose.polar);
      scene.camera.position.set(
        pose.distance * s * Math.sin(pose.azimuth),
        pose.distance * Math.cos(pose.polar),
        pose.distance * s * Math.cos(pose.azimuth)
      );
      scene.camera.lookAt(0, 0, 0);
      controls.update();
    };
    const home = (): void => {
      controls.maxDistance = scene.homeDistance() * MAX_FACTOR;
      placeCamera(scene.homeDistance());
    };
    reset.addEventListener('click', home);

    const onKey = (event: KeyboardEvent): void => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const pose = readPose();
      const max = scene.homeDistance() * MAX_FACTOR;
      let next: Pose;
      switch (event.key) {
        case 'ArrowLeft':
          next = turn(pose, -KEY_TURN_RAD, 0);
          break;
        case 'ArrowRight':
          next = turn(pose, KEY_TURN_RAD, 0);
          break;
        case 'ArrowUp':
          next = turn(pose, 0, -KEY_TURN_RAD);
          break;
        case 'ArrowDown':
          next = turn(pose, 0, KEY_TURN_RAD);
          break;
        case '+':
        case '=':
          next = zoom(pose, 1 / KEY_ZOOM, MIN_DISTANCE, max);
          break;
        case '-':
        case '_':
          next = zoom(pose, KEY_ZOOM, MIN_DISTANCE, max);
          break;
        case 'Home':
          home();
          event.preventDefault();
          return;
        default:
          return;
      }
      event.preventDefault();
      writePose(next);
    };
    surface.addEventListener('keydown', onKey);
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') session.close();
    };
    document.addEventListener('keydown', onEscape);
    cleanups.push(() => document.removeEventListener('keydown', onEscape));
    close.addEventListener('click', () => session.close());

    const onResize = (): void => {
      scene.setAspect(window.innerWidth / Math.max(1, window.innerHeight));
      controls.maxDistance = scene.homeDistance() * MAX_FACTOR;
    };
    window.addEventListener('resize', onResize);
    cleanups.push(() => window.removeEventListener('resize', onResize));

    // ---- les pièces nommées du fichier
    let litPart: CraftPart | null = null;
    const partButtons = new Map<CraftPart, HTMLButtonElement>();
    const setPart = (part: CraftPart | null): void => {
      litPart = litPart === part ? null : part;
      scene.highlight(litPart ? litPart.nodes : null);
      for (const [p, button] of partButtons)
        button.setAttribute('aria-pressed', String(p === litPart));
      getAnnouncer().announce(
        litPart
          ? t('craft.partOn', { part: localized(litPart.label) })
          : t('craft.partOff')
      );
    };

    // ---- les textes, relus à chaque changement de langue
    let instrumentNames: string[] = [];
    const render = (): void => {
      const name = localized(model.name);
      title.textContent = t('craft.title', { name });
      reset.textContent = t('craft.reset');
      close.textContent = t('craft.close');
      scale.textContent = t('craft.scale');
      help.textContent = t('craft.help');
      partsTitle.textContent = t('craft.parts');
      partsNote.textContent = t('craft.partsNone');
      partsNote.hidden = model.parts.length > 0;
      parts.replaceChildren();
      partButtons.clear();
      for (const part of model.parts) {
        const li = el('li');
        const button = el('button', 'cv-part');
        button.type = 'button';
        button.textContent = localized(part.label);
        button.setAttribute('aria-pressed', String(part === litPart));
        button.addEventListener('click', () => setPart(part));
        partButtons.set(part, button);
        li.append(button);
        parts.append(li);
      }
      instrumentsTitle.textContent = t('craft.instruments');
      instrumentsNote.textContent = t('craft.instrumentsNote');
      instruments.replaceChildren(
        ...instrumentNames.map((n) => {
          const li = el('li');
          li.textContent = n;
          return li;
        })
      );
      provenanceTitle.textContent = t('craft.provenance');
      renderFacts(facts, model);
      fidelity.textContent = t('craft.fidelity');
      rights.textContent = t('craft.rights');
    };
    render();
    cleanups.push(onLocaleChange(render));

    // ---- l'historique : « Retour » du navigateur ferme l'inspection au lieu de quitter la page
    window.history.pushState(window.history.state, '', window.location.href);
    pushed = true;

    let restoreClear = (): void => undefined;
    const session: Session = {
      scene,
      controls,
      root,
      cleanups,
      inert,
      opener,
      close(viaHistory = false) {
        if (opened !== session) return;
        opened = null;
        // D'abord rendre la boucle à la scène solaire : plus rien ne dessine la scène d'inspection.
        host.animation.setRenderOverride(null);
        restoreClear();
        for (const cleanup of cleanups) cleanup();
        controls.dispose();
        scene.dispose();
        root.remove();
        document.body.classList.remove('craft-view-active');
        restoreElements(inert, MARKER);
        getAnnouncer().announce(t('craft.closed'));
        // Le focus revient où il était ; à défaut, au canevas de la scène solaire.
        (opener && document.contains(opener) ? opener : canvas).focus?.();
        if (viaHistory) pushed = false;
        else if (pushed) {
          pushed = false;
          ownBack = true;
          window.history.back();
        }
      },
    };
    opened = session;

    // L'état et la pose sont publiés sur la racine : c'est ce que lisent les tests, et ce qu'un lecteur
    // d'écran n'a pas à entendre (`data-*` seulement).
    root.dataset['craftModel'] = model.id;
    root.dataset['craftState'] = 'loading';
    let lastPose = '';
    const previousClear = host.renderer.getClearColor(new THREE.Color());
    const previousAlpha = host.renderer.getClearAlpha();
    host.renderer.setClearColor(BACKDROP, 1);
    restoreClear = (): void =>
      host.renderer.setClearColor(previousClear, previousAlpha);
    host.animation.setRenderOverride(() => {
      controls.update();
      host.renderer.render(scene.scene, scene.camera);
      const pose = readPose();
      const r = (x: number): number => Math.round(x * 1000) / 1000;
      const text = `${r(pose.azimuth)},${r(pose.polar)},${r(pose.distance)}`;
      if (text !== lastPose) {
        lastPose = text;
        root.dataset['craftPose'] = text;
      }
    });
    getAnnouncer().announce(t('craft.opened', { name: localized(model.name) }));
    surface.focus();

    // ---- le modèle : chargé après l'ouverture, qui montre déjà son cadre
    status.textContent = t('craft.loading');
    void scene
      .load(model.url, host.renderer)
      .then(() => {
        if (opened !== session) return;
        status.hidden = true;
        root.dataset['craftState'] = 'ready';
        home();
        const lit = scene.triangleCount();
        if (Math.round(lit) !== model.triangles)
          Logger.warn(
            `[craftInspector] ${model.id} : ${lit} triangles lus, ${model.triangles} déclarés`
          );
      })
      .catch((error: unknown) => {
        Logger.warn(`[craftInspector] ${model.id} illisible`, error);
        if (opened !== session) return;
        root.dataset['craftState'] = 'failed';
        status.textContent = t('craft.failed');
        getAnnouncer().announce(t('craft.failed'));
      });

    // Les instruments DÉCLARÉS par l'archive PDS, quand la sonde en a une (jamais déduits du modèle).
    const target = model.targets[0];
    if (target && target !== 'iss')
      void import('@/config/instruments')
        .then(async (m) => {
          const archive = await m.loadSpacecraftArchive(target);
          if (!archive || archive === 'absent' || opened !== session) return;
          instrumentNames = archive.instruments.map((i) => i.name);
          instrumentsTitle.hidden = instrumentNames.length === 0;
          instrumentsNote.hidden = instrumentNames.length === 0;
          render();
        })
        .catch((error: unknown) =>
          Logger.warn('[craftInspector] instruments illisibles', error)
        );
  }

  return {
    open,
    close: () => opened?.close(),
    get isOpen(): boolean {
      return opened !== null;
    },
  };
}

/** La provenance du fichier : crédit, source exacte, empreinte, taille. Tout vient du registre. */
function renderFacts(list: HTMLElement, model: CraftModel): void {
  list.replaceChildren();
  const row = (value: Node | string): void => {
    const li = el('li');
    li.append(value);
    list.append(li);
  };
  row(t('craft.credit', { credit: `NASA, ${model.repository}` }));
  const link = el('a', 'cv-link');
  link.href = model.sourceUrl;
  link.rel = 'noopener noreferrer';
  link.target = '_blank';
  link.textContent = t('craft.source');
  row(link);
  row(
    t('craft.file', {
      kb: String(Math.round(model.bytes / 1024)),
      tris: new Intl.NumberFormat(getLocale()).format(model.triangles),
      hash: model.sha256.slice(0, 12),
    })
  );
}
