import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import publication from '../../scripts/static-origin-publication.json';
import surfaceEditions from 'virtual:surface-editions';
import { allBodies, texturePath } from './catalog';
import { CELESTIAL_CONFIG } from './bodies';
import type { TextureResolutions } from '@/types';

/**
 * LA PUBLICATION ADDITIVE DÉCLARÉE (GAL-CATALOG-EXCELLENCE-001), confrontée au dépôt : chaque fichier neuf
 * attendu est dans l'arbre à l'octet près ET demandé par le catalogue ; un fichier gardé en ligne pour le
 * retour arrière n'est plus dans l'arbre (sinon il n'aurait pas besoin d'être gardé) ; aucun chemin n'est
 * dans les deux listes. Le préflight (`scripts/static-origin-publish.mjs`) vérifie le côté en ligne.
 */
const PUBLIC = resolve(process.cwd(), 'public');
const sha256 = (bytes: Buffer): string =>
  createHash('sha256').update(bytes).digest('hex');

/** Les fichiers de texture que le catalogue demande, en chemins publiés. */
function catalogueTextureFiles(): Set<string> {
  const files = new Set<string>();
  for (const { config } of allBodies(CELESTIAL_CONFIG))
    for (const [layer, base] of Object.entries(config.textures ?? {})) {
      const tiers =
        config.textureResolutions[layer as keyof TextureResolutions];
      for (const tier of tiers ?? [])
        files.add(`assets/textures/${base}_${tier}.jpg`);
    }
  for (const [body, cat] of Object.entries(surfaceEditions))
    for (const e of cat.editions)
      for (const tier of e.tiers)
        files.add(
          `assets/textures/${texturePath(body, cat.layer, e.edition)}_${tier}.jpg`
        );
  return files;
}

describe('publication additive sur galaxy-static', () => {
  it('chaque fichier neuf est dans le dépôt, à la taille et au SHA-256 déclarés', () => {
    expect(publication.add.length).toBeGreaterThan(0);
    for (const f of publication.add) {
      const bytes = readFileSync(join(PUBLIC, f.path));
      expect(bytes.length, f.path).toBe(f.bytes);
      expect(sha256(bytes), f.path).toBe(f.sha256);
    }
  });

  it('chaque fichier neuf est demandé par le catalogue ou les éditions du registre', () => {
    const wanted = catalogueTextureFiles();
    for (const f of publication.add)
      expect(wanted.has(f.path), f.path).toBe(true);
  });

  it("un fichier gardé n'est plus dans l'arbre ni demandé par le catalogue", () => {
    const wanted = catalogueTextureFiles();
    for (const f of publication.retain) {
      expect(existsSync(join(PUBLIC, f.path)), f.path).toBe(false);
      expect(wanted.has(f.path), f.path).toBe(false);
    }
  });

  it('aucun chemin dans les deux listes, un commit de retour arrière complet', () => {
    const added = new Set(publication.add.map((f) => f.path));
    for (const f of publication.retain) expect(added.has(f.path)).toBe(false);
    expect(publication.rollback.commit).toMatch(/^[0-9a-f]{40}$/);
  });
});
