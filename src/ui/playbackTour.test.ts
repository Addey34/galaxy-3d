import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setLocale } from '@/i18n';
import type { PlaybackControls } from './playback';
import { scaleFromSlider, speedLabel } from './speedSlider';

/**
 * LA VITESSE D'UNE VISITE ET LE PLAFOND DU LIEN (GAL-PRODUCT-013-REV1).
 *
 * `ui/playback` est câblé au DOM au chargement du module : on lui donne un DOM minimal, un plafond
 * que le test règle à la main et une horloge qui enregistre ce qu'on lui impose. C'est le vrai code
 * de `playback.ts` qui tourne, sans dépendre d'une connexion lente. Le navigateur (curseur natif,
 * horloge mesurée) est dans `e2e/tourSpeed.spec.ts`.
 */
interface FakeElement {
  value: string;
  textContent: string;
  dataset: Record<string, string>;
  attrs: Record<string, string>;
  listeners: Record<string, () => void>;
  classList: { toggle(): void; contains(): boolean };
  addEventListener(type: string, cb: () => void): void;
  setAttribute(name: string, value: string): void;
  replaceChildren(): void;
}

function fake(): FakeElement {
  const el: FakeElement = {
    value: '',
    textContent: '',
    dataset: {},
    attrs: {},
    listeners: {},
    classList: { toggle: () => undefined, contains: () => false },
    addEventListener: (type, cb) => {
      el.listeners[type] = cb;
    },
    setAttribute: (name, value) => {
      el.attrs[name] = value;
    },
    replaceChildren: () => undefined,
  };
  return el;
}

const FORWARD = 80;
const BACKWARD = 20;
const TOUR = 200_000;
const CEILING = 3_600;

let controls: PlaybackControls;
let ceiling: number | null = null;
let clock = 0;
const range = fake();
const value = fake();
const button = fake();

/** Ce que le visiteur voit et ce que l'horloge applique, lus ensemble. */
function view(): {
  clock: number;
  label: string;
  aria: string;
  slider: number;
  capped: boolean;
} {
  return {
    clock,
    label: value.textContent,
    aria: range.attrs['aria-valuetext']!,
    slider: Number(range.value),
    capped: range.dataset['capped'] !== undefined,
  };
}

function drag(position: number): void {
  range.value = String(position);
  range.listeners['input']!();
}

/** Le plafond change : la composition le relit à l'image suivante. */
function setCeiling(next: number | null): void {
  ceiling = next;
  controls.syncCeiling();
}

beforeAll(async () => {
  const elements: Record<string, FakeElement> = {
    'play-pause-btn': button,
    'speed-range': range,
    'speed-value': value,
  };
  vi.stubGlobal('document', {
    documentElement: {},
    getElementById: (id: string) => elements[id],
    createElementNS: () => fake(),
  });
  await setLocale('en');
  const { setupPlayback } = await import('./playback');
  controls = setupPlayback(
    { togglePause: () => false, setPaused: () => undefined } as never,
    {
      setSimulationSpeed: (scale: number) => {
        clock = scale;
      },
    } as never,
    () => ceiling
  );
});

describe('le plafond du lien pendant une visite', () => {
  it.each([
    ['en avant', FORWARD],
    ['en arrière', BACKWARD],
  ])(
    'demande %s, visite, plafond qui baisse puis remonte, fin de visite',
    (_, asked) => {
      setCeiling(null);
      drag(asked);
      const requested = scaleFromSlider(asked);
      expect(view()).toMatchObject({ clock: requested, capped: false });

      // 2. La visite emprunte SA vitesse : l'horloge, le libellé, le curseur et l'ARIA la disent.
      controls.borrowSpeed(TOUR);
      expect(view()).toMatchObject({
        clock: TOUR,
        label: speedLabel(TOUR),
        aria: speedLabel(TOUR),
        capped: false,
      });
      const tourSlider = view().slider;
      expect(tourSlider).toBeGreaterThan(50);

      // 3-4. Le plafond baisse : tout suit le plafond, et le dit, d'une seule voix.
      setCeiling(CEILING);
      const capped = view();
      expect(capped.clock).toBe(CEILING);
      expect(capped.capped).toBe(true);
      expect(capped.label).toBe(
        `${speedLabel(CEILING)} · limited by your connection`
      );
      expect(capped.aria).toBe(capped.label);
      expect(capped.slider).toBeLessThan(tourSlider);

      // 5. Il remonte PENDANT la visite : la vitesse de la visite est retrouvée, pas la demande.
      setCeiling(null);
      expect(view()).toMatchObject({
        clock: TOUR,
        capped: false,
        slider: tourSlider,
      });

      // 6. La visite se termine : le choix du visiteur est restauré, signe compris.
      controls.releaseSpeed();
      expect(view()).toMatchObject({
        clock: requested,
        label: speedLabel(requested),
        aria: speedLabel(requested),
        slider: asked,
        capped: false,
      });

      // 7. Un nouveau plafond respecte ce choix restauré, et le rend en se relâchant.
      setCeiling(CEILING);
      expect(view().clock).toBe(Math.sign(requested) * CEILING);
      setCeiling(null);
      expect(view()).toMatchObject({ clock: requested, slider: asked });
    }
  );

  it('la visite se termine pendant un creux du lien : la demande est plafonnée, puis rendue', () => {
    setCeiling(null);
    drag(FORWARD);
    controls.borrowSpeed(TOUR);
    setCeiling(CEILING);
    controls.releaseSpeed();
    expect(view()).toMatchObject({ clock: CEILING, capped: true });
    setCeiling(null);
    expect(view()).toMatchObject({
      clock: scaleFromSlider(FORWARD),
      slider: FORWARD,
    });
  });

  it('un geste du visiteur pendant la visite le gagne', () => {
    setCeiling(null);
    drag(FORWARD);
    controls.borrowSpeed(TOUR);
    drag(BACKWARD);
    expect(view().clock).toBe(scaleFromSlider(BACKWARD));
    controls.releaseSpeed();
    expect(view()).toMatchObject({
      clock: scaleFromSlider(BACKWARD),
      slider: BACKWARD,
    });
  });

  it('rendre sans avoir emprunté ne change rien', () => {
    setCeiling(null);
    drag(BACKWARD);
    const before = view();
    controls.releaseSpeed();
    expect(view()).toEqual(before);
  });
});
