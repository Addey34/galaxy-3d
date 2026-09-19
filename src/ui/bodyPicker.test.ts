import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { setupBodyPicker, type OverlayHitTest } from './bodyPicker';
import type { PlanetNavigation } from './planetNav';

const CANVAS_RECT = {
  left: 100,
  top: 50,
  right: 300,
  bottom: 150,
  width: 200,
  height: 100,
  x: 100,
  y: 50,
  toJSON: () => ({}),
};

function pointerEvent(
  type: string,
  {
    x,
    y,
    pointerId = 1,
    button = 0,
    isPrimary = true,
  }: {
    x: number;
    y: number;
    pointerId?: number;
    button?: number;
    isPrimary?: boolean;
  }
): PointerEvent {
  const event = new Event(type) as PointerEvent;
  Object.defineProperties(event, {
    button: { value: button },
    clientX: { value: x },
    clientY: { value: y },
    isPrimary: { value: isPrimary },
    pointerId: { value: pointerId },
  });
  return event;
}

function createFixture(overlayHits: OverlayHitTest[] = []): {
  canvas: HTMLElement;
  selectBody: ReturnType<typeof vi.fn>;
} {
  const scene = new THREE.Scene();
  const earth = new THREE.Group();
  earth.name = 'earth';
  earth.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshBasicMaterial()
    )
  );
  scene.add(earth);
  scene.updateMatrixWorld(true);

  const camera = new THREE.PerspectiveCamera(50, 2, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  const canvas = new EventTarget() as HTMLElement;
  canvas.getBoundingClientRect = () => CANVAS_RECT;

  const selectBody = vi.fn();
  const nav: PlanetNavigation = {
    selectBody,
    getSelectedBody: () => null,
    setUnavailable: () => {},
  };
  setupBodyPicker(scene, camera, canvas, nav, new Set(['earth']), overlayHits);

  return { canvas, selectBody };
}

describe('setupBodyPicker', () => {
  it('sélectionne le corps cliqué relativement aux limites du canvas', () => {
    const { canvas, selectBody } = createFixture();

    canvas.dispatchEvent(pointerEvent('pointerdown', { x: 200, y: 100 }));
    canvas.dispatchEvent(pointerEvent('pointerup', { x: 200, y: 100 }));

    expect(selectBody).toHaveBeenCalledOnce();
    expect(selectBody).toHaveBeenCalledWith('earth');
  });

  it('ignore un glisser OrbitControls et un pointerup isolé', () => {
    const { canvas, selectBody } = createFixture();

    canvas.dispatchEvent(pointerEvent('pointerup', { x: 200, y: 100 }));
    canvas.dispatchEvent(pointerEvent('pointerdown', { x: 200, y: 100 }));
    canvas.dispatchEvent(pointerEvent('pointerup', { x: 215, y: 100 }));

    expect(selectBody).not.toHaveBeenCalled();
  });

  it('ignore les boutons secondaires et les pointeurs non primaires', () => {
    const { canvas, selectBody } = createFixture();

    canvas.dispatchEvent(
      pointerEvent('pointerdown', { x: 200, y: 100, button: 2 })
    );
    canvas.dispatchEvent(pointerEvent('pointerup', { x: 200, y: 100 }));
    canvas.dispatchEvent(
      pointerEvent('pointerdown', { x: 200, y: 100, isPrimary: false })
    );
    canvas.dispatchEvent(pointerEvent('pointerup', { x: 200, y: 100 }));

    expect(selectBody).not.toHaveBeenCalled();
  });

  /**
   * UNE SONDE N'A PAS DE MESH, DONC LE RAYON NE PEUT PAS LA TOUCHER.
   *
   * Onze sondes et trois objets interstellaires sont peints par une couche 2D : ils sont
   * nommés à l'écran, et ils étaient les seuls objets nommés qu'un clic ne pouvait pas
   * atteindre. Le picker consulte donc les marqueurs AVANT de lancer son rayon — et dans cet
   * ordre, parce qu'ils sont dessinés par-dessus la scène : ce qui est sous le pointeur est
   * le marqueur, pas ce que le rayon trouverait derrière lui.
   */
  it('sélectionne un marqueur d’instrument avant de lancer le rayon', () => {
    // Le pointeur tombe sur la Terre : sans la couche, ce clic sélectionne « earth ».
    const { canvas, selectBody } = createFixture([
      (x, y) => (x === 200 && y === 100 ? 'voyager1' : null),
    ]);

    canvas.dispatchEvent(pointerEvent('pointerdown', { x: 200, y: 100 }));
    canvas.dispatchEvent(pointerEvent('pointerup', { x: 200, y: 100 }));

    expect(selectBody).toHaveBeenCalledWith('voyager1');
    expect(selectBody).toHaveBeenCalledTimes(1);
  });

  it('retombe sur le rayon quand aucun marqueur n’est touché', () => {
    const { canvas, selectBody } = createFixture([() => null]);

    canvas.dispatchEvent(pointerEvent('pointerdown', { x: 200, y: 100 }));
    canvas.dispatchEvent(pointerEvent('pointerup', { x: 200, y: 100 }));

    expect(selectBody).toHaveBeenCalledWith('earth');
  });
});
