/**
 * ANCRES DES OBJETS D'INSTRUMENT — ce qui rend une sonde et un objet interstellaire CIBLABLES.
 *
 * Une sonde n'a pas de mesh, et n'en aura pas : à vraie échelle elle est sous-pixel, et
 * l'invariant Explo interdit toute taille apparente plancher. La caméra, elle, a besoin d'un
 * `Object3D` à suivre. Une ancre EST cet objet et rien d'autre : un `THREE.Group` vide, sans
 * géométrie ni matériau, qui ne dessine aucun pixel. Ce n'est pas une sphère mandataire
 * déguisée — rien ne la rend visible, et le marqueur affiché reste celui que la couche 2D
 * peint (`spacecraftOverlay`, `interstellarOverlay`).
 *
 * L'ancre est placée par `scaleToScene`, exactement la fonction dont les deux couches se
 * servent pour projeter leur marqueur : la caméra regarde donc précisément le point où le
 * marqueur est peint, dans les deux modes et pendant toute la transition Éduc↔Explo.
 *
 * DISPONIBILITÉ. Un corps du catalogue existe à toute date ; une sonde, non. Hors de la
 * couverture de son fichier Horizons (avant le lancement, au-delà de la solution de
 * trajectoire) la source ne répond pas, et un objet interstellaire n'est dessiné que dans sa
 * fenêtre autour du périhélie. Ici, la disponibilité est donc MESURÉE — la source a répondu ou
 * non — jamais déduite d'une date écrite à côté. Indisponible, l'ancre ne bouge plus et
 * l'interface le dit, plutôt que de laisser la caméra suivre une position périmée.
 */
import * as THREE from 'three';
import { eclipticToScene } from '@/core/frames';
import { keplerianPositionEcliptic } from '@/core/kepler';
import { scaleToScene } from '@/core/overlayScale';
import type { HorizonsEphemerisService } from '@/core/HorizonsEphemerisService';
import type { CameraTarget } from '@/components/systems/CameraSystem';
import { SPACECRAFT_MISSIONS } from '@/config/spacecraft';
import {
  INTERSTELLAR_OBJECTS,
  interstellarWindow,
} from '@/config/interstellar';
import { MARKER_FRAMING_RADIUS, NAVIGABLE_TARGETS } from '@/config/navigable';

/** D'où vient la position d'un objet d'instrument, en UA dans le repère de la scène. */
type PositionSource = (date: Date) => THREE.Vector3 | null;

interface Anchor {
  name: string;
  group: THREE.Group;
  positionAU: PositionSource;
  available: boolean;
  target: CameraTarget;
}

export interface NavigableAnchors {
  /** Cibles caméra, indexées par nom — à remettre à `CameraSystem.registerTargets`. */
  readonly targets: Record<string, CameraTarget>;
  /** Replace chaque ancre pour cette date et cet état de morph. À appeler par frame. */
  update(date: Date, morph: number): void;
  /** Vrai si la source a répondu pour cet objet au dernier `update`. */
  isAvailable(name: string): boolean;
  /** Notifié quand l'ensemble des objets disponibles change (et une fois au premier calcul). */
  onAvailabilityChange(
    listener: (available: ReadonlySet<string>) => void
  ): void;
  dispose(): void;
}

/**
 * Construit les ancres et les ajoute à la scène. `horizons` sert aux sondes ; les objets
 * interstellaires se propagent depuis leurs éléments hyperboliques, sans fichier.
 */
export function createNavigableAnchors(
  scene: THREE.Scene,
  horizons: HorizonsEphemerisService
): NavigableAnchors {
  const anchors: Anchor[] = [];
  const targets: Record<string, CameraTarget> = {};
  const listeners: ((available: ReadonlySet<string>) => void)[] = [];
  let lastAvailableKey = '\u0000';

  const add = (name: string, positionAU: PositionSource): void => {
    const cfg = NAVIGABLE_TARGETS.get(name);
    if (!cfg) return;
    const group = new THREE.Group();
    group.name = name;
    // Le rayon de CADRAGE, lu par la caméra pour borner son zoom. Il ne décrit aucune taille
    // réelle et n'affiche rien (cf. `config/navigable.ts`).
    group.userData['radius'] = MARKER_FRAMING_RADIUS;
    scene.add(group);
    const anchor: Anchor = {
      name,
      group,
      positionAU,
      available: false,
      target: { group, cameraDistance: cfg.cameraDistance },
    };
    anchors.push(anchor);
    targets[name] = anchor.target;
  };

  for (const mission of SPACECRAFT_MISSIONS)
    add(mission.name, (date) => horizons.getHeliocentricAU(mission.name, date));

  for (const object of INTERSTELLAR_OBJECTS) {
    const { from, to } = interstellarWindow(object);
    const fromMs = from.getTime();
    const toMs = to.getTime();
    add(object.name, (date) => {
      const ms = date.getTime();
      if (ms < fromMs || ms > toMs) return null;
      const p = keplerianPositionEcliptic(object.elements, date);
      return eclipticToScene(p.x, p.y, p.z);
    });
  }

  const scratch = new THREE.Vector3();

  const update = (date: Date, morph: number): void => {
    let key = '';
    for (const anchor of anchors) {
      const posAU = anchor.positionAU(date);
      anchor.available = posAU !== null;
      if (posAU) {
        scaleToScene(scratch, posAU.x, posAU.y, posAU.z, morph);
        anchor.group.position.copy(scratch);
        key += anchor.name + ';';
      }
    }
    if (key !== lastAvailableKey) {
      lastAvailableKey = key;
      const available = new Set(
        anchors.filter((a) => a.available).map((a) => a.name)
      );
      for (const listener of listeners) listener(available);
    }
  };

  return {
    targets,
    update,
    isAvailable: (name) =>
      anchors.find((a) => a.name === name)?.available ?? false,
    onAvailabilityChange: (listener) => {
      listeners.push(listener);
      listener(new Set(anchors.filter((a) => a.available).map((a) => a.name)));
    },
    dispose: () => {
      for (const anchor of anchors) scene.remove(anchor.group);
      anchors.length = 0;
      listeners.length = 0;
    },
  };
}
