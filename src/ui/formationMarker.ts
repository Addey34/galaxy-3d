/**
 * LE REPÈRE D'UNE FORMATION CHOISIE (GAL-PRODUCT-014) : après une recherche (ou une adresse
 * `?place=`), la caméra se tourne vers la formation mais garde sa distance. À ~9 rayons le
 * gazetteer n'écrit encore aucun nom (il se charge à 8 rayons ou moins), donc rien à l'écran ne
 * disait ce qui avait été choisi. Ce module pose UN élément DOM, un anneau et une légende, sur
 * le point de surface projeté.
 *
 * Sa feuille de style est EXTERNE (`formationMarker.css`) : la CSP de production est `style-src 'self'`,
 * un `<style>` injecté serait refusé. Seules des écritures CSSOM (`el.style.transform`) positionnent le repère.
 *
 * Une couche d'instrument, jamais un mesh : aucune échelle de scène, aucun zoom, aucune tuile.
 * Éphémère et sans coût au repos : la boucle d'images n'existe que tant que le repère est affiché
 * (elle reprojette un seul point), et tout est libéré à la disparition. Il disparaît :
 *  - après `LIFETIME_MS`,
 *  - au premier geste sur la caméra (OrbitControls émet `start`),
 *  - sur Échap,
 *  - dès que la cible de la caméra n'est plus celle qu'il visait (autre corps, vue globale),
 *  - quand un nouveau repère le remplace.
 */
import * as THREE from 'three';
import './formationMarker.css';
import { getAnnouncer } from './announcer';
import { t } from '@/i18n';
import { bodyDisplayName } from '@/i18n/bodyText';
import type { CameraSystem } from '@/components/systems/CameraSystem';

export const FORMATION_MARKER_ID = 'formation-marker';
/** Durée d'affichage : de quoi lire, pas de quoi s'installer. */
export const LIFETIME_MS = 12_000;

export interface FormationMarkerRequest {
  readonly camera: CameraSystem;
  readonly body: string;
  readonly place: string;
  /** Écrit dans `out` le point de surface en monde ; faux si le corps n'est plus là. */
  point(out: THREE.Vector3): boolean;
  /** Centre du corps rendu, en monde : sert à savoir si le point est sur la face visible. */
  centre(out: THREE.Vector3): boolean;
  /** La cible que la caméra suivait QUAND la formation a été choisie (identité, pas un nom). */
  readonly target: object | null;
}

let stop: (() => void) | null = null;

/** Retire le repère affiché, s'il y en a un : écouteurs, minuteur et boucle d'images compris. */
export function clearFormationMarker(): void {
  stop?.();
}

export function showFormationMarker(request: FormationMarkerRequest): void {
  clearFormationMarker();
  const { camera, body, place } = request;
  const canvas = camera.renderer.domElement;

  const name = bodyDisplayName(body);
  const host = document.createElement('div');
  host.id = FORMATION_MARKER_ID;
  const pin = document.createElement('div');
  pin.className = 'formation-marker-pin';
  const ring = document.createElement('span');
  ring.className = 'formation-marker-ring';
  const caption = document.createElement('div');
  caption.className = 'formation-marker-caption';
  const title = document.createElement('span');
  title.className = 'formation-marker-name';
  title.textContent = `${place} · ${name}`;
  const hint = document.createElement('span');
  hint.className = 'formation-marker-hint';
  hint.textContent = t('place.marker.hint');
  caption.append(title, hint);
  pin.append(ring, caption);
  host.append(pin);
  // Un repère visuel : le lecteur d'écran reçoit la phrase ci-dessous, une seule fois.
  host.setAttribute('aria-hidden', 'true');
  document.body.append(host);

  const world = new THREE.Vector3();
  const centre = new THREE.Vector3();
  const toCamera = new THREE.Vector3();
  const normal = new THREE.Vector3();
  let raf = 0;
  let timer = 0;

  const end = (): void => {
    cancelAnimationFrame(raf);
    window.clearTimeout(timer);
    camera.controls.removeEventListener('start', end);
    document.removeEventListener('keydown', onKey, true);
    host.remove();
    if (stop === end) stop = null;
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') end();
  };

  const frame = (): void => {
    if (camera.currentTarget !== request.target) {
      end();
      return;
    }
    if (!request.point(world) || !request.centre(centre)) {
      end();
      return;
    }
    const cam = camera.camera;
    cam.updateMatrixWorld();
    normal.copy(world).sub(centre).normalize();
    toCamera.copy(cam.position).sub(world).normalize();
    const { width, height } = canvas.getBoundingClientRect();
    const front = normal.dot(toCamera) > 0;
    world.project(cam);
    const x = ((world.x + 1) / 2) * width;
    const y = ((1 - world.y) / 2) * height;
    const visible =
      front && world.z < 1 && x > 0 && x < width && y > 0 && y < height;
    host.hidden = !visible;
    if (visible)
      pin.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    raf = requestAnimationFrame(frame);
  };

  stop = end;
  camera.controls.addEventListener('start', end);
  document.addEventListener('keydown', onKey, true);
  timer = window.setTimeout(end, LIFETIME_MS);
  frame();
  getAnnouncer().announce(
    t('place.marker.announce', { place, body: name }),
    'formation-marker'
  );
}
