import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import snapshot from './factSources.snapshot.json';
import index from './atmosphereProfileIndex.json';
import {
  adjustedBelowKm,
  profileRows,
  type AtmosphereProfile,
} from '@/core/atmosphereProfile';
import { formatPressure } from '@/ui/atmosphereBlock';

/**
 * LE PROFIL MESURÉ DE JUPITER, tel qu'il est LIVRÉ (lot 51, pas 3), écrit par
 * `pnpm atmosphere:generate` depuis le paquet PDS4 de la sonde Galileo.
 *
 * Les TÉMOINS viennent d'une source indépendante : la fiche du NSSDCA donne 165 K à 1 bar et
 * 112 K à 0,1 bar, et la sonde 166 K et 112,6 K (mesuré le 2026-10-15). Deux sources qui
 * s'accordent à un kelvin près, c'est ce qui dit que les colonnes ont été lues dans le bon ordre
 * et l'unité de pression convertie : une pression laissée en millibars placerait « 0,1 bar » à
 * 100 bar, hors du profil, et ce test rougirait.
 */
const profile = JSON.parse(
  readFileSync(
    resolve(
      import.meta.dirname,
      '../../public/assets/atmosphere-profiles/jupiter.json'
    ),
    'utf-8'
  )
) as AtmosphereProfile;
const sheet = (
  snapshot.nssdca.bodies as unknown as Record<
    string,
    { atmosphere?: { temperature1BarK: number; temperature01BarK: number } }
  >
).jupiter!.atmosphere!;

describe('le profil de la sonde Galileo, livré', () => {
  const rows = profileRows(profile);
  const near = (bar: number) =>
    rows.reduce((a, b) =>
      Math.abs(Math.log10(b.pressureBar / bar)) <
      Math.abs(Math.log10(a.pressureBar / bar))
        ? b
        : a
    );

  it('s’accorde à la fiche du NSSDCA à 1 et à 0,1 bar, à deux kelvins près', () => {
    expect(near(1).altitudeKm).toBe(0);
    expect(
      Math.abs(near(1).temperatureK - sheet.temperature1BarK)
    ).toBeLessThanOrEqual(2);
    expect(
      Math.abs(near(0.1).temperatureK - sheet.temperature01BarK)
    ).toBeLessThanOrEqual(2);
  });

  it('ne montre que des échantillons PUBLIÉS, du plus haut au plus bas', () => {
    const published = new Set(
      profile.segments.flatMap((s) => s.samples.map((x) => x.join()))
    );
    for (const row of rows)
      expect(
        published.has(
          [row.altitudeKm, row.pressureBar, row.temperatureK].join()
        )
      ).toBe(true);
    const altitudes = rows.map((r) => r.altitudeKm);
    expect(altitudes).toEqual([...altitudes].sort((a, b) => b - a));
    expect(altitudes[0]).toBeGreaterThan(1000);
    expect(altitudes.at(-1)).toBeLessThan(-130);
  });

  it('dit la descente AJUSTÉE, avec la phrase de la source, et date l’entrée par son étiquette', () => {
    const descent = profile.segments.find((s) => s.kind === 'descent')!;
    expect(descent.method).toMatch(/not a list of measured points/);
    expect(adjustedBelowKm(profile)).toBe(
      Math.max(...descent.samples.map((s) => s[0]))
    );
    const entry = profile.segments.find((s) => s.kind === 'entry')!;
    expect(entry.start).toMatch(/^1995-12-07T/);
    // L'étiquette de la descente déclare son temps inconnu : il n'est pas complété.
    expect(descent.start).toBeNull();
  });

  it('cite le paquet par son DOI, et l’article de l’équipe tel que l’archive l’écrit', () => {
    expect(profile.bundle.doi).toMatch(/^10\.17189\//);
    expect(profile.reference.text).toMatch(/^Seiff, A\./);
    expect(profile.reference.text).toContain('hot spot');
  });
});

describe('l’index des profils', () => {
  it('compte exactement les échantillons livrés', () => {
    expect(index.profiles.jupiter.samples).toBe(
      profile.segments.reduce((n, s) => n + s.samples.length, 0)
    );
  });

  it('couvre chaque géante du relevé : un profil, ou la mesure de son absence', () => {
    const giants = Object.entries(
      snapshot.nssdca.bodies as unknown as Record<
        string,
        { surfacePressure?: { lowerBound?: boolean } }
      >
    )
      .filter(([, b]) => b.surfacePressure?.lowerBound === true)
      .map(([id]) => id)
      .sort();
    expect(
      [
        ...Object.keys(index.profiles).filter((id) => id !== 'titan'),
        ...Object.keys(index.absent),
      ].sort()
    ).toEqual(giants);
    expect(index.witness.jupiter).toBe('urn:nasa:pds:gp:data_asi');
  });
});

/**
 * LE PROFIL DE TITAN, tel qu'il est LIVRÉ (2026-10-28) : HASI, l'instrument de la sonde Huygens.
 * Le point de surface vient d'AUTRES tables (PPI pour la pression, TEM pour la température) que
 * les profils (`PROFILES`) : le dernier échantillon de la descente, à quelques mètres du sol, est
 * donc un TÉMOIN indépendant de la conversion des pascals en bars et de l'ordre des colonnes.
 */
const titan = JSON.parse(
  readFileSync(
    resolve(
      import.meta.dirname,
      '../../public/assets/atmosphere-profiles/titan.json'
    ),
    'utf-8'
  )
) as AtmosphereProfile;

describe('le profil de la sonde Huygens, livré', () => {
  const descent = titan.segments.find((s) => s.kind === 'descent')!;
  const lowest = descent.samples.at(-1)!;
  const surface = titan.surface!;

  it('compte l’altitude depuis le sol, et le dit', () => {
    expect(titan.altitudeReference).toBe('surface');
    expect(surface.altitudeKm).toBe(0);
    expect(
      titan.segments.find((s) => s.kind === 'entry')!.samples[0]![0]
    ).toBeGreaterThan(1000);
  });

  it('place le sol là où la descente s’arrête, sur deux tables indépendantes', () => {
    // Le dernier échantillon de la descente est à quelques mètres du sol : même pression à 0,2 %,
    // même température à un kelvin. Une pression laissée en pascals serait 100 000 fois trop haute.
    expect(lowest[0]).toBeLessThan(0.01);
    expect(Math.abs(lowest[1] / surface.pressureBar - 1)).toBeLessThan(0.002);
    expect(Math.abs(lowest[2] - surface.temperatureK)).toBeLessThan(1);
    expect(surface.pressureBar).toBeGreaterThan(1.4);
    expect(surface.pressureBar).toBeLessThan(1.5);
  });

  it('garde la dispersion des lectures au sol, sans la lisser', () => {
    expect(surface.pressureRangeBar[0]).toBeLessThanOrEqual(
      surface.pressureBar
    );
    expect(surface.pressureRangeBar[1]).toBeGreaterThanOrEqual(
      surface.pressureBar
    );
    expect(surface.temperatureRangeK[0]).toBeLessThanOrEqual(
      surface.temperatureK
    );
    expect(surface.temperatureRangeK[1]).toBeGreaterThanOrEqual(
      surface.temperatureK
    );
  });

  it('est mesuré de bout en bout : aucune phrase d’ajustement, aucune ligne ajustée', () => {
    expect(adjustedBelowKm(titan)).toBeNull();
    expect(profileRows(titan).some((r) => r.adjusted)).toBe(false);
    const rows = profileRows(titan);
    expect(rows.at(-1)!.kind).toBe('surface');
    expect(rows.at(-1)!.altitudeKm).toBe(0);
  });

  it('place la sonde dans l’hémisphère sud, et cite les deux paquets par leur DOI', () => {
    expect(titan.latitudeDeg.min).toBeLessThan(-10);
    expect(titan.latitudeDeg.max).toBeLessThan(-10);
    expect(titan.bundle.doi).toMatch(/^10\.17189\//);
    expect(titan.latitudeSource?.doi).toMatch(/^10\.17189\//);
    expect(titan.reference.text).toMatch(/^Fulchignoni, M\./);
  });

  it('compte exactement les échantillons livrés', () => {
    expect(index.profiles.titan.samples).toBe(
      titan.segments.reduce((n, s) => n + s.samples.length, 0)
    );
  });

  it('a un TÉMOIN : le registre du PDS rattache HASI à Titan', () => {
    expect(index.titanRegistry.collections).toBeGreaterThan(100);
  });
});

describe('la pression affichée, sur neuf ordres de grandeur', () => {
  it('bar, millibar, puis notation scientifique', () => {
    expect(formatPressure(1.4672)).toMatch(/^1[.,]47\u00a0bar$/);
    // 9,97 × 10⁻⁴ ne s'écrit pas « 10 × 10⁻⁴ » : la mantisse arrondie passe à l'exposant suivant.
    expect(formatPressure(9.97e-4)).toMatch(/^1\u00a0×\u00a010⁻³\u00a0bar$/);
    expect(formatPressure(22.05)).toMatch(/^22[.,]1\u00a0bar$/);
    expect(formatPressure(0.1004)).toMatch(/^100[.,]4\u00a0mbar$/);
    expect(formatPressure(9.665e-10)).toMatch(
      /^9[.,]7\u00a0×\u00a010⁻¹⁰\u00a0bar$/
    );
  });
});
