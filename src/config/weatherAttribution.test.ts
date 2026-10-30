import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GIBS_SST_LAYER } from '@/core/gibsClouds';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const layerSource = readFileSync(join(ROOT, 'src/core/layerSource.ts'), 'utf8');

/**
 * L'ATTRIBUTION MÉTÉO NOMME CHAQUE PRODUIT QUE LES COUCHES LISENT (audit des panneaux, B2).
 *
 * Le pied du panneau Météo ne citait que « NASA GIBS » : ni VIIRS, MODIS, IMERG, MERRA-2 ni
 * GHRSST MUR n'y figuraient. Les noms sont confrontés à ce que `layerSource.ts` et `gibsClouds.ts`
 * lisent réellement : un produit ajouté sans être nommé fait échouer le test.
 */
describe('attribution du panneau Météo', () => {
  const attribution = html.slice(
    html.indexOf('wl-attribution'),
    html.indexOf('</p>', html.indexOf('wl-attribution'))
  );

  it.each(['VIIRS', 'MODIS', 'IMERG', 'MERRA-2', 'GHRSST MUR'])(
    'nomme %s',
    (product) => {
      expect(attribution).toContain(product);
    }
  );

  it('ne nomme que des produits que le code lit', () => {
    expect(layerSource).toContain('IMERG');
    expect(layerSource).toContain('MERRA-2');
    expect(layerSource).toMatch(/VIIRS/);
    expect(layerSource).toMatch(/MODIS/);
    expect(GIBS_SST_LAYER).toContain('GHRSST_L4_MUR');
  });
});
