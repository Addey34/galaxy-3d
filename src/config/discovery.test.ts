import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { DiscoveryClaim, SatelliteDiscovery } from '@/core/discovery';

/**
 * LA DÉCOUVERTE LIVRÉE (lot 44) : ce qui est sur le disque tient les quatre choses que la mesure
 * a dites de ces sources, et la parité du catalogue.
 *
 * `pnpm discovery:generate --check` dit si un fichier a dérivé de sa source, mais il demande le
 * réseau ou un cache. Cette garde vérifie ce qu'aucune régénération ne verrait : qu'un corps
 * ajouté sans relancer le générateur fait rougir, que les désaccords restent publiés, et que le
 * compte de la table concorde avec celui que la fiche affiche déjà.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = join(ROOT, 'public/assets/discovery');
const ENTITIES = join(ROOT, 'src/registry/entities');

interface Index {
  sources: Record<string, { url: string }>;
  bodies: Record<
    string,
    { claims: DiscoveryClaim[] } | { notApplicable: true }
  >;
  systems: Record<
    string,
    {
      source: string;
      url: string;
      total: number;
      bytes: number;
      retrieved: string;
      unconfirmed?: SatelliteDiscovery[];
    }
  >;
}

const index = JSON.parse(
  readFileSync(join(ROOT, 'src/config/discoveryIndex.json'), 'utf-8')
) as Index;
const targets = JSON.parse(
  readFileSync(join(ROOT, 'scripts/discovery-targets.json'), 'utf-8')
) as {
  notApplicable: Record<string, string>;
  satellitesNotCovered: Record<string, string>;
};
const snapshot = JSON.parse(
  readFileSync(join(ROOT, 'src/config/factSources.snapshot.json'), 'utf-8')
) as {
  nasaMoonCounts: Record<string, { moonCount: number }>;
  nssdca: { bodies: Record<string, { moonCount?: number }> };
  sbdb: Record<string, { retrieved: string; confirmedSatellites: number }>;
};

interface Fiche {
  id: string;
  targetClass: string;
  config?: { satellites?: string[] };
  elements?: { satellites?: string[] };
  facts?: { moonCount?: { value?: number; source?: string } };
}
const fiches = readdirSync(ENTITIES)
  .filter((f) => f.endsWith('.json') && f !== 'order.json')
  .map((f) => JSON.parse(readFileSync(join(ENTITIES, f), 'utf-8')) as Fiche)
  .filter((f) => f.targetClass !== 'sky');

const claimsOf = (body: string): DiscoveryClaim[] => {
  const entry = index.bodies[body];
  if (!entry || !('claims' in entry))
    throw new Error(`${body} sans affirmation`);
  return entry.claims;
};
const systemOf = (body: string): SatelliteDiscovery[] =>
  JSON.parse(
    readFileSync(join(DIR, `${body}.json`), 'utf-8')
  ) as SatelliteDiscovery[];

describe('découverte livrée', () => {
  it('couvre CHAQUE corps du catalogue, par des affirmations ou une raison écrite', () => {
    expect(Object.keys(index.bodies).sort()).toEqual(
      fiches.map((f) => f.id).sort()
    );
    for (const [body, entry] of Object.entries(index.bodies)) {
      if ('notApplicable' in entry)
        expect(targets.notApplicable[body], body).toMatch(/^.{40,}$/);
      else expect(entry.claims.length, body).toBeGreaterThan(0);
    }
  });

  it('date CHAQUE affirmation par sa lecture, jamais par la date déclarée de la page', () => {
    for (const [body, entry] of Object.entries(index.bodies)) {
      if (!('claims' in entry)) continue;
      for (const claim of entry.claims) {
        expect(claim.retrieved, body).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        // La page du JPL se dit à jour du 2023-05-23 et recense une lune de 2025 (mesuré le
        // 2026-10-01) : cette date-là ne date rien, et ne doit jamais être publiée.
        expect(claim.retrieved, body).not.toBe('2023-05-23');
        expect(claim.url, body).toMatch(/^https:\/\//);
      }
    }
  });

  it('place CHAQUE lune du catalogue dans la section de son parent', () => {
    for (const parent of Object.keys(index.systems)) {
      const fiche = fiches.find((f) => f.id === parent)!;
      const moons =
        fiche.config?.satellites ?? fiche.elements?.satellites ?? [];
      const tagged = systemOf(parent)
        .filter((s) => s.body)
        .map((s) => s.body)
        .sort();
      expect(tagged, parent).toEqual([...moons].sort());
      for (const moon of moons)
        expect(claimsOf(moon)[0]!.form, moon).toBe('years');
    }
  });

  /**
   * LE COMPTE DE LA LISTE EST CELUI QUE LA FICHE AFFICHE DÉJÀ. La fiche d'un corps montre son
   * nombre de lunes (NASA Science, le NSSDCA ou SBDB) ; le bloc « Découverte » écrit « sur les N
   * que recense le JPL ». Deux nombres différents sur une même fiche seraient une contradiction
   * visible : la garde l'exige égal au nombre que la FICHE publie, et le jour où l'une des
   * sources avance sans l'autre, elle rougit et oblige à relire les deux.
   */
  it('recense exactement le nombre de lunes que la fiche affiche déjà', () => {
    for (const [parent, system] of Object.entries(index.systems)) {
      const shown = fiches.find((f) => f.id === parent)?.facts?.moonCount
        ?.value;
      expect(shown, parent).toBeTypeOf('number');
      expect(system.total, parent).toBe(shown);
      expect(systemOf(parent).length, parent).toBe(system.total);
    }
    // Et le relevé des sources dit la même chose que la fiche (le lot 44 le tenait ainsi).
    for (const [parent, system] of Object.entries(index.systems)) {
      if (system.source !== 'jpl-sats') continue;
      expect(
        snapshot.nasaMoonCounts[parent]?.moonCount ??
          snapshot.nssdca.bodies[parent]?.moonCount,
        parent
      ).toBe(system.total);
    }
  });

  /**
   * LIGNE 22.10, PAS 2 (2026-10-02). Tout corps dont la fiche affiche au moins une lune a la liste
   * de ses satellites, ou une raison écrite. La liste des corps n'est écrite nulle part : un corps
   * ajouté avec une lune et sans liste rougit ici.
   */
  it('donne sa liste de satellites à CHAQUE corps qui affiche une lune, ou une raison écrite', () => {
    const withMoons = fiches
      .filter((f) => (f.facts?.moonCount?.value ?? 0) > 0)
      .map((f) => f.id)
      .sort();
    for (const id of withMoons) {
      const covered = id in index.systems;
      const reason = targets.satellitesNotCovered[id];
      expect(covered !== Boolean(reason), `${id} : liste XOR raison`).toBe(
        true
      );
      if (reason) expect(reason, id).toMatch(/^.{40,}$/);
    }
    // Bornes : les deux sources sont exercées, et la raison écrite aussi.
    const sources = new Set(Object.values(index.systems).map((s) => s.source));
    expect([...sources].sort()).toEqual(['jpl-sats', 'sbdb']);
    expect(Object.keys(targets.satellitesNotCovered)).toEqual(['earth']);
    expect(Object.keys(index.systems).sort()).toEqual(
      withMoons.filter((id) => !targets.satellitesNotCovered[id])
    );
  });

  /**
   * La liste SBDB d'un petit corps est lue dans la MÊME réponse que le compte de sa fiche (même
   * requête que le relevé des faits, même cache) : sa date de lecture est donc celle du relevé.
   * Deux dates différentes voudraient dire deux lectures, qui pourraient se contredire.
   */
  it('lit la liste SBDB dans la réponse même qui donne le compte de la fiche', () => {
    const sbdbSystems = Object.entries(index.systems).filter(
      ([, s]) => s.source === 'sbdb'
    );
    expect(sbdbSystems.length).toBeGreaterThan(0);
    for (const [body, system] of sbdbSystems) {
      expect(system.retrieved, body).toBe(snapshot.sbdb[body]?.retrieved);
      expect(system.total, body).toBe(snapshot.sbdb[body]?.confirmedSatellites);
      expect(system.url, body).toMatch(
        /^https:\/\/ssd\.jpl\.nasa\.gov\/tools\/sbdb_lookup\.html#/
      );
    }
  });

  it('nomme un satellite sans nom UAI par sa désignation provisoire (Makémaké)', () => {
    // SBDB rend `iau_name: ""` (une chaîne VIDE, pas `null`) pour la lune de Makémaké : un nom
    // vide aurait donné une ligne sans nom sur la fiche.
    const [moon] = systemOf('makemake');
    expect(moon?.name).toBe('S/2015 (136472) 1');
    for (const parent of Object.keys(index.systems))
      for (const s of systemOf(parent)) expect(s.name, parent).not.toBe('');
  });

  it('date Dactyl de sa DÉCOUVERTE (1993), pas de sa publication (1994)', () => {
    const [dactyl] = systemOf('ida');
    expect(dactyl?.name).toBe('Dactyl');
    expect(dactyl?.years).toEqual([1993]);
    expect(dactyl?.ref).toMatch(/1994/);
  });

  it('publie les deux années d’une ligne qui en porte deux, sans en choisir une', () => {
    const saturn = systemOf('saturn');
    expect(saturn.find((s) => s.name === 'Janus')?.years).toEqual([1966, 1980]);
    expect(saturn.find((s) => s.name === 'Epimetheus')?.years).toEqual([
      1977, 1980,
    ]);
    expect(
      systemOf('jupiter').find((s) => s.name === 'Themisto')?.years
    ).toEqual([1975, 2000]);
  });

  it('publie les DEUX dates de Pluton, qui divergent selon la source', () => {
    const days = claimsOf('pluto')
      .filter((c) => c.form === 'day')
      .map((c) => `${c.source}:${c.form === 'day' ? c.day : ''}`)
      .sort();
    expect(days).toEqual(['nssdca:1930-02-18', 'sbdb:1930-01-23']);
  });

  /**
   * SBDB fait « découvrir » Halley en 1758 ; NASA Science, citée mot pour mot, dit que c'est le
   * retour que Halley avait prédit, et que la comète est rattachée à des observations de plus de
   * deux mille ans. Livrer la date nue publierait une découverte fausse pour tout lecteur.
   */
  it('requalifie la date de Halley en retour prédit, et la rattache à l’Antiquité', () => {
    const claims = claimsOf('halley');
    const sbdb = claims.find((c) => c.source === 'sbdb');
    expect(sbdb?.form === 'day' && sbdb.role).toBe('predictedReturn');
    expect(claims.some((c) => c.form === 'ancientObservations')).toBe(true);
  });

  it('écrit le système de chaque parent et rien d’autre', () => {
    const files = readdirSync(DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5))
      .sort();
    expect(files).toEqual(Object.keys(index.systems).sort());
  });
});
