import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  archiveMatches,
  archivePlanetCount,
  fillPlaceholders,
  parseVisit,
  PLACEHOLDERS,
  pickSystem,
  placeholderValues,
  placeholdersOf,
  VISIT_LOCALES,
  type Formatter,
} from './stellarVisit';
import { groupSystems, systemName, type NeighbourFile } from './neighbours';
import type { ExoplanetFile } from './exoplanets';
import { STELLAR_MOTION_LIMIT_YEARS } from './stellarSpace';
import { STELLAR_VISITS } from '@/registry/stellar-visits';

const ROOT = resolve(import.meta.dirname, '../..');
const read = <T>(file: string): T =>
  JSON.parse(readFileSync(resolve(ROOT, file), 'utf8')) as T;
const neighbours = read<NeighbourFile>('public/assets/sky/neighbours.json');
const exoplanets = read<ExoplanetFile>('public/assets/sky/exoplanets.json');
const systems = groupSystems(neighbours.stars);
const format: Formatter = {
  number: (v, d) => Number(v.toPrecision(d)).toString(),
  fixed: (v, d) => v.toFixed(d),
};
const WORDS = { approaching: 'approaches', receding: 'recedes' };
const visit = STELLAR_VISITS[0]!;

describe('la visite du voisinage solaire : la fiche', () => {
  it('a ses quatre langues partout, les mêmes emplacements dans chaque langue, aucun tiret cadratin', () => {
    for (const v of STELLAR_VISITS) {
      for (const l of VISIT_LOCALES) {
        expect(v.title[l], `${v.id} ${l}`).toBeTruthy();
        expect(v.summary[l]).toBeTruthy();
      }
      v.steps.forEach((step, i) => {
        const reference = new Set(placeholdersOf(step.body.en));
        for (const l of VISIT_LOCALES) {
          for (const text of [step.title[l], step.body[l]]) {
            expect(text, `${v.id}#${i} ${l}`).not.toContain('—');
            for (const name of placeholdersOf(text))
              expect(PLACEHOLDERS as readonly string[], `${name}`).toContain(
                name
              );
          }
          expect(new Set(placeholdersOf(step.body[l])), `${i} ${l}`).toEqual(
            reference
          );
        }
      });
    }
  });

  it('refuse une fiche mal formée au lieu de l’afficher à moitié', () => {
    const good = JSON.parse(JSON.stringify(visit)) as Record<string, unknown>;
    expect(() => parseVisit(good)).not.toThrow();
    const noLang = JSON.parse(JSON.stringify(good)) as {
      steps: { body: Record<string, string> }[];
    };
    delete noLang.steps[0]!.body['pt-BR'];
    expect(() => parseVisit(noLang)).toThrow(/quatre langues/);
    expect(() => parseVisit({ ...good, steps: [] })).toThrow(/aucune étape/);
    const badPick = JSON.parse(JSON.stringify(good)) as {
      steps: { star?: unknown }[];
    };
    badPick.steps[1]!.star = { pick: 'prettiest' };
    expect(() => parseVisit(badPick)).toThrow(/choix d'étoile/);
  });
});

describe('la visite du voisinage solaire : chaque étape contre les données livrées', () => {
  visit.steps.forEach((step, i) => {
    it(`étape ${i} : son étoile existe, ce que le texte suppose est vrai, tout emplacement se remplit`, () => {
      const index = step.star ? pickSystem(systems, step.star) : null;
      if (step.star)
        expect(index, 'étoile introuvable').toBeGreaterThanOrEqual(0);
      const system = index !== null && index >= 0 ? systems[index]! : null;
      const matches = system ? archiveMatches(system, exoplanets.systems) : [];
      const planets = system ? archivePlanetCount(matches) : null;
      if (step.requires?.archivePlanets)
        expect(planets, 'planètes dans l’archive').toBeGreaterThan(0);
      if (step.requires?.memberSpectralPrefix)
        expect(
          system!.members.some((m) =>
            (m[2] ?? '').startsWith(step.requires!.memberSpectralPrefix!)
          ),
          'type spectral supposé'
        ).toBe(true);
      if (step.requires?.radialVelocity)
        expect(
          system!.members.some((m) => m[10] !== null),
          'vitesse radiale publiée'
        ).toBe(true);
      // Le décalage est un pas du curseur (100 ans) dans la fenêtre du mouvement rectiligne.
      const years = step.years ?? 0;
      expect(years % 100).toBe(0);
      expect(Math.abs(years)).toBeLessThanOrEqual(
        STELLAR_MOTION_LIMIT_YEARS - 100
      );
      const values = placeholderValues(
        systems,
        index,
        years,
        format,
        planets,
        2026.9 + years,
        WORDS
      );
      for (const l of VISIT_LOCALES)
        for (const text of [step.title[l], step.body[l]]) {
          const filled = fillPlaceholders(text, values);
          expect(filled, `${l} : emplacement resté vide`).not.toMatch(
            /\{\w+\}/
          );
          // Un emplacement utilisé est REMPLI (une chaîne vide ferait dire « à  années-lumière »).
          for (const name of placeholdersOf(text))
            expect(values[name as keyof typeof values], name).not.toBe('');
        }
    });
  });

  it('les règles désignent ce que les titres annoncent', () => {
    const name = (rule: Parameters<typeof pickSystem>[1]): string =>
      systemName(systems[pickSystem(systems, rule)]!);
    expect(name({ pick: 'nearest' })).toBe('Proxima Centauri');
    expect(name({ pick: 'fastestProperMotion' })).toBe("Barnard's Star");
    expect(name({ pick: 'brightest' })).toBe('Sirius');
    expect(name({ pick: 'fastestRadial' })).toBe("Kapteyn's Star");
    expect(pickSystem(systems, { name: 'no such star' })).toBe(-1);
  });

  it('retrouve chaque hôte connu de l’archive, y compris les étoiles à fort mouvement propre (Barnard : 161″ d’écart d’époque)', () => {
    // Un oracle INDÉPENDANT : les couples (étoile du catalogue, hôte de l'archive) sont écrits à la main.
    const known: Array<[string, string]> = [
      ['Proxima Centauri', 'Proxima Cen'],
      ['Ran', 'eps Eri'],
      ['Gl 71', 'tau Cet'],
      ["Barnard's Star", "Barnard's star"],
      ['Lalande 21185', 'GJ 411'],
      ['Lacaille 9352', 'GJ 887'],
      ['Ross 128', 'Ross 128'],
      ['Gl 876', 'GJ 876'],
      ['Wolf 1061', 'Wolf 1061'],
    ];
    for (const [star, host] of known) {
      const system = systems[pickSystem(systems, { name: star })]!;
      expect(
        archiveMatches(system, exoplanets.systems).map((m) => m.host),
        star
      ).toContain(host);
    }
    // Barnard : quatre planètes dans l'instantané livré, jamais « aucune ».
    const barnard =
      systems[pickSystem(systems, { pick: 'fastestProperMotion' })]!;
    expect(
      archivePlanetCount(archiveMatches(barnard, exoplanets.systems))
    ).toBeGreaterThan(0);
  });

  it('la correspondance adaptative est sans ambiguïté : un hôte de l’archive n’est reconnu que par UN système', () => {
    const owners = new Map<string, number[]>();
    systems.forEach((system, i) => {
      for (const match of archiveMatches(system, exoplanets.systems))
        owners.set(match.host, [...(owners.get(match.host) ?? []), i]);
    });
    expect(owners.size, 'au moins les hôtes connus').toBeGreaterThanOrEqual(20);
    for (const [host, ids] of owners)
      expect(
        ids,
        `hôte « ${host} » reconnu par ${ids.length} systèmes`
      ).toHaveLength(1);
    // Un système peut en revanche porter plusieurs hôtes (les deux composantes d'un couple, chacune avec ses
    // planètes) : ils sont comptés ensemble, et jamais deux fois.
    for (const system of systems) {
      const hosts = archiveMatches(system, exoplanets.systems).map(
        (m) => m.host
      );
      expect(new Set(hosts).size).toBe(hosts.length);
    }
  });

  it('les écarts de distance entre l’archive et le catalogue des voisines sont CONNUS, et nommés', () => {
    // L'archive donne à ces trois hôtes une distance (`sy_dist`, relue telle quelle dans le CSV de l'instantané du
    // 2026-11-03 : 5,675773, 5,921535 et 6,84 pc) qui diverge du catalogue des voisines (2,55, 3,79 et 3,52 pc, Gaia DR3).
    // La visite n'affiche JAMAIS la distance de l'archive ; ce test fait remarquer tout NOUVEL écart.
    const KNOWN = new Set(['GJ 411', 'GJ 273', 'Gl 725 B']);
    const unexpected: string[] = [];
    for (const system of systems)
      for (const match of archiveMatches(system, exoplanets.systems)) {
        const host = exoplanets.systems.find((e) => e[0] === match.host)!;
        const nearest = Math.min(...system.members.map((m) => m[5]));
        const farthest = Math.max(...system.members.map((m) => m[5]));
        if (
          host[3] !== null &&
          (host[3] < nearest * 0.9 || host[3] > farthest * 1.1) &&
          !KNOWN.has(match.host)
        )
          unexpected.push(`${match.host} : ${host[3]} pc`);
      }
    expect(unexpected).toEqual([]);
    for (const host of KNOWN) {
      const entry = exoplanets.systems.find((e) => e[0] === host)!;
      expect(entry[3], host).toBeGreaterThan(5);
    }
  });

  it('la correspondance avec l’archive ne se fait pas par le nom : même direction et même distance', () => {
    const proxima = systems[pickSystem(systems, { pick: 'nearest' })]!;
    const found = archiveMatches(proxima, exoplanets.systems);
    expect(found.map((m) => m.host)).toEqual(['Proxima Cen']);
    expect(archivePlanetCount(found)).toBe(found[0]!.planets.length);
    // Une étoile dont aucun hôte de l'archive n'a ni cette direction ni cette distance n'a PAS de planète.
    const sirius = systems[pickSystem(systems, { pick: 'brightest' })]!;
    expect(archiveMatches(sirius, exoplanets.systems)).toEqual([]);
  });
});
