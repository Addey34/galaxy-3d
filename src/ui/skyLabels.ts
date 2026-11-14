/**
 * NOMS ÉCRITS SUR LE CIEL : le noyau commun des couches 2D de noms (constellations, ciel profond).
 *
 * Une couche d'instrument, jamais un mesh : chaque nom est un élément DOM posé à l'endroit où la
 * caméra voit sa direction, sans aucune échelle de scène. Les entrées donnent leur direction (vecteur
 * unitaire, repère du ciel) ; un nom hors champ, derrière la caméra ou en collision avec un nom de
 * priorité supérieure est masqué. Piloté par sa propre boucle d'images, inerte quand éteint.
 */
import * as THREE from 'three';
import './skyLabels.css';

export interface SkyLabelItem {
  readonly text: string;
  /** Plus grand = placé d'abord, donc garde sa place à l'évitement. */
  readonly priority: number;
  /** Écrit la direction (unitaire) dans `out` ; faux si elle n'est pas définie. */
  direction(out: [number, number, number]): boolean;
}

export interface SkyLabelLayerOptions {
  /** Objet du ciel qui porte la sphère céleste (sa matrice monde place les directions). */
  sky: THREE.Object3D;
  /** Rayon de la sphère céleste, lu à chaque image (une seule vérité : celle des étoiles posées). */
  radius(): number;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLElement;
  /** Classe CSS du conteneur ; chaque nom porte `${className}-item`. */
  className: string;
  /** Décalage vertical du nom sous sa direction, en pixels (0 : centré ; un repère visible en demande un). */
  offsetY?: number;
}

export interface SkyLabelLayer {
  setActive(on: boolean): void;
}

const LABEL_HEIGHT = 14;
const GAP = 6;

interface Entry {
  readonly item: SkyLabelItem;
  readonly el: HTMLElement;
  x: number;
  y: number;
}

export function createSkyLabelLayer(
  items: readonly SkyLabelItem[],
  options: SkyLabelLayerOptions
): SkyLabelLayer {
  const host = document.createElement('div');
  host.className = options.className;
  host.setAttribute('aria-hidden', 'true');
  host.hidden = true;
  document.body.append(host);

  const entries: Entry[] = [...items]
    .sort((a, b) => b.priority - a.priority)
    .map((item) => {
      const el = document.createElement('span');
      el.className = `${options.className}-item`;
      el.textContent = item.text;
      el.style.display = 'none';
      host.append(el);
      return { item, el, x: NaN, y: NaN };
    });

  const dir: [number, number, number] = [0, 0, 0];
  const world = new THREE.Vector3();
  const view = new THREE.Vector3();
  const widths = new Map<Entry, number>();
  let active = false;
  let raf = 0;

  const frame = (): void => {
    const radius = options.radius();
    if (!(radius > 0)) return;
    const { width, height } = options.canvas.getBoundingClientRect();
    const offsetY = options.offsetY ?? 0;
    const placed: { x: number; y: number; w: number }[] = [];
    options.camera.updateMatrixWorld();
    for (const e of entries) {
      let visible = false;
      if (e.item.direction(dir)) {
        world
          .set(dir[0], dir[1], dir[2])
          .multiplyScalar(radius)
          .applyMatrix4(options.sky.matrixWorld);
        // Devant la caméra, et non « avant le plan lointain » : le ciel est à `radius` alors que le
        // `far` de la caméra est adaptatif et peut rester plus court, ce qui masquait tout nom
        // proche de l'axe de visée (celui de l'objet qu'on vient de centrer).
        const inFront =
          view.copy(world).applyMatrix4(options.camera.matrixWorldInverse).z <
          0;
        world.project(options.camera);
        const x = ((world.x + 1) / 2) * width;
        const y = ((1 - world.y) / 2) * height + offsetY;
        if (inFront && x > 0 && x < width && y > 0 && y < height) {
          let w = widths.get(e);
          if (w === undefined) {
            w = e.el.offsetWidth || e.item.text.length * 9;
            widths.set(e, w);
          }
          const clash = placed.some(
            (p) =>
              Math.abs(p.x - x) < (p.w + w) / 2 + GAP &&
              Math.abs(p.y - y) < LABEL_HEIGHT + GAP
          );
          if (!clash) {
            placed.push({ x, y, w });
            visible = true;
            if (x !== e.x || y !== e.y || e.el.style.display === 'none') {
              e.el.style.display = '';
              e.el.style.transform = `translate(${Math.round(x - w / 2)}px, ${Math.round(y - LABEL_HEIGHT / 2)}px)`;
              e.x = x;
              e.y = y;
            }
          }
        }
      }
      if (!visible && e.el.style.display !== 'none')
        e.el.style.display = 'none';
    }
  };

  return {
    setActive(on) {
      if (on === active) return;
      active = on;
      host.hidden = !on;
      cancelAnimationFrame(raf);
      if (on) {
        // Les largeurs se mesurent une fois la couche visible (un élément masqué mesure 0).
        widths.clear();
        const loop = (): void => {
          frame();
          raf = requestAnimationFrame(loop);
        };
        loop();
      }
    },
  };
}
