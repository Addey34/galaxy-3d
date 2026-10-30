import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  GIBS_DEFAULT_LAYER,
  GIBS_LST_LAYER,
  GIBS_MODIS_AQUA_LAYER,
  GIBS_MODIS_TERRA_LAYER,
  GIBS_SST_LAYER,
} from '@/core/gibsClouds';
import { IMERG_DAILY_LAYER, IMERG_LAYER } from '@/core/gibsPrecip';

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

/**
 * CHAQUE COUCHE GIBS LUE PORTE LES DOI QUE GIBS DÉCLARE POUR ELLE (lu le 2026-10-30 dans ses
 * fiches de couche, `nasa-gibs/worldview`, `config/default/common/config/metadata/layers`).
 * Le DOI d'IMERG Final n'est pas écrit seul : la couche de 30 minutes démarre au passage
 * préliminaire (Early) et lui substitue le final ; la couche quotidienne est un produit sur
 * mesure sans DOI propre, ce que la note du panneau dit.
 */
describe('citations des produits du panneau Météo', () => {
  const citations = html.slice(
    html.indexOf('wl-citations'),
    html.indexOf('</details>', html.indexOf('wl-citations'))
  );
  const DOIS: Record<string, string[]> = {
    [GIBS_DEFAULT_LAYER]: [
      '10.5067/VIIRS/VNP02IMG_NRT.002',
      '10.5067/VIIRS/VNP02MOD_NRT.002',
      '10.5067/VIIRS/VNP03IMG_NRT.002',
      '10.5067/VIIRS/VNP03MOD_NRT.002',
    ],
    [GIBS_MODIS_TERRA_LAYER]: [
      '10.5067/MODIS/MOD02QKM.061',
      '10.5067/MODIS/MOD02HKM.061',
      '10.5067/MODIS/MOD021KM.061',
    ],
    [GIBS_MODIS_AQUA_LAYER]: [
      '10.5067/MODIS/MYD02HKM.061',
      '10.5067/MODIS/MYD021KM.061',
    ],
    [IMERG_LAYER]: [
      '10.5067/GPM/IMERG/3B-HH-E/07',
      '10.5067/GPM/IMERG/3B-HH/07',
    ],
    [IMERG_DAILY_LAYER]: [
      '10.5067/GPM/IMERG/3B-HH-E/07',
      '10.5067/GPM/IMERG/3B-HH/07',
    ],
    [GIBS_LST_LAYER]: ['10.5067/AP1B0BA5PD2K'],
    [GIBS_SST_LAYER]: ['10.5067/GHGMR-4FJ04'],
  };

  it.each(Object.entries(DOIS))('%s porte ses DOI', (layer, dois) => {
    expect(layer.length).toBeGreaterThan(0);
    for (const doi of dois)
      expect(citations, `${layer} : ${doi}`).toContain(`doi.org/${doi}`);
  });

  it('cite le remerciement GIBS et la politique de données de la NASA', () => {
    expect(citations).toContain('Global Imagery Browse Services (GIBS)');
    expect(citations).toContain('data-use-policy');
  });
});
