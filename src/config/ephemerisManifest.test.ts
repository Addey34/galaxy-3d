import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { allBodies } from './catalog';
import { CELESTIAL_CONFIG } from './bodies';
import { SMALL_BODIES } from './smallBodies';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MANIFEST_PATH = join(
  PROJECT_ROOT,
  'public/assets/ephemerides/manifest.json'
);

interface ManifestBody {
  center?: string;
}

/**
 * Régression pour un bug réel : un manifeste généré par une version périmée du script
 * (avant l'ajout de `center: body.center` dans `scripts/generate-horizons-ephemerides.mjs`)
 * fait silencieusement retomber CHAQUE lune sur la propagation képlérienne (moins précise)
 * — `HorizonsEphemerisService.getParentRelativeAU` n'emprunte son chemin précis que si
 * `manifest.bodies[nom].center` correspond au nom catalogue du parent. Les .bin sont alors
 * présents sur disque, corrects, mais silencieusement inutilisés : rien ne plante, rien ne
 * log, la régression n'est visible qu'en comparant les positions à l'éphéméride publiée.
 * Ce test échoue bruyamment si `pnpm ephemeris:generate` n'a pas été relancé après un
 * changement du script, ou si le manifeste committé a divergé du catalogue.
 */
describe('ephemerides manifest ↔ catalogue', () => {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
    bodies: Record<string, ManifestBody>;
  };

  const parentRelativeBodies = [
    ...allBodies(CELESTIAL_CONFIG),
    ...allBodies({ bodies: SMALL_BODIES }),
  ].filter(
    ({ config }) =>
      config.frame === 'parentRelative' &&
      config.relativeEphemeris?.kind === 'horizonsParentRelative'
  );

  it('has at least one parentRelative body declaring horizonsParentRelative', () => {
    expect(parentRelativeBodies.length).toBeGreaterThan(0);
  });

  it.each(parentRelativeBodies.map((b) => [b.name, b.parentName] as const))(
    'manifest entry for "%s" (if present) declares its real parent "%s" as center',
    (name, parentName) => {
      const entry = manifest.bodies[name];
      // Le fichier local est optionnel : `getParentRelativeAU` retombe sur Kepler quand il
      // manque. Mais s'il EST présent, son `center` doit matcher le parent catalogue, sinon
      // le chemin précis reste mort en silence (le bug qui a motivé ce test).
      if (!entry) return;
      expect(entry.center, `${name}.center in manifest.json`).toBe(parentName);
    }
  );
});
