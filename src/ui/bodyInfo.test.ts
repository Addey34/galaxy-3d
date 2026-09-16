import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { flattenBodies } from '@/config/catalog';
import { setLocale } from '@/i18n';
import { bodyStats } from './bodyInfo';

/**
 * Les libellés de la fiche sont des affirmations scientifiques. Chacun de ces cas a été livré
 * faux : « Distance (Terre) » pour Titan, « Jour » pour une rotation sidérale, « -142h 57m »
 * pour Triton, « Lunes : 8 » pour le Soleil.
 */
const CONFIGS = flattenBodies(CELESTIAL_CONFIG);
function stats(name: string): Map<string, string> {
  const cfg = CONFIGS.get(name);
  if (!cfg) throw new Error(`corps absent du catalogue : ${name}`);
  return new Map(bodyStats(name, cfg).map((s) => [s.label, s.value]));
}

describe('fiche d’information — libellés', () => {
  beforeAll(() => {
    // `setLocale` écrit `<html lang>` ; l'environnement de test n'a pas de DOM. Passer par
    // l'anglais d'abord : sur une machine française, la détection choisit déjà `fr` et
    // `setLocale('fr')` ne fait rien — c'est ainsi que ce test passait en local et cassait en CI.
    vi.stubGlobal('document', { documentElement: {} });
    setLocale('en');
    setLocale('fr');
  });

  it('mesure la distance d’un satellite depuis son parent réel', () => {
    const titan = stats('titan');
    expect(titan.has('Distance moyenne (Saturne)')).toBe(true);
    expect([...titan.keys()].join(' ')).not.toMatch(/Terre|Soleil/);
    expect(stats('io').has('Distance moyenne (Jupiter)')).toBe(true);
    expect(stats('jupiter').has('Distance moyenne (Soleil)')).toBe(true);
  });

  it('appelle la rotation sidérale par son nom, et sa durée reste positive', () => {
    const triton = stats('triton').get('Rotation sidérale');
    expect(triton).toBeDefined();
    expect(triton).not.toMatch(/-/);
    expect(stats('earth').has('Jour')).toBe(false);
  });

  it('dit « moyenne » pour une température moyenne', () => {
    expect(stats('mars').has('Température moyenne')).toBe(true);
  });

  it('ne compte pas de lunes au Soleil', () => {
    expect(stats('sun').has('Lunes connues')).toBe(false);
    expect(stats('earth').get('Lunes connues')).toBe('1');
  });
});
