import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CameraSystem } from '@/components/systems/CameraSystem';
import type { SceneSystem } from '@/components/systems/SceneSystem';
import type { PlanetNavigation } from './planetNav';
import { ExploHud, findLabelPlacement, type LabelRect } from './exploHud';

describe('projected label layout', () => {
  it('keeps the target on its projected body', () => {
    const placement = findLabelPlacement(
      { name: 'mars', x: 400, y: 300, target: true },
      [],
      800,
      600,
      'explo'
    );
    expect(placement).toMatchObject({
      x: 400,
      y: 300,
      textOffsetX: 0,
      textOffsetY: 0,
      offset: false,
    });
  });

  it('also keeps an educational target centered instead of applying the text offset', () => {
    const placement = findLabelPlacement(
      { name: 'mars', x: 400, y: 300, target: true },
      [],
      800,
      600,
      'educ'
    );
    expect(placement).toMatchObject({
      x: 400,
      y: 300,
      textOffsetX: 0,
      textOffsetY: 0,
      offset: false,
    });
  });

  it('moves a colliding secondary label to a free slot', () => {
    const occupied: LabelRect[] = [
      { left: 390, right: 470, top: 290, bottom: 325 },
    ];
    const placement = findLabelPlacement(
      { name: 'earth', x: 400, y: 300, target: false },
      occupied,
      800,
      600,
      'explo'
    );
    expect(placement).not.toBeNull();
    expect(placement?.offset).toBe(true);
    const rect = placement!.rect;
    const first = occupied[0];
    expect(
      rect.right <= first.left ||
        rect.left >= first.right ||
        rect.bottom <= first.top ||
        rect.top >= first.bottom
    ).toBe(true);
  });

  it('drops a label when every safe slot is occupied', () => {
    const occupied: LabelRect[] = [
      { left: 0, right: 800, top: 0, bottom: 600 },
    ];
    expect(
      findLabelPlacement(
        { name: 'mercury', x: 400, y: 300, target: false },
        occupied,
        800,
        600,
        'educ'
      )
    ).toBeNull();
  });
});

/**
 * LE HUD N'ÉCRIT QUE CE QUI A CHANGÉ (2026-10-29) : réécrire une valeur identique invalide
 * quand même les styles du navigateur, et avec ~40 libellés c'était un recalcul complet à
 * chaque image, vue immobile comprise. Le test compte les écritures de style et de classe sur
 * de faux éléments.
 */
interface FakeLabel {
  writes: number;
  display: string;
  transform: string;
  classes: Set<string>;
}

describe('ExploHud : écritures du DOM', () => {
  let created: FakeLabel[] = [];

  function fakeElement(): Record<string, unknown> {
    const label: FakeLabel = {
      writes: 0,
      display: '',
      transform: '',
      classes: new Set<string>(),
    };
    const style = {
      setProperty: () => label.writes++,
    } as Record<string, unknown>;
    Object.defineProperty(style, 'display', {
      get: () => label.display,
      set: (v: string) => {
        label.writes++;
        label.display = v;
      },
    });
    Object.defineProperty(style, 'transform', {
      get: () => label.transform,
      set: (v: string) => {
        label.writes++;
        label.transform = v;
      },
    });
    const element = {
      dataset: {} as Record<string, string>,
      style,
      classList: {
        add: (...n: string[]) => n.forEach((c) => label.classes.add(c)),
        remove: (...n: string[]) => {
          for (const c of n) {
            if (label.classes.delete(c)) label.writes++;
          }
        },
        toggle: (n: string, force?: boolean) => {
          const want = force ?? !label.classes.has(n);
          if (want !== label.classes.has(n)) label.writes++;
          if (want) label.classes.add(n);
          else label.classes.delete(n);
          return want;
        },
      },
      setAttribute: () => undefined,
      addEventListener: () => undefined,
      append: () => undefined,
      querySelector: () => null,
      offsetWidth: 0,
    };
    (element as unknown as { __label: FakeLabel }).__label = label;
    return element;
  }

  beforeEach(() => {
    created = [];
    vi.stubGlobal('window', {
      innerWidth: 1280,
      innerHeight: 800,
      setTimeout: () => 0,
    });
    vi.stubGlobal('document', {
      createElement: (tag: string) => {
        const el = fakeElement();
        if (tag === 'button')
          created.push((el as unknown as { __label: FakeLabel }).__label);
        return el;
      },
      querySelector: () => null,
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const camera = (): THREE.PerspectiveCamera => {
    const c = new THREE.PerspectiveCamera(55, 1280 / 800, 1e-3, 1e4);
    c.position.set(0, 0, 10);
    c.lookAt(0, 0, 0);
    c.updateMatrixWorld();
    return c;
  };

  function setup() {
    const bodies: [string, THREE.Vector3][] = [
      ['Earth', new THREE.Vector3(0, 0, 0)],
      ['Moon', new THREE.Vector3(2, 1, 0)],
    ];
    const cameraSystem = { targetName: null as string | null };
    const sceneSystem = {
      forEachBodyWorldPosition: (cb: (n: string, p: THREE.Vector3) => void) =>
        bodies.forEach(([n, v]) => cb(n, v)),
    };
    const hud = new ExploHud(
      { selectBody: () => undefined } as unknown as PlanetNavigation,
      {} as HTMLElement
    );
    hud.setActive(true);
    const cam = camera();
    const frame = (): void =>
      hud.update(
        cam,
        cameraSystem as unknown as CameraSystem,
        sceneSystem as unknown as SceneSystem
      );
    const total = (): number => created.reduce((n, l) => n + l.writes, 0);
    return { bodies, cameraSystem, frame, total };
  }

  it('affiche les libellés placés, puis ne réécrit rien sur une vue identique', () => {
    const { frame, total } = setup();
    frame();
    expect(created.map((l) => l.display)).toEqual(['block', 'block']);
    const after = total();
    expect(after).toBeGreaterThan(0);

    frame();
    frame();
    expect(total()).toBe(after);
  });

  it('ne réécrit que le libellé dont le corps a bougé', () => {
    const { bodies, frame } = setup();
    frame();
    const before = created.map((l) => l.writes);
    bodies[1]![1].set(2.5, 1, 0);
    frame();
    const delta = created.map((l, i) => l.writes - before[i]!);
    expect(delta[0]).toBe(0);
    expect(delta[1]).toBeGreaterThan(0);
  });

  it('éteint un libellé dont le corps sort du champ, et le rallume au retour', () => {
    const { bodies, frame } = setup();
    frame();
    bodies[1]![1].set(500, 0, 0); // loin hors champ
    frame();
    expect(created[1]!.display).toBe('none');
    expect(created[0]!.display).toBe('block');
    bodies[1]![1].set(2, 1, 0);
    frame();
    expect(created[1]!.display).toBe('block');
  });

  it('déplace la classe de cible avec la cible', () => {
    const { cameraSystem, frame } = setup();
    cameraSystem.targetName = 'Earth';
    frame();
    expect(created[0]!.classes.has('is-target')).toBe(true);
    expect(created[1]!.classes.has('is-target')).toBe(false);
    cameraSystem.targetName = 'Moon';
    frame();
    expect(created[0]!.classes.has('is-target')).toBe(false);
    expect(created[1]!.classes.has('is-target')).toBe(true);
  });

  it('rallume après un setActive(false) puis (true)', () => {
    // Un HUD éteint masque tout : le cache ne doit pas croire qu'ils sont encore affichés.
    const h2 = new ExploHud(
      { selectBody: () => undefined } as unknown as PlanetNavigation,
      {} as HTMLElement
    );
    h2.setActive(true);
    const sceneSystem = {
      forEachBodyWorldPosition: (cb: (n: string, p: THREE.Vector3) => void) =>
        cb('Earth', new THREE.Vector3(0, 0, 0)),
    };
    const cs = { targetName: null };
    const cam = camera();
    const run = (): void =>
      h2.update(
        cam,
        cs as unknown as CameraSystem,
        sceneSystem as unknown as SceneSystem
      );
    run();
    const mine = created[created.length - 1]!;
    expect(mine.display).toBe('block');
    h2.setActive(false);
    expect(mine.display).toBe('none');
    h2.setActive(true);
    run();
    expect(mine.display).toBe('block');
  });
});
