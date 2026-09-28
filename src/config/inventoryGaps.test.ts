import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { collectInventory } from '@/inventory/collect';
import { renderInventory } from '@/inventory/render';
import { CELESTIAL_CONFIG } from './bodies';
import { flattenBodies } from './catalog';
import { NAVIGABLE_TARGETS } from './navigable';
import { LOCALES } from '@/i18n/locales';

/**
 * L'INVENTAIRE DÉRIVÉ — ce que cette garde tient.
 *
 * `pnpm inventory:gaps` est la seule source des nombres que citent la roadmap et les handoffs.
 * La panne qu'elle prévient est connue et datée : `docs/private/ROADMAP.md` a menti une journée
 * entière parce qu'il RECOPIAIT un état. Un relevé qui oublie un corps mentirait de la même
 * façon, en paraissant complet — d'où la première assertion, qui exige le catalogue ENTIER et
 * rougit dès qu'une ligne manque.
 *
 * Le reste croise le relevé avec les fichiers qu'il prétend lire (manifeste des éphémérides,
 * relevé des paliers de texture, empreinte des documents générés) : deux lecteurs d'une même
 * donnée, jamais une copie.
 */
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const inventory = collectInventory(PROJECT_ROOT);

const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(join(PROJECT_ROOT, path), 'utf8'));

describe('inventaire dérivé du dépôt', () => {
  it('couvre le catalogue ENTIER, satellites compris', () => {
    const expected = [...flattenBodies(CELESTIAL_CONFIG).keys()].sort();
    const seen = inventory.rows
      .filter((row) => row.family === 'body')
      .map((row) => row.id)
      .sort();
    expect(seen).toEqual(expected);
  });

  it('couvre les objets d’instrument, sondes et interstellaires', () => {
    const expected = [...NAVIGABLE_TARGETS.keys()].sort();
    const seen = inventory.rows
      .filter((row) => row.family !== 'body')
      .map((row) => row.id)
      .sort();
    expect(seen).toEqual(expected);
    expect(
      inventory.rows.filter((row) => row.family === 'spacecraft')
    ).toHaveLength(11);
    expect(
      inventory.rows.filter((row) => row.family === 'interstellar')
    ).toHaveLength(3);
  });

  it('ne signale une absence que pour une capacité applicable', () => {
    for (const row of inventory.rows)
      for (const capability of row.absent)
        expect(
          row.applicable,
          `${row.id} déclare ${capability} absent sans le déclarer applicable`
        ).toContain(capability);
  });

  it('donne à chaque ligne au moins une capacité applicable', () => {
    for (const row of inventory.rows)
      expect(row.applicable.length, row.id).toBeGreaterThan(0);
  });

  it('rend le pas de chaque binaire tel que le manifeste le déclare', () => {
    const manifest = readJson('public/assets/ephemerides/manifest.json') as {
      bodies: Record<string, { file: string; stepDays: number }>;
    };
    const byId = new Map(inventory.rows.map((row) => [row.id, row]));
    for (const [id, entry] of Object.entries(manifest.bodies)) {
      const row = byId.get(id);
      expect(row, `${id} est au manifeste mais absent du relevé`).toBeDefined();
      expect(row!.position.binary?.file).toBe(entry.file);
      expect(row!.position.binary?.stepDays).toBe(entry.stepDays);
      // Le fichier est LU : un binaire annoncé mais absent du disque doit se voir.
      expect(row!.position.binary?.bytes, `${id} : binaire absent`).toBeTypeOf(
        'number'
      );
    }
    // Et l'inverse : aucune ligne n'invente un binaire.
    for (const row of inventory.rows)
      if (row.position.binary)
        expect(manifest.bodies[row.id], row.id).toBeDefined();
  });

  it('rend les paliers de texture tels que le relevé mesuré les déclare', () => {
    const ladder = readJson('src/config/textureLadder.json') as {
      rows: { body: string; layer: string; shipped: string[] }[];
    };
    const camel = (layer: string): string =>
      layer.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    for (const measured of ladder.rows) {
      const row = inventory.rows.find(
        (candidate) => candidate.id === measured.body
      );
      expect(row, `${measured.body} est au relevé mais absent`).toBeDefined();
      const layer = row!.textures.find(
        (candidate) => candidate.layer === camel(measured.layer)
      );
      expect(layer?.shipped, `${measured.body} ${measured.layer}`).toEqual(
        measured.shipped
      );
    }
  });

  it('lit les pages et vignettes dans l’empreinte des documents générés', () => {
    const withPages = inventory.rows.filter((row) =>
      row.applicable.includes('page')
    );
    // Les pages et les vignettes sont livrées depuis le lot 20 : si l'une venait à manquer, le
    // relevé doit le dire plutôt que de rester muet.
    for (const row of withPages) {
      expect(row.page.locales, row.id).toHaveLength(LOCALES.length);
      expect(row.card, `${row.id} : vignette`).toBe(true);
    }
    expect(withPages.length).toBeGreaterThan(50);
  });

  it('nomme chaque ligne dans la sortie lisible', () => {
    const text = renderInventory(inventory);
    for (const row of inventory.rows) expect(text).toContain(row.id);
    for (const title of [
      'CORPS DU CATALOGUE',
      'SONDES',
      'OBJETS INTERSTELLAIRES',
    ])
      expect(text).toContain(title);
  });

  /**
   * `src/inventory/` lit le disque : il n'a rien à faire dans le bundle du visiteur. Même
   * propriété que `src/seo/`, tenue ici par une garde plutôt que par un `grep` à la main.
   */
  it('n’est importé par aucun module de l’application', () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const item of readdirSync(join(PROJECT_ROOT, dir), {
        withFileTypes: true,
      })) {
        const path = `${dir}/${item.name}`;
        if (item.isDirectory()) {
          if (item.name !== 'inventory') walk(path);
          continue;
        }
        if (!item.name.endsWith('.ts') || item.name.endsWith('.test.ts'))
          continue;
        if (
          readFileSync(join(PROJECT_ROOT, path), 'utf8').includes('@/inventory')
        )
          offenders.push(path);
      }
    };
    walk('src');
    expect(offenders).toEqual([]);
  });

  it('est exposé par la commande que les documents citent', () => {
    const pkg = readJson('package.json') as { scripts: Record<string, string> };
    expect(pkg.scripts['inventory:gaps']).toBe(
      'node scripts/inventory-gaps.mjs'
    );
  });
});
