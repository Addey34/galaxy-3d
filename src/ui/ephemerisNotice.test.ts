import { describe, expect, it } from 'vitest';
import { SPACECRAFT_MISSIONS } from '@/config/spacecraft';
import type { EphemerisLoadReport } from '@/core/HorizonsEphemerisService';
import {
  isComplete,
  noticeText,
  spacecraftWithoutPosition,
} from './ephemerisNotice';

/**
 * CE QUE LE BANDEAU DIT, sans DOM. La distinction qui compte : un corps du catalogue dont le
 * fichier manque a un repli (astronomy-engine ou ses éléments), donc une position MOINS
 * PRÉCISE ; une sonde n'en a aucun et reste SANS position. Les confondre ferait dire au
 * bandeau une chose fausse dans les deux sens.
 *
 * Les 3 objets interstellaires ne sont volontairement PAS comptés : ils se propagent depuis
 * leurs éléments hyperboliques (`ui/navigableAnchors`) et n'ont aucun fichier d'éphéméride.
 */
const report = (over: Partial<EphemerisLoadReport>): EphemerisLoadReport => ({
  declared: 64,
  manifestFailed: false,
  loaded: [],
  missing: [],
  retryable: false,
  ...over,
});

const missing = (...bodies: string[]): EphemerisLoadReport['missing'] =>
  bodies.map((body) => ({ body, reason: 'test', retryable: true }));

describe('ephemerisNotice, what it counts', () => {
  it('counts only the spacecraft among the missing files', () => {
    expect(
      spacecraftWithoutPosition(
        report({ missing: missing('mercury', 'juno', 'ceres', 'jwst') })
      )
    ).toBe(2);
  });

  it('counts every mission when the manifest itself never arrived', () => {
    expect(spacecraftWithoutPosition(report({ manifestFailed: true }))).toBe(
      SPACECRAFT_MISSIONS.length
    );
  });

  it('says nothing about spacecraft when none is missing', () => {
    const lines = noticeText(
      report({ loaded: ['mercury'], missing: missing('ceres') })
    );
    expect(lines).toHaveLength(1);
    // Les deux comptes, sans dépendre de la langue : `t()` rend celle de l'environnement, et
    // `setLocale` touche le DOM, absent sous Vitest. Le RENDU des deux langues est relu à
    // l'écran, et `e2e/ephemerisDegraded.spec.ts` vérifie la phrase anglaise entière.
    expect(lines[0]).toMatch(/1[^0-9]+64/);
  });

  it('adds the spacecraft line only when at least one is stranded', () => {
    const lines = noticeText(
      report({ loaded: ['mercury'], missing: missing('ceres', 'juno') })
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('1');
  });

  it('a complete report has nothing to say, and a failed manifest has', () => {
    expect(isComplete(report({ loaded: ['mercury'] }))).toBe(true);
    expect(isComplete(report({ missing: missing('ceres') }))).toBe(false);
    // Le manifeste absent n'a AUCUN fichier manquant à nommer, et reste pourtant un défaut.
    expect(isComplete(report({ manifestFailed: true }))).toBe(false);
  });
});
