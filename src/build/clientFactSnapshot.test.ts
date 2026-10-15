import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { describe, expect, it } from 'vitest';
import { BUILD_ONLY_DIRS } from '@/buildOnly';
import snapshot from '@/config/factSources.snapshot.json';
import { publishedRadiiKm } from '@/config/bodyFigure';
import { clientFactSnapshot } from './clientFactSnapshot';

const SRC = join(__dirname, '..');

/** Les modules livrés au navigateur : `src/`, hors tests et hors dossiers de build. */
function shippedModules(dir = SRC): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(SRC, full).split(sep).join('/');
    if (statSync(full).isDirectory()) {
      if (!BUILD_ONLY_DIRS.some((d) => rel === d || rel.startsWith(`${d}/`)))
        out.push(...shippedModules(full));
    } else if (/\.ts$/.test(name) && !/\.(test|d)\.ts$/.test(name))
      out.push(rel);
  }
  return out;
}

describe('le relevé des faits côté client (lot 52, piste B)', () => {
  const full = snapshot as unknown as Parameters<typeof clientFactSnapshot>[0];
  const reduced = clientFactSnapshot(full);

  it('chaque corps garde exactement ses rayons publiés', () => {
    const names = Object.keys(full.naifRotation.bodies);
    // LE TÉMOIN : des corps avec rayons, et d'autres sans, existent bien dans le relevé.
    expect(Object.keys(reduced.naifRotation.bodies).length).toBeGreaterThan(30);
    expect(Object.keys(reduced.naifRotation.bodies).length).toBeLessThan(
      names.length
    );
    for (const name of names) {
      const radii = reduced.naifRotation.bodies[name]?.radiiKm;
      const published = publishedRadiiKm(name);
      if (published) expect(radii, name).toEqual([...published]);
      else
        expect(
          radii === undefined || radii.length !== 3,
          `${name} : des rayons apparus`
        ).toBe(true);
    }
  });

  it('ne garde que les rayons, et pèse une fraction de la section', () => {
    expect(Object.keys(reduced)).toEqual(['naifRotation']);
    for (const entry of Object.values(reduced.naifRotation.bodies))
      expect(Object.keys(entry)).toEqual(['radiiKm']);
    expect(JSON.stringify(reduced).length).toBeLessThan(
      JSON.stringify(full.naifRotation).length / 5
    );
  });

  it('aucun autre module livré n’importe le relevé, il recevrait un objet amputé', () => {
    const readers = shippedModules().filter((rel) =>
      /from\s+['"][^'"]*factSources\.snapshot\.json['"]/.test(
        readFileSync(join(SRC, rel), 'utf8')
      )
    );
    expect(readers).toEqual(['config/bodyFigure.ts']);
  });
});
