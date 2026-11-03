/**
 * LES NOMS DES CONSTELLATIONS : une couche 2D (instrument), jamais un mesh.
 *
 * Le nom est celui de la source des figures (d3-celestial, forme latine de l'UAI), affiché tel
 * quel dans les quatre langues : une traduction serait une seconde donnée à sourcer. Il se pose
 * dans la direction moyenne des étoiles de la figure, recalculée à chaque image sur les positions
 * COURANTES du tampon : le nom suit la figure quand la date change.
 *
 * Chargé à la première activation des figures (hors démarrage), puis piloté par sa propre boucle d'images. Inerte
 * (aucune écriture DOM) tant que la couche est éteinte.
 */
import * as THREE from 'three';
import type { Starfield } from '@/components/celestial/Starfield';
import { CONSTELLATIONS_URL } from '@/components/celestial/Starfield';
import { constellationAnchor, distinctStars } from '@/core/constellationAnchor';
import type { ConstellationFile } from '@/core/constellations';
import Logger from '@/utils/Logger';

/** Styles posés avec la couche (un `.css` importé ajouterait ses chaînes de préchargement au démarrage). */
const STYLE = `.constellation-names { position: fixed; inset: 0; z-index: 3; overflow: hidden; pointer-events: none; } .constellation-name { position: absolute; left: 0; top: 0; white-space: nowrap; font-size: 0.72rem; letter-spacing: 0.12em; text-transform: uppercase; color: rgba(160, 190, 235, 0.78); text-shadow: 0 0 4px rgba(0, 0, 0, 0.9); will-change: transform; }`;

export interface ConstellationNames {
  setActive(on: boolean): void;
}

interface Entry {
  readonly name: string;
  readonly stars: readonly number[];
  readonly el: HTMLElement;
  /** Dernière position écrite, pour ne rien réécrire quand elle n'a pas bougé. */
  x: number;
  y: number;
}

export interface ConstellationNamesEnvironment {
  starfield: Starfield;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLElement;
}

export async function setupConstellationNames(
  env: ConstellationNamesEnvironment,
  fetchImpl: typeof fetch = fetch
): Promise<ConstellationNames | null> {
  let file: ConstellationFile;
  try {
    const res = await fetchImpl(CONSTELLATIONS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    file = (await res.json()) as ConstellationFile;
  } catch (err) {
    Logger.warn('[constellationNames] noms illisibles', err);
    return null;
  }

  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);
  const host = document.createElement('div');
  host.className = 'constellation-names';
  host.setAttribute('aria-hidden', 'true');
  host.hidden = true;
  document.body.append(host);

  // Les figures les plus riches d'abord : à l'évitement, ce sont elles qui gardent leur place.
  const entries: Entry[] = file.constellations
    .map((c) => {
      const el = document.createElement('span');
      el.className = 'constellation-name';
      el.textContent = c.name;
      el.style.display = 'none';
      host.append(el);
      return {
        name: c.name,
        stars: distinctStars(c.lines),
        el,
        x: NaN,
        y: NaN,
      };
    })
    .sort((a, b) => b.stars.length - a.stars.length);

  const anchor: [number, number, number] = [0, 0, 0];
  const world = new THREE.Vector3();
  const widths = new Map<Entry, number>();
  const LABEL_HEIGHT = 14;
  const GAP = 6;
  let active = false;
  let raf = 0;

  const frame = (): void => {
    const position = env.starfield.points.geometry.getAttribute('position');
    if (!position) return;
    // Rayon de la sphère céleste : celui des étoiles posées, lu dans le tampon (une seule vérité).
    const a = position.array;
    const radius = Math.hypot(a[0]!, a[1]!, a[2]!);
    if (!(radius > 0)) return;
    const { width, height } = env.canvas.getBoundingClientRect();
    const placed: { x: number; y: number; w: number }[] = [];
    env.camera.updateMatrixWorld();
    for (const e of entries) {
      let visible = false;
      if (constellationAnchor(position.array, e.stars, anchor)) {
        world
          .set(anchor[0], anchor[1], anchor[2])
          .multiplyScalar(radius)
          .applyMatrix4(env.starfield.points.matrixWorld);
        world.project(env.camera);
        const x = ((world.x + 1) / 2) * width;
        const y = ((1 - world.y) / 2) * height;
        if (world.z < 1 && x > 0 && x < width && y > 0 && y < height) {
          let w = widths.get(e);
          if (w === undefined) {
            w = e.el.offsetWidth || e.name.length * 9;
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
