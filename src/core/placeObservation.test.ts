import { describe, expect, it } from 'vitest';

import {
  antipode,
  observes,
  observesShapes,
  projectAround,
  ringTouchesPlace,
  trackTouchesPlace,
  withoutIndex,
  type Ring,
} from './placeObservation';

const MOON_R = 1737.4;
/** Tycho, tel que le gazetteer de l'UAI le publie. */
const TYCHO = { lat: -43.296, lon: 348.785, diameterKm: 85.3 };
const KM_PER_DEG = (MOON_R * Math.PI) / 180;

const box = (w: number, e: number, s: number, n: number): Ring => [
  [w, s],
  [w, n],
  [e, n],
  [e, s],
  [w, s],
];

describe('placeObservation', () => {
  it('projette à la distance EXACTE du centre, y compris près du pôle', () => {
    const [x, y] = projectAround(TYCHO, TYCHO.lat + 1, TYCHO.lon, MOON_R);
    expect(Math.hypot(x, y)).toBeCloseTo(KM_PER_DEG, 6);
    const pole = { lat: -89, lon: 0, diameterKm: 0 };
    const [px, py] = projectAround(pole, -89, 180, MOON_R);
    expect(Math.hypot(px, py)).toBeCloseTo(2 * KM_PER_DEG, 6);
  });

  it('écarte une grille GLOBALE : son empreinte couvre aussi l’antipode (les GDR de Diviner)', () => {
    expect(observes([box(0, 360, -90, 90)], TYCHO, MOON_R)).toBe('global');
    const a = antipode(TYCHO);
    expect(a.lat).toBeCloseTo(43.296);
    expect(a.lon).toBeCloseTo(168.785);
  });

  it('retient une empreinte qui contient le centre', () => {
    expect(observes([box(348, 349.5, -44, -43)], TYCHO, MOON_R)).toBe(
      'observed'
    );
  });

  it('retient un bord à moins d’un rayon du centre, et pas au-delà', () => {
    // Bord haut à 20 km au sud du centre : dans le disque de 42,65 km.
    const near = -43.296 - 20 / KM_PER_DEG;
    expect(ringTouchesPlace(box(340, 355, -55, near), TYCHO, MOON_R)).toBe(
      true
    );
    // Bord haut à 60 km : hors du disque.
    const far = -43.296 - 60 / KM_PER_DEG;
    expect(ringTouchesPlace(box(340, 355, -55, far), TYCHO, MOON_R)).toBe(
      false
    );
    expect(observes([box(340, 355, -55, far)], TYCHO, MOON_R)).toBe('none');
  });

  it('réduit une formation de diamètre publié nul à son centre', () => {
    const point = { lat: 0.674, lon: 23.473, diameterKm: 0 };
    expect(observes([box(23, 24, 0, 1)], point, MOON_R)).toBe('observed');
    expect(observes([box(23.5, 24, 0, 1)], point, MOON_R)).toBe('none');
  });

  it('voit une empreinte DÉCOUPÉE au méridien 0 par l’un de ses morceaux', () => {
    const split = [box(350, 360, -45, -43), box(0, 5, -45, -43)];
    expect(
      observes(split, { lat: -44, lon: 359.9, diameterKm: 1 }, MOON_R)
    ).toBe('observed');
    expect(observes(split, { lat: -44, lon: 2, diameterKm: 1 }, MOON_R)).toBe(
      'observed'
    );
    expect(observes(split, { lat: -44, lon: 180, diameterKm: 1 }, MOON_R)).toBe(
      'none'
    );
  });

  it('voit une formation posée EXACTEMENT sur la couture, à 360° comme à 0°', () => {
    const split = [box(350, 360, 38, 41), box(0, 5, 38, 41)];
    const cydonia = { lat: 39.667, lon: 360, diameterKm: 0 };
    expect(observes(split, cydonia, MOON_R)).toBe('observed');
    expect(observes([box(0, 5, 38, 41)], { ...cydonia, lon: 0 }, MOON_R)).toBe(
      'observed'
    );
    expect(observes([box(350, 360, 38, 41)], cydonia, MOON_R)).toBe('observed');
  });

  it('juste au pôle, une bande de latitude observe la formation sans la déclarer globale', () => {
    const band = box(0, 360, -90, -87);
    expect(
      observes([band], { lat: -89.5, lon: 10, diameterKm: 10 }, MOON_R)
    ).toBe('observed');
  });

  it('ne retient rien de lointain', () => {
    expect(observes([box(100, 101, 10, 11)], TYCHO, MOON_R)).toBe('none');
  });

  it('une TRACE observe ce qu’elle survole à moins d’un rayon, sans rien contenir', () => {
    // Une trace méridienne à 20 km à l'est du centre de Tycho, puis à 60 km.
    const dLon = (km: number) =>
      km / (KM_PER_DEG * Math.cos(TYCHO.lat * (Math.PI / 180)));
    const track = (km: number): Ring => [
      [TYCHO.lon + dLon(km), -50],
      [TYCHO.lon + dLon(km), -43.296],
      [TYCHO.lon + dLon(km), -36],
    ];
    expect(observes([track(20)], TYCHO, MOON_R, 'l')).toBe('observed');
    expect(observes([track(60)], TYCHO, MOON_R, 'l')).toBe('none');
    // Une trace FERMÉE autour du centre mais loin de lui ne le contient pas : c'est une ligne.
    expect(observes([box(340, 358, -55, -30)], TYCHO, MOON_R, 'l')).toBe(
      'none'
    );
  });

  it('une trace qui traverse le méridien 0 se juge sur la sphère, pas dans le plan', () => {
    const crossing: Ring = [
      [355, -44],
      [359.9, -44],
      [0.1, -44],
      [5, -44],
    ];
    expect(
      trackTouchesPlace(crossing, { lat: -44, lon: 0, diameterKm: 2 }, MOON_R)
    ).toBe(true);
  });

  it('une trace qui passe sur un lieu PUIS sur son antipode l’a observé : pas de règle de l’antipode', () => {
    const a = { lat: 10, lon: 20, diameterKm: 10 };
    const pass: Ring = [
      [15, 10],
      [25, 10],
    ];
    const back: Ring = [
      [195, -10],
      [205, -10],
    ];
    expect(observes([pass, back], a, MOON_R, 'l')).toBe('observed');
  });

  it('un point observe la formation dont il tombe dans le disque', () => {
    expect(observes([[[TYCHO.lon, TYCHO.lat + 0.5]]], TYCHO, MOON_R, 'p')).toBe(
      'observed'
    );
    expect(observes([[[TYCHO.lon, TYCHO.lat + 2]]], TYCHO, MOON_R, 'p')).toBe(
      'none'
    );
  });

  it('un grand anneau garde ses bords PROCHES même quand un sommet est lointain', () => {
    // Un anneau dont un sommet est à 100° de Tycho, et dont un bord passe à 20 km du centre.
    const edge = -43.296 - 20 / KM_PER_DEG;
    const ring: Ring = [
      [340, edge - 5],
      [340, edge],
      [355, edge],
      [355, edge - 5],
      [80, -60],
      [340, edge - 5],
    ];
    expect(ringTouchesPlace(ring, TYCHO, MOON_R)).toBe(true);
  });

  it('combine les types d’un même produit : un point suffit, une surface globale seule écarte', () => {
    const global = [box(0, 360, -90, 90)];
    // La surface est globale, mais un POINT tombe dans Tycho : le produit l'a observé.
    expect(
      observesShapes(
        { a: global, p: [[[TYCHO.lon, TYCHO.lat]]] },
        TYCHO,
        MOON_R
      )
    ).toBe('observed');
    // Sans le point, il reste global.
    expect(observesShapes({ a: global, p: [[[100, 10]]] }, TYCHO, MOON_R)).toBe(
      'global'
    );
    expect(observesShapes({}, TYCHO, MOON_R)).toBe('none');
  });

  it('l’INDEX des grandes formes rend EXACTEMENT les verdicts du parcours complet', () => {
    // Un générateur déterministe : la garde doit échouer pareil à chaque lancement.
    let seed = 42;
    const rnd = () =>
      (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const shapes: { rings: Ring[]; kind: 'a' | 'l' }[] = [];
    for (let k = 0; k < 12; k++) {
      // Un polygone étoilé de 200 sommets, de 1° à 40° de rayon, n'importe où (loin de la couture).
      const cx = 40 + rnd() * 280;
      const cy = -60 + rnd() * 120;
      const R = 1 + rnd() * 39;
      const ring: [number, number][] = [];
      for (let i = 0; i < 200; i++) {
        const t = (i / 200) * 2 * Math.PI;
        const rr = R * (0.5 + rnd() * 0.5);
        ring.push([
          cx + rr * Math.cos(t),
          Math.max(-89, Math.min(89, cy + rr * Math.sin(t))),
        ]);
      }
      ring.push(ring[0]);
      shapes.push({ rings: [ring], kind: 'a' });
    }
    // Une bande polaire, et une trace de 300 sommets qui TRAVERSE le méridien 0.
    shapes.push({ rings: [box(0, 360, -90, -80).concat()], kind: 'a' });
    const band: [number, number][] = [];
    for (let i = 0; i <= 120; i++)
      band.push([i * 3, -82 + Math.sin(i / 7) * 2]);
    band.push([360, -90], [0, -90], [0, band[0][1]]);
    shapes.push({ rings: [band], kind: 'a' });
    const track: [number, number][] = [];
    for (let i = 0; i < 300; i++)
      track.push([(340 + i * 0.15) % 360, -30 + i * 0.2]);
    shapes.push({ rings: [track], kind: 'l' });

    let compared = 0;
    let observed = 0;
    for (const { rings, kind } of shapes) {
      for (let q = 0; q < 400; q++) {
        const place = {
          lat: -89 + rnd() * 178,
          lon: rnd() * 360,
          diameterKm: rnd() < 0.2 ? 0 : rnd() * 400,
        };
        const indexed = observes(rings, place, MOON_R, kind);
        const brute = withoutIndex(() => observes(rings, place, MOON_R, kind));
        expect(indexed, JSON.stringify({ kind, place })).toBe(brute);
        compared++;
        if (brute === 'observed') observed++;
      }
    }
    // Une garde qui ne compare que des « none » ne prouverait rien.
    expect(compared).toBe(shapes.length * 400);
    expect(observed).toBeGreaterThan(100);
  });

  it('déroule un anneau qui TRAVERSE le méridien 0 : le vrai anneau HDTV ne contient pas Copernic', () => {
    // L'anneau EXACT d'un produit de la caméra HDTV de Kaguya (sh_20080724t034040_wm8_1189), tel
    // que le fichier `ga` de l'ODE le publie : 348° → 353° → 5°, un triangle d'environ 17°.
    const hdtv: Ring = [
      [348.08, -2.54],
      [353.393, 10.119],
      [5.16, -2.24],
      [348.08, -2.54],
    ];
    const copernicus = { lat: 9.621, lon: 339.921, diameterKm: 96.1 };
    expect(observes([hdtv], copernicus, MOON_R)).toBe('none');
    // Un point VRAIMENT dans le triangle, de chaque côté de la couture.
    expect(observes([hdtv], { lat: 1, lon: 356, diameterKm: 0 }, MOON_R)).toBe(
      'observed'
    );
    expect(observes([hdtv], { lat: -1, lon: 2, diameterKm: 0 }, MOON_R)).toBe(
      'observed'
    );
    // Et l'antipode d'un lieu proche n'y tombe pas : le produit n'est pas « global ».
    expect(observes([hdtv], { lat: 0, lon: 358, diameterKm: 10 }, MOON_R)).toBe(
      'observed'
    );
  });
});
