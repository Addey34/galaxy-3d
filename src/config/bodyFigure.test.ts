import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CELESTIAL_CONFIG } from './bodies';
import { flattenBodies } from './catalog';
import {
  bodyFigure,
  figureRadiiKm,
  fittedRadiiKm,
  publishedRadiiKm,
} from './bodyFigure';
import { createSphereGeometry } from './layerConfig';
import snapshot from './factSources.snapshot.json';

/**
 * LE GLOBE A LES DEMI-AXES QUE LE NOYAU PCK PUBLIE (ligne 45.3, lot 1). Les rayons ne sont lus
 * qu'au relevé ; ces gardes confrontent la façade au relevé, puis la GÉOMÉTRIE rendue aux rayons.
 */

type Entry = { radiiKm?: number[] | null };
const relevé = (
  snapshot as unknown as { naifRotation: { bodies: Record<string, Entry> } }
).naifRotation.bodies;
const bodies = flattenBodies(CELESTIAL_CONFIG);

describe('la figure de chaque corps', () => {
  it('rend exactement les rayons du relevé, sans une valeur écrite ici', () => {
    for (const [name, entry] of Object.entries(relevé)) {
      const radii = publishedRadiiKm(name);
      if (!entry.radiiKm) {
        expect(radii, name).toBeNull();
        continue;
      }
      expect(radii, name).toEqual(entry.radiiKm);
    }
  });

  it('ne déclare une figure qu’aux corps du catalogue', () => {
    for (const name of Object.keys(relevé))
      expect(bodies.has(name), name).toBe(true);
  });

  it('laisse rond un corps dont les trois rayons sont égaux, quelle que soit sa fiche', () => {
    for (const name of Object.keys(relevé)) {
      const radii = publishedRadiiKm(name);
      if (!radii || radii[0] !== radii[1] || radii[1] !== radii[2]) continue;
      expect(
        bodyFigure(name, bodies.get(name)?.realData?.radiusKm),
        name
      ).toBeNull();
    }
  });

  it('aplatit les géantes : au moins Saturne, Jupiter, Uranus, Neptune et la Terre', () => {
    for (const name of ['saturn', 'jupiter', 'uranus', 'neptune', 'earth']) {
      const figure = bodyFigure(name, bodies.get(name)?.realData?.radiusKm);
      expect(figure, name).not.toBeNull();
      expect(figure!.c, name).toBeLessThan(figure!.a);
    }
  });

  it('dessine Saturne avec SES demi-axes : le rapport pôle/équateur de la géométrie rendue', () => {
    const cfg = bodies.get('saturn')!;
    const figure = bodyFigure('saturn', cfg.realData?.radiusKm)!;
    const geometry = createSphereGeometry(10, 'surface', 64, figure);
    const p = geometry.getAttribute('position') as THREE.BufferAttribute;
    let pole = 0;
    let equator = 0;
    for (let i = 0; i < p.count; i++) {
      pole = Math.max(pole, Math.abs(p.getY(i)));
      equator = Math.max(equator, Math.hypot(p.getX(i), p.getZ(i)));
    }
    const [a, , c] = publishedRadiiKm('saturn')!;
    expect(pole / equator).toBeCloseTo(c / a, 4);
    // Rapportée au rayon de la fiche : l'équateur rendu vaut a, quel qu'il soit.
    expect(equator / 10).toBeCloseTo(a / cfg.realData!.radiusKm!, 4);
  });

  it('donne à Cérès l’ellipsoïde AJUSTÉ au relief de Dawn, le noyau ne portant que celui d’avant', () => {
    expect(publishedRadiiKm('ceres')).toBeNull();
    const radii = fittedRadiiKm('ceres');
    expect(radii).not.toBeNull();
    expect(figureRadiiKm('ceres')).toEqual(radii);
    const figure = bodyFigure('ceres', bodies.get('ceres')?.realData?.radiusKm);
    expect(figure).not.toBeNull();
    expect(figure!.c).toBeLessThan(figure!.a);
  });
});
