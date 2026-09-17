import { describe, expect, it } from 'vitest';
import summaryJson from '@/config/horizons-validation-summary.json';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { allBodies } from '@/config/catalog';
import {
  measuredErrorAt,
  measuredWindows,
  positionProduct,
  SUMMARY_PROVIDER,
  type AccuracyRow,
  type PositionSource,
} from './positionProvenance';
import { classifyTemporal } from './temporal';

const ROWS = (summaryJson as { rows: AccuracyRow[] }).rows;
const NOW = new Date('2026-09-17T12:00:00Z');
const at = (iso: string): Date => new Date(iso);

function categoryAt(
  body: string,
  source: PositionSource,
  relative: boolean,
  date: Date
): string {
  const windows = measuredWindows(ROWS, body, source, relative);
  return classifyTemporal(positionProduct(source, date, windows), date, NOW)
    .category;
}

describe('measuredWindows', () => {
  it('ne mélange JAMAIS les repères : une lune est jugée autour de son parent', () => {
    // La Lune : ~11 km relatifs à la Terre, ~900 km en héliocentrique (l'erreur de la Terre).
    const relative = measuredWindows(ROWS, 'moon', 'astronomy-engine', true);
    expect(relative.length).toBeGreaterThan(0);
    expect(measuredWindows(ROWS, 'moon', 'astronomy-engine', false)).toEqual(
      []
    );
    for (const w of relative) expect(w.meanKm).toBeLessThan(100);
  });

  it('ignore les lignes sans mesure (couverture nulle)', () => {
    // SPK n'est pas activé en production : ses lignes existent avec n = 0.
    expect(ROWS.some((r) => r.provider === 'spk' && r.n === 0)).toBe(true);
    expect(measuredWindows(ROWS, 'saturn', 'spk', false)).toEqual([]);
  });

  it('sépare les sources : le binaire de Cérès n’est pas son repli képlérien', () => {
    const binary = measuredWindows(ROWS, 'ceres', 'horizons', false);
    const kepler = measuredWindows(ROWS, 'ceres', 'kepler', false);
    expect(binary).toHaveLength(1);
    expect(binary[0].meanKm).toBeLessThan(10);
    expect(Math.min(...kepler.map((w) => w.meanKm))).toBeGreaterThan(1e5);
  });
});

describe('measuredErrorAt', () => {
  it('retient la fenêtre la plus ÉTROITE qui contient la date', () => {
    const windows = measuredWindows(ROWS, 'hygiea', 'kepler', false);
    // 1990-2010 (±10 ans autour de l'époque) décrit 2000 mieux que 1900-2100 ou 1600-2400.
    const near = measuredErrorAt(windows, at('2000-06-01T00:00:00Z'));
    const far = measuredErrorAt(windows, at('2090-01-01T00:00:00Z'));
    expect(near).not.toBeNull();
    expect(far).not.toBeNull();
    expect(near!.meanKm).toBeLessThan(far!.meanKm);
    expect(new Date(near!.from).getUTCFullYear()).toBe(1990);
  });

  it('renvoie null hors de toute fenêtre mesurée', () => {
    const windows = measuredWindows(ROWS, 'hygiea', 'kepler', false);
    expect(measuredErrorAt(windows, at('2500-01-01T00:00:00Z'))).toBeNull();
  });
});

describe('positionProduct', () => {
  it('un binaire Horizons n’est jamais « extrapolé » : hors couverture, il ne répond pas', () => {
    // Même en 2500, si c'est le binaire qui a répondu, la catégorie reste une prédiction.
    expect(
      categoryAt('ceres', 'horizons', false, at('2500-01-01T00:00:00Z'))
    ).toBe('predicted');
  });

  it('une source à couverture infinie devient extrapolée hors des fenêtres mesurées', () => {
    // Encelade en repli képlérien : mesuré jusqu'en 2199, plus rien après.
    expect(
      categoryAt('enceladus', 'kepler', true, at('2150-01-01T00:00:00Z'))
    ).toBe('predicted');
    expect(
      categoryAt('enceladus', 'kepler', true, at('2300-01-01T00:00:00Z'))
    ).toBe('extrapolated');
    // Passé lointain : jamais présenté comme une reconstruction.
    expect(
      categoryAt('enceladus', 'kepler', true, at('1500-01-01T00:00:00Z'))
    ).toBe('extrapolated');
  });

  it('aucune mesure du tout → extrapolé, jamais « prédit » par défaut', () => {
    expect(categoryAt('corps-inconnu', 'kepler', false, NOW)).toBe(
      'extrapolated'
    );
  });

  it('une date passée mesurée est reconstruite, le présent est en direct', () => {
    expect(
      categoryAt('ceres', 'horizons', false, at('1950-01-01T00:00:00Z'))
    ).toBe('reconstructed');
    expect(categoryAt('ceres', 'horizons', false, NOW)).toBe('live');
  });
});

describe('couverture déclarée par source', () => {
  it('les noms de source du résumé sont ceux que ce module interroge', () => {
    const inSummary = new Set(ROWS.map((r) => r.provider));
    for (const provider of Object.values(SUMMARY_PROVIDER))
      expect(inSummary).toContain(provider);
  });

  /**
   * Garde de couverture : tout corps du catalogue qui peut être placé par une source à
   * couverture infinie (astronomy-engine, éléments képlériens) doit avoir une fenêtre mesurée
   * autour d'aujourd'hui. Sans elle, la fiche annoncerait « extrapolé » à la date par défaut,
   * ce qui serait honnête mais signalerait surtout une mesure manquante : ajouter un corps
   * impose de relancer `pnpm ephemeris:validate`.
   */
  it('chaque corps positionné par un calcul a une fenêtre mesurée à la date du jour', () => {
    const missing: string[] = [];
    for (const { name, config: cfg, parentName } of allBodies(
      CELESTIAL_CONFIG
    )) {
      if (cfg.kind === 'skybox' || cfg.kind === 'star') continue;
      const relative = cfg.frame === 'parentRelative';
      const sources: PositionSource[] = [];
      // astronomy-engine ne place un satellite que s'il porte son enum ou s'il est galiléen ;
      // `horizonsParentRelative` désigne un binaire, pas une source astronomy-engine.
      if (
        cfg.astroBody !== undefined ||
        cfg.relativeEphemeris?.kind === 'jupiterMoon'
      )
        sources.push('astronomy-engine');
      if (cfg.orbitalElements || cfg.relativeOrbitalElements)
        sources.push('kepler');
      for (const source of sources) {
        const windows = measuredWindows(ROWS, name, source, relative);
        if (!measuredErrorAt(windows, NOW))
          missing.push(`${name} (${source}${parentName ? ', relatif' : ''})`);
      }
    }
    expect(missing).toEqual([]);
  });
});
