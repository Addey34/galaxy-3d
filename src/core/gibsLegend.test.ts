import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TILE_PROVIDERS } from '@/registry/providers/runtimeServices';
import { connectHostsFromFirebase } from '@/seo/sourcesPage';
import {
  GIBS_COLORMAP,
  colormapBoundsC,
  colormapToCss,
  type GibsColormap,
} from './gibsLegend';

const ROOT = resolve(import.meta.dirname, '../..');

/**
 * DÉFAUT DE PRODUCTION CORRIGÉ ICI. La légende de la couche « température satellite » était un
 * `<img src>` vers `gibs.earthdata.nasa.gov`, que notre PROPRE `img-src 'self' data: blob:`
 * bloque : elle n'a jamais été visible en ligne, et une image bloquée ne se plaint pas. Deux
 * affirmations sont donc tenues ici : le barème livré est bien celui de la NASA, et plus aucune
 * légende ne dépend du réseau.
 */
describe('barème de couleurs GIBS importé', () => {
  it('porte sa source, sa date de lecture et son unité', () => {
    expect(GIBS_COLORMAP.source).toMatch(
      /^https:\/\/gibs\.earthdata\.nasa\.gov\/colormaps\//
    );
    expect(GIBS_COLORMAP.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(GIBS_COLORMAP.units).toBe('K');
  });

  it('décrit la couche que la couche satellite demande réellement', async () => {
    // Deux déclarations de la même couche : la constante que `layerSource.ts` met dans la
    // requête, et le réglage que `THERMAL_SETTINGS` porte. Le barème doit valoir pour les deux.
    const { GIBS_LST_LAYER } = await import('./gibsClouds');
    const { THERMAL_SETTINGS } = await import('@/config/engine');
    expect(GIBS_COLORMAP.layer).toBe(GIBS_LST_LAYER);
    expect(GIBS_COLORMAP.layer).toBe(THERMAL_SETTINGS.layer);
  });

  it('couvre une plage de températures plausible, bornes finies', () => {
    expect(GIBS_COLORMAP.min).toBeGreaterThan(150);
    expect(GIBS_COLORMAP.max).toBeLessThan(400);
    expect(GIBS_COLORMAP.min).toBeLessThan(GIBS_COLORMAP.max);
    expect(GIBS_COLORMAP.stops.length).toBeGreaterThanOrEqual(8);
    for (const { offset, rgb } of GIBS_COLORMAP.stops) {
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThanOrEqual(1);
      expect(rgb).toHaveLength(3);
      for (const channel of rgb) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(255);
      }
    }
  });

  it('rend un dégradé CSS complet, du premier au dernier arrêt', () => {
    const css = colormapToCss();
    expect(css.startsWith('linear-gradient(to right, ')).toBe(true);
    expect(css).toContain('0.0%');
    expect(css).toContain('100.0%');
    const first = GIBS_COLORMAP.stops[0]!.rgb;
    expect(css).toContain(`rgb(${first[0]} ${first[1]} ${first[2]})`);
  });

  it('convertit les bornes en degrés Celsius, signe compris', () => {
    // 220 K et 310 K, tels que GIBS les publie : −53 °C et +37 °C.
    expect(colormapBoundsC()).toEqual({ lo: '−53 °C', hi: '+37 °C' });
  });

  it('refuse un barème qui ne serait pas en kelvins', () => {
    const celsius = { ...GIBS_COLORMAP, units: 'C' } as GibsColormap;
    expect(() => colormapBoundsC(celsius)).toThrow(/kelvins/);
  });
});

describe('aucune légende distante ne subsiste', () => {
  /**
   * La règle a CHANGÉ au lot 9, phase 9C, et il vaut mieux l'écrire que la laisser deviner.
   *
   * Elle disait « aucune image tierce », ce qui était vrai tant qu'aucune image distante n'avait
   * de raison d'exister. L'imagerie de surface streamée en est une : ses tuiles SONT des images,
   * et leur hôte doit donc être autorisé. La règle devient : `img-src` autorise exactement les
   * hôtes que des fiches `tile-source` déclarent, et rien d'autre. Elle attrape toujours le
   * défaut d'origine — un hôte comme GIBS, qui n'est pas un service de tuiles, y reste interdit,
   * donc une légende distante y serait toujours bloquée — et elle attrape en plus un hôte ajouté
   * à la CSP sans fiche de registre.
   */
  it('n’autorise en img-src que les hôtes déclarés comme services de tuiles', () => {
    const csp = JSON.stringify(
      JSON.parse(readFileSync(resolve(ROOT, 'firebase.json'), 'utf-8'))
    );
    const imgSrc = /img-src ([^;]+);/.exec(csp)?.[1];
    expect(imgSrc, 'directive img-src introuvable').toBeTruthy();
    const remote = [...imgSrc!.matchAll(/https:\/\/([a-z0-9.-]+)/g)].map(
      (m) => m[1]!
    );
    const declared = Object.values(TILE_PROVIDERS).map((p) => p.host);
    expect(remote.sort()).toEqual([...declared].sort());
    // Les seuls jetons non-hôtes admis restent ceux de l'origine et des images locales.
    expect(imgSrc!.replace(/https:\/\/[a-z0-9.-]+/g, '').trim()).toBe(
      "'self' data: blob:"
    );
  });

  it('autorise le même hôte en connect-src : une tuile se télécharge avant d’être une image', () => {
    const config = JSON.parse(
      readFileSync(resolve(ROOT, 'firebase.json'), 'utf-8')
    ) as Parameters<typeof connectHostsFromFirebase>[0];
    const connect = connectHostsFromFirebase(config);
    for (const provider of Object.values(TILE_PROVIDERS))
      expect(connect, provider.id).toContain(provider.host);
  });

  it('aucun module d’interface ne construit une source d’image distante', () => {
    // La forme exacte du défaut : `legend.src = <URL absolue>`. Le test lit la SOURCE, pour
    // nommer le fichier fautif sans exiger un build.
    for (const file of [
      'weatherLayers.ts',
      'thermalLayer.ts',
      'earthLayer.ts',
    ]) {
      const source = readFileSync(resolve(ROOT, 'src/ui', file), 'utf-8');
      expect(source, file).not.toContain('legendUrl');
      expect(source.replace(/\/\/.*$/gm, ''), file).not.toMatch(
        /\.src\s*=\s*[^;]*https?:/
      );
    }
  });
});
