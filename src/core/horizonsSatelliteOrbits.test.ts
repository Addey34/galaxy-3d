import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { forEachBody } from '@/config/catalog';
import {
  horizonsManifest,
  horizonsServiceFromDisk,
} from './horizonsTestFixture';

/**
 * ORBITES DES SATELLITES, lues sur les fichiers Horizons RÉELLEMENT LIVRÉS.
 *
 * Les autres tests d'orbite travaillent sur le repli képlérien du catalogue ; celui-ci lit
 * `public/assets/ephemerides/*.bin`, c'est-à-dire exactement ce que voit l'utilisateur.
 *
 * Défaut réellement livré, mesuré ici corps par corps. Le manifeste échantillonne TOUS les
 * corps au même pas (`stepDays: 4`), alors que 22 des 24 satellites du catalogue ont une
 * période inférieure à 32 jours. L'interpolation de Hermite entre deux échantillons suppose
 * un mouvement lisse sur l'intervalle : quand le corps y fait plusieurs tours, elle ne
 * reconstruit rien. Avant correction, angle balayé sur une période orbitale (360° attendus) :
 * Phobos 2°, Mimas 17°, Protée 18°, Deimos 27°, Amalthée 55°, Téthys 59°, Miranda 82°,
 * Encelade 101°, Dioné 141°, Umbriel 144°, Ariel 158°, Rhéa 210° — et le rayon d'Encelade
 * variait d'un facteur 11,4, celui de Triton de 2,75, celui de Charon de 1,92.
 *
 * Ce que le test vérifie, et pourquoi c'est non circulaire : la période attendue vient du
 * CATALOGUE (`realData.orbitPeriodDays`, valeur publiée), la trajectoire vient des FICHIERS
 * HORIZONS. Deux sources sans rien en commun. Qu'un satellite boucle exactement un tour
 * dans le temps que lui donne le catalogue ne peut pas arriver par accident.
 *
 * Portée : ce fichier lit les binaires committés. Il tombera légitimement si un futur
 * `pnpm ephemeris:generate` change le pas ou la couverture — c'est le but, ces fichiers
 * font partie du produit.
 */

const DATE = new Date('2026-03-15T00:00:00Z');

const satellites: { name: string; parent: string; period: number }[] = [];
forEachBody(CELESTIAL_CONFIG, ({ name, config, parentName }) => {
  const period = config.realData?.orbitPeriodDays;
  if (parentName === null || !period) return;
  if (!(name in horizonsManifest.bodies)) return;
  satellites.push({ name, parent: parentName, period });
});

describe('orbites des satellites sur les binaires Horizons livrés', () => {
  const service = horizonsServiceFromDisk();

  it('couvre bien les satellites qui ont un binaire', () => {
    expect(satellites.length).toBeGreaterThanOrEqual(18);
  });

  for (const { name, parent, period } of satellites) {
    it(`${name} boucle un tour autour de ${parent} en ${period.toFixed(2)} j`, () => {
      const steps = 720;
      let swept = 0;
      let radiusMin = Infinity;
      let radiusMax = 0;
      let previous: THREE.Vector3 | null = null;

      for (let i = 0; i <= steps; i++) {
        const date = new Date(
          DATE.getTime() + (i / steps) * period * 86_400_000
        );
        const position = service.getParentRelativeAU(name, parent, date);
        expect(position, `${name} : position absente`).not.toBeNull();
        const radius = position!.length();
        radiusMin = Math.min(radiusMin, radius);
        radiusMax = Math.max(radiusMax, radius);
        if (previous) swept += previous.angleTo(position!);
        previous = position!;
      }

      // Un tour complet sur une période catalogue. La marge couvre l'écart entre période
      // sidérale publiée et période osculatrice du jour, plus la discrétisation en 720 pas.
      const sweptDeg = swept * (180 / Math.PI);
      expect(sweptDeg, `${name} : angle balayé`).toBeGreaterThan(352);
      expect(sweptDeg, `${name} : angle balayé`).toBeLessThan(368);
    });
  }

  /**
   * Une orbite quasi circulaire doit RESTER quasi circulaire. C'est la formulation directe
   * du symptôme visible — « certaines orbites ne sont pas rondes » — et elle sépare bien
   * l'excentricité réelle (Néréide, e = 0,75) du repliement d'interpolation.
   *
   * Le seuil tient compte de deux effets physiques réels qui ne sont pas des défauts :
   * l'excentricité propre du satellite, et le balancement de la planète autour du
   * barycentre du système (~3,6 % pour les lunes de Pluton, dont la planète est loin d'être
   * immobile face à Charon).
   */
  const NEARLY_CIRCULAR = satellites.filter(
    ({ name }) => name !== 'nereid' && name !== 'hyperion'
  );

  for (const { name, parent, period } of NEARLY_CIRCULAR) {
    it(`${name} garde un rayon quasi constant autour de ${parent}`, () => {
      let radiusMin = Infinity;
      let radiusMax = 0;
      for (let i = 0; i <= 720; i++) {
        const date = new Date(DATE.getTime() + (i / 720) * period * 86_400_000);
        const position = service.getParentRelativeAU(name, parent, date)!;
        const radius = position.length();
        radiusMin = Math.min(radiusMin, radius);
        radiusMax = Math.max(radiusMax, radius);
      }
      expect(
        radiusMax / radiusMin,
        `${name} : variation de rayon sur une orbite`
      ).toBeLessThan(1.12);
    });
  }
});
