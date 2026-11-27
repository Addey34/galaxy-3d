import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  epochDistancePc,
  indicativeClass,
  matchesFilter,
  hostOf,
  searchNames,
  shellsFor,
  spectralOf,
  writePositionsAt,
  type VolumeManifest,
  type VolumeNameEntry,
  type VolumeShell,
} from './stellarVolume';
import {
  stellarScenePosition,
  STELLAR_MOTION_LIMIT_YEARS,
} from './stellarSpace';
import type { NeighbourRow } from './neighbours';
import {
  assembleShippedVolume,
  rawVolumeFile,
} from './stellarVolumeTestFixture';

/**
 * LE VOLUME STELLAIRE LIVRÉ (GAL-UNIVERSE-008), relu tel que le client le lit. Les témoins sont d'une
 * autre nature que le calcul : (1) les coordonnées galactiques que les AUTEURS du GCNS publient pour
 * chaque objet (`xcoord_50`…), confrontées à notre rotation ; (2) des distances physiques connues ;
 * (3) le code du voisinage à 5 pc, appliqué à la même étoile.
 */
const volume = assembleShippedVolume();
const manifest: VolumeManifest = volume.assembly.manifest;
const names: Record<string, VolumeNameEntry> = volume.names;
const shells: VolumeShell[] = volume.shells;
const index = volume.index;
/** La coquille et le rang local d'une étoile de rang global. */
const locate = (index: number): { shell: VolumeShell; local: number } => {
  const shell = shells.find(
    (s) => index >= s.start && index < s.start + s.count
  )!;
  return { shell, local: index - shell.start };
};

describe('les fichiers livrés, un dossier par fournisseur', () => {
  it('chaque fichier a la taille et l’empreinte que l’index annonce', () => {
    const P = index.providers;
    const entries = [
      ...P.gcns.shells,
      ...P.gcns.details,
      P.gcnsMissing,
      P.hyg.complement,
      P.hyg.names,
      P.nasa,
      index.crossmatch.structure,
      index.crossmatch.names,
    ];
    for (const f of entries) {
      const b = rawVolumeFile(f.file);
      expect(b.length, f.file).toBe(f.bytes);
      expect(createHash('sha256').update(b).digest('hex'), f.file).toBe(
        f.sha256
      );
    }
  });

  it('les coquilles se suivent, couvrent tout le volume et respectent leur rayon', () => {
    let start = 0;
    let previousMax = 0;
    for (const s of shells) {
      expect(s.start).toBe(start);
      start += s.count;
      for (let i = 0; i < s.count; i++) {
        const d = epochDistancePc(s, i);
        // Quantification de la position : 0,0033 pc par axe.
        expect(d).toBeLessThanOrEqual(s.maxPc + 0.01);
        expect(d).toBeGreaterThanOrEqual(previousMax - 0.01);
      }
      previousMax = s.maxPc;
    }
    expect(start).toBe(manifest.count);
    expect(manifest.count).toBeGreaterThan(300_000);
  });

  it('l’assemblage rend exactement ce que le générateur annonce (comptes par coquille et par origine)', () => {
    expect(manifest.count).toBe(index.expected.count);
    expect(shells.map((s) => s.count)).toEqual(index.expected.perShell);
    for (const key of ['gcns', 'hyg', 'simbad', 'exoplanetHosts'])
      expect(manifest.counts[key], key).toBe(index.expected.counts[key]);
    expect(volume.fromHyg.size).toBe(index.expected.counts['namedByHyg']);
  });

  it('les paquets de détails du GCNS couvrent chaque étoile du GCNS', () => {
    const P = index.providers.gcns;
    const total = P.details.reduce(
      (sum, d) => sum + d.bytes / index.format.detailBytes,
      0
    );
    expect(total).toBe(P.shells.reduce((n, s) => n + s.count, 0));
  });
});

describe('le repère : notre rotation contre les coordonnées galactiques des auteurs du GCNS', () => {
  it.each(manifest.witnesses.gcnsGalactic.map((w) => [w.distPc, w] as const))(
    'à %s pc',
    (_, w) => {
      // Le rang du témoin est celui du GCNS ; l'assemblage le place dans la disposition globale.
      const at = volume.assembly.globalIndexOf(w.index);
      const { shell, local } = locate(at);
      const p = shell.epochPositions;
      // Scène → galactique : X = x, Y = z, Z = −y.
      const galactic = [p[local * 3]!, -p[local * 3 + 2]!, p[local * 3 + 1]!];
      for (let k = 0; k < 3; k++)
        expect(Math.abs(galactic[k]! - w.galacticXyzPc[k]!)).toBeLessThan(0.01);
      const detail = volume.detailOf(at)!;
      expect(detail.sourceId).toBe(w.sourceId);
    }
  );
});

describe('les témoins physiques, retrouvés par leur nom', () => {
  const byName = (name: string): number =>
    Number(Object.entries(names).find(([, e]) => e[0] === name)?.[0] ?? -1);
  it.each(manifest.witnesses.physical.map((w) => [w.name, w] as const))(
    '%s',
    (_, w) => {
      const index = byName(w.name);
      expect(index).toBeGreaterThanOrEqual(0);
      const { shell, local } = locate(index);
      const d = epochDistancePc(shell, local);
      expect(d).toBeGreaterThanOrEqual(w.pc[0]);
      expect(d).toBeLessThanOrEqual(w.pc[1]);
    }
  );

  it('Véga, trop brillante pour Gaia, vient d’Hipparcos et le dit (drapeau HYG, pas d’identifiant Gaia)', () => {
    const index = byName('Vega');
    // Son type spectral est celui que publie HYG ; le GCNS n'en publie pour aucune étoile.
    expect(spectralOf(names[String(index)])).toMatch(/^A0/);
    const { shell, local } = locate(index);
    expect(shell.flags[local]! & manifest.flags.hyg).toBeTruthy();
    const detail = volume.detailOf(index)!;
    expect(detail.sourceId).toBeNull();
  });
});

describe('le mouvement : le même que le voisinage à 5 pc', () => {
  it('une étoile du volume suit le code du voisinage, à la quantification près', () => {
    // Une ligne du voisinage fabriquée avec les valeurs d'Altair (HYG, J2000) : le volume la porte aussi.
    const index = Number(
      Object.entries(names).find(([, e]) => e[0] === 'Altair')![0]
    );
    const { shell, local } = locate(index);
    const at = new Float32Array(shell.count * 3);
    for (const years of [0, 16, 5000, -5000]) {
      writePositionsAt(at, shell, years, manifest.epochYear);
      const d = Math.hypot(
        at[local * 3]!,
        at[local * 3 + 1]!,
        at[local * 3 + 2]!
      );
      expect(d).toBeGreaterThan(4);
      expect(d).toBeLessThan(6.5);
    }
    // À J2016,0 la position écrite est la position publiée.
    writePositionsAt(at, shell, 16, manifest.epochYear);
    expect(at[local * 3]).toBeCloseTo(shell.epochPositions[local * 3]!, 6);
  });

  it('la fenêtre de temps est celle du voisinage : au-delà, la position ne bouge plus', () => {
    const shell = shells[0]!;
    const a = new Float32Array(shell.count * 3);
    const b = new Float32Array(shell.count * 3);
    writePositionsAt(a, shell, STELLAR_MOTION_LIMIT_YEARS, manifest.epochYear);
    writePositionsAt(
      b,
      shell,
      STELLAR_MOTION_LIMIT_YEARS * 3,
      manifest.epochYear
    );
    expect(Array.from(b.subarray(0, 300))).toEqual(
      Array.from(a.subarray(0, 300))
    );
  });

  it('même rotation que le voisinage : une direction connue tombe au même endroit', () => {
    // Le pôle galactique nord (α 192,85948°, δ +27,12825°, IAU 1958) : vers +Y dans les deux vues.
    const row = [
      'pôle',
      '',
      null,
      192.85948,
      27.12825,
      10,
      null,
      0,
      0,
      0,
      null,
      'hyg',
      null,
    ] as unknown as NeighbourRow;
    const p = stellarScenePosition(row, 0);
    expect(p[1]).toBeCloseTo(10, 3);
  });
});

describe('ce que la vue en tire', () => {
  it('les coquilles demandées par chaque échelle', () => {
    expect(shellsFor(5, manifest)).toEqual([]);
    expect(shellsFor(25, manifest)).toEqual([0]);
    expect(shellsFor(50, manifest)).toEqual([0, 1]);
    expect(shellsFor(100, manifest)).toEqual([0, 1, 2]);
  });

  it('les filtres comptent ce que le manifeste annonce', () => {
    const count = (filter: Parameters<typeof matchesFilter>[1]): number =>
      shells.reduce((sum, s) => {
        let n = 0;
        for (let i = 0; i < s.count; i++)
          if (matchesFilter(s.flags[i]!, filter, manifest.flags)) n++;
        return sum + n;
      }, 0);
    expect(count('whiteDwarfs')).toBe(index.expected.counts['whiteDwarf']);
    expect(count('exoplanetHosts')).toBe(manifest.counts['exoplanetHosts']);
    expect(count('radialVelocity')).toBe(
      index.expected.counts['radialVelocity']
    );
    expect(count('all')).toBe(manifest.count);
  });

  it('la couleur reste indicative : une naine blanche probable prend la couleur des naines blanches', () => {
    expect(indicativeClass({ value: 2.5, kind: 'bp-rp' }, false)).toBe('M');
    expect(indicativeClass({ value: 0.82, kind: 'bp-rp' }, false)).toBe('G');
    expect(indicativeClass({ value: 0.65, kind: 'b-v' }, false)).toBe('G');
    expect(indicativeClass(null, false)).toBeNull();
    expect(indicativeClass({ value: 0.1, kind: 'bp-rp' }, true)).toBe('D');
  });

  it('la recherche trouve par préfixe, puis par fragment, la plus proche d’abord', () => {
    const hits = searchNames(names, 'veg');
    expect(names[String(hits[0])]![0]).toBe('Vega');
    expect(searchNames(names, 'x')).toEqual([]);
  });

  it('le nombre de planètes est celui de l’HÔTE, pas du système (55 Cancri : 5 autour de A, 2 autour de B)', () => {
    const byHost = (host: string) =>
      Object.values(names)
        .map(hostOf)
        .find((h) => h?.host === host);
    expect(byHost('55 Cnc')?.planets).toBe(5);
    expect(byHost('55 Cnc B')?.planets).toBe(2);
    expect(byHost('TRAPPIST-1')?.planets).toBe(7);
  });

  it('un hôte d’exoplanètes porte son nom d’hôte et son nombre de planètes', () => {
    const hosts = Object.values(names)
      .map(hostOf)
      .filter((h) => h !== null);
    expect(hosts.length).toBe(manifest.counts['exoplanetHosts']);
    for (const h of hosts) expect(h.planets).toBeGreaterThan(0);
  });
});
