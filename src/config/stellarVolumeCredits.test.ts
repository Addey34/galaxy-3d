import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * LES CRÉDITS DU VOLUME STELLAIRE (GAL-UNIVERSE-008) sont AFFICHÉS, pas seulement écrits dans le
 * manifeste : l'aide (`index.html`, crédits) porte le remerciement de Gaia mot pour mot, la citation du
 * GCNS, la licence des données de Gaia, celle de HYG, la citation CDS/SIMBAD exigée par le CDS et le
 * remerciement de la NASA Exoplanet Archive. Le texte est confronté au manifeste livré.
 */
const ROOT = resolve(import.meta.dirname, '../..');
const html = readFileSync(resolve(ROOT, 'index.html'), 'utf-8')
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ');
const manifest = JSON.parse(
  readFileSync(resolve(ROOT, 'public/assets/sky/volume/manifest.json'), 'utf-8')
) as { source: Record<string, Record<string, string>> };
const flat = (s: string): string => s.replace(/\s+/g, ' ').trim();

describe('les crédits du volume stellaire', () => {
  it('le remerciement de Gaia exigé par l’ESA, mot pour mot', () => {
    expect(html).toContain(flat(manifest.source['gcns']!['acknowledgement']!));
  });
  it('la citation du GCNS et la licence des données de Gaia', () => {
    expect(html).toContain('Gaia Catalogue of Nearby Stars');
    expect(html).toContain('Smart et al., 2021');
    expect(manifest.source['gcns']!['citation']).toContain(
      '10.1051/0004-6361/202039498'
    );
    expect(html).toContain('CC BY-NC 3.0 IGO');
    expect(html).toContain('GAVO data center');
  });
  it('HYG et sa licence, CDS/SIMBAD et le remerciement de la NASA', () => {
    expect(html).toContain('HYG database v4.4');
    expect(html).toContain('CC BY-SA 4.0');
    expect(html).toContain('CDS/SIMBAD');
    expect(html).toContain(
      flat(manifest.source['exoplanets']!['acknowledgement']!)
    );
  });
});
