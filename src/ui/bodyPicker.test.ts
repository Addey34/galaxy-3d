import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { setupBodyPicker } from './bodyPicker';
import { markForwardedControlEvent } from './controlEventForwarding';
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

function createFixture(): {
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
  const nav: PlanetNavigation = { selectBody };
  setupBodyPicker(scene, camera, canvas, nav, new Set(['earth']));

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

  it('ignore un geste retransmis au canvas par un contrôle superposé', () => {
    const { canvas, selectBody } = createFixture();
    const down = pointerEvent('pointerdown', { x: 200, y: 100 });

    canvas.dispatchEvent(markForwardedControlEvent(down));
    canvas.dispatchEvent(pointerEvent('pointerup', { x: 200, y: 100 }));

    expect(selectBody).not.toHaveBeenCalled();
  });
});
