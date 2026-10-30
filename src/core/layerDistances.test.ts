import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  GAZETTEER_LOAD_RADII,
  LAYER_DISTANCES,
  RELIEF_TESSELLATION_ENTER_RADII,
  RELIEF_TESSELLATION_EXIT_RADII,
  SKY_LOAD_RADII,
  SURFACE_PANEL_LOAD_RADII,
  TILE_ENGINE_ENTER_RADII,
} from './layerDistances';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * UN PROPRIÉTAIRE POUR LES DISTANCES D'APPARITION (lot D). Deux choses se gardent ici : l'ORDRE
 * (une couche coûteuse ne peut pas se charger avant la couche qui la justifie) et le fait qu'aucun
 * fichier de couche ne redéfinisse son propre seuil en rayons.
 */
describe('distances d’apparition des couches', () => {
  it('le moteur de tuiles n’entre jamais avant son panneau de chargement', () => {
    // Le panneau charge le moteur (8) AVANT que le moteur travaille (6) : sinon le moteur
    // entrerait sans avoir été chargé.
    expect(SURFACE_PANEL_LOAD_RADII).toBeGreaterThanOrEqual(
      TILE_ENGINE_ENTER_RADII
    );
  });

  it('l’hystérésis du relief sort plus haut qu’elle n’entre', () => {
    expect(RELIEF_TESSELLATION_EXIT_RADII).toBeGreaterThan(
      RELIEF_TESSELLATION_ENTER_RADII
    );
  });

  it('chaque couche d’approche se déclenche plus loin que la suivante', () => {
    const order = [
      LAYER_DISTANCES.skyLoadsBelow,
      LAYER_DISTANCES.reliefEntersBelow,
      LAYER_DISTANCES.gazetteerLoadsBelow,
      LAYER_DISTANCES.tileEngineEntersBelow,
      LAYER_DISTANCES.farBaseFrom,
    ];
    for (let i = 1; i < order.length; i++)
      expect(order[i], `rang ${i}`).toBeLessThanOrEqual(order[i - 1]);
  });

  it('valeurs inchangées par le regroupement (mesurées le 2026-10-30)', () => {
    expect(TILE_ENGINE_ENTER_RADII).toBe(6);
    expect(GAZETTEER_LOAD_RADII).toBe(8);
    expect(SURFACE_PANEL_LOAD_RADII).toBe(8);
    expect(SKY_LOAD_RADII).toBe(20);
    expect(RELIEF_TESSELLATION_ENTER_RADII).toBe(12);
    expect(RELIEF_TESSELLATION_EXIT_RADII).toBe(14);
  });

  it('aucun fichier de couche ne redéfinit un seuil en rayons', () => {
    const files = [
      'src/components/surface/PlanetarySurfaceEngine.ts',
      'src/ui/gazetteerOverlay.ts',
      'src/ui/surfacePanel.ts',
      'src/components/celestial/CelestialObject.ts',
      'src/components/celestial/skyApproach.ts',
    ];
    const offenders: string[] = [];
    for (const file of files) {
      const source = ts.createSourceFile(
        file,
        readFileSync(join(ROOT, file), 'utf8'),
        ts.ScriptTarget.Latest,
        true
      );
      const visit = (node: ts.Node): void => {
        if (
          ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          /(_RADII|TESSELLATION_(ENTER|EXIT))$/.test(node.name.text) &&
          node.initializer &&
          ts.isNumericLiteral(node.initializer)
        )
          offenders.push(`${file}: ${node.name.text}`);
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    expect(offenders).toEqual([]);
  });
});
