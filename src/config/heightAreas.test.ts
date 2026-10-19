import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * UNE AIRE DE RELIEF NOMME UNE FORMATION DE L'UAI, ET CE LIEN SE VÉRIFIE. Le cuiseur écrit
 * `gazetteerFeatureId`, le centre et le diamètre d'une aire depuis `surface-height-targets.json`,
 * saisis à la main : le gazetteer écrit les longitudes en 0 à 360 Est, la cible en −180 à 180,
 * et une conversion fausse ou un identifiant recopié d'une autre ligne cuit un relief fin au
 * mauvais endroit sans que rien ne le dise. Cette garde confronte chaque aire de chaque manifeste
 * livré à l'entrée du gazetteer qu'elle cite.
 */
interface Area {
  name: string;
  gazetteerFeatureId: number;
  centre: { latitudeDeg: number; longitudeDeg: number };
  diameterKm: number;
}
interface Manifest {
  id: string;
  body: string;
  coverage: Array<{ area?: Area }>;
}
interface Feature {
  name: string;
  lat: number;
  lon: number;
  diameterKm: number;
  iauId: number;
}

const root = resolve(__dirname, '../../public/assets');
const manifests: Manifest[] = readdirSync(resolve(root, 'height-tiles'), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory())
  .map((entry) => resolve(root, 'height-tiles', entry.name, 'manifest.json'))
  .filter((path) => existsSync(path))
  .map((path) => JSON.parse(readFileSync(path, 'utf-8')) as Manifest);

const areas = manifests.flatMap((manifest) =>
  manifest.coverage
    .filter((entry) => entry.area !== undefined)
    .map((entry) => ({ body: manifest.body, area: entry.area! }))
);

/** Écart de longitude sur le cercle, en degrés, indifférent à la convention d'écriture. */
function longitudeGap(a: number, b: number): number {
  const gap = Math.abs(((a - b) % 360) + 360) % 360;
  return Math.min(gap, 360 - gap);
}

describe('aires de relief : chacune désigne la formation du gazetteer qu’elle cite', () => {
  it('le jeu de manifestes livrés porte des aires (la garde ne tourne pas à vide)', () => {
    expect(areas.length).toBeGreaterThan(0);
    expect(areas.some((entry) => entry.body === 'mars')).toBe(true);
  });

  it.each(areas.map((entry) => [entry.body, entry.area.name, entry] as const))(
    '%s · %s',
    (body, _name, { area }) => {
      const features = JSON.parse(
        readFileSync(resolve(root, 'gazetteer', `${body}.json`), 'utf-8')
      ) as Feature[];
      const feature = features.find((f) => f.iauId === area.gazetteerFeatureId);
      expect(
        feature,
        `identifiant ${area.gazetteerFeatureId} absent du gazetteer de ${body}`
      ).toBeDefined();
      expect(feature!.name).toBe(area.name);
      expect(Math.abs(feature!.lat - area.centre.latitudeDeg)).toBeLessThan(
        0.05
      );
      expect(longitudeGap(feature!.lon, area.centre.longitudeDeg)).toBeLessThan(
        0.05
      );
      expect(Math.abs(feature!.diameterKm - area.diameterKm)).toBeLessThan(0.5);
    }
  );
});
