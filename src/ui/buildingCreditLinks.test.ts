import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { splitUrls } from '@/core/textLinks';
import { LICENCE_HOSTS } from './buildingsOverlay';

const DIR = join(__dirname, '../../public/assets/buildings');

/**
 * Le crédit exigé par une source ne doit jamais être une adresse morte : toute adresse que porte
 * l'attribution d'un manifeste PUBLIÉ doit tomber sur un hôte que l'écran sait rendre cliquable.
 */
describe("l'attribution des jeux de bâtiments publiés", () => {
  const manifests = readdirSync(DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({
      id: d.name,
      attribution: JSON.parse(
        readFileSync(join(DIR, d.name, 'manifest.json'), 'utf8')
      ).source.attribution as string,
    }));

  it('lit au moins un manifeste par jeu de l’index', () => {
    const index = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8'));
    expect(manifests.map((m) => m.id).sort()).toEqual(
      index.sets.map((s: { id: string }) => s.id).sort()
    );
  });

  for (const { id, attribution } of manifests)
    it(`${id} : chaque adresse de l'attribution est cliquable`, () => {
      const hosts = splitUrls(attribution)
        .filter((p) => p.kind === 'url')
        .map((p) => new URL(p.value).hostname);
      for (const host of hosts) expect(LICENCE_HOSTS.has(host)).toBe(true);
    });
});
