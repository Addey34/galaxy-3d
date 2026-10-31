import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { allBodies } from '@/config/catalog';
import {
  ARRIVAL_MIN_RADII,
  educArrivalDistance,
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

  describe('arrivée d’un corps en Éduc', () => {
    it('relève un cadrage trop proche, laisse un cadrage lointain', () => {
      // Titan : 4,55 rayons écrits (2,5 pour un rayon de 0,55) -> relevé à 8 rayons.
      expect(educArrivalDistance(2.5, 0.55)).toBeCloseTo(
        ARRIVAL_MIN_RADII * 0.55
      );
      // Europe (10 rayons) et un petit corps (20 rayons) ne bougent pas.
      expect(educArrivalDistance(1.2, 0.12)).toBe(1.2);
      expect(educArrivalDistance(2, 0.1)).toBe(2);
      // Sans rayon exploitable, la valeur de la fiche est gardée.
      expect(educArrivalDistance(3, 0)).toBe(3);
    });

    it('l’arrivée est au-dessus de tous les seuils des couches de surface', () => {
      // Strictement au-dessus, avec une marge : pas d'arrivée pile sur un seuil.
      expect(ARRIVAL_MIN_RADII).toBeGreaterThan(TILE_ENGINE_ENTER_RADII);
      expect(ARRIVAL_MIN_RADII).toBeGreaterThan(GAZETTEER_LOAD_RADII);
      expect(ARRIVAL_MIN_RADII).toBeGreaterThan(SURFACE_PANEL_LOAD_RADII);
      expect(ARRIVAL_MIN_RADII).toBe(9);
    });

    it('chaque corps du catalogue arrive sans mosaïque ni noms posés', () => {
      const tooClose: string[] = [];
      let checked = 0;
      for (const { name, config } of allBodies(CELESTIAL_CONFIG)) {
        const cd = config.cameraDistance;
        if (!cd || !(config.radius > 0)) continue;
        checked++;
        const radii =
          educArrivalDistance(cd.educ, config.radius) / config.radius;
        if (radii < ARRIVAL_MIN_RADII - 1e-9)
          tooClose.push(`${name} ${radii.toFixed(2)}`);
      }
      expect(checked).toBeGreaterThan(60);
      expect(tooClose).toEqual([]);
    });
  });
});
