import { describe, expect, it } from 'vitest';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { flattenBodies } from '@/config/catalog';
import { bodyFact } from '@/core/bodyFacts';
import snapshot from '@/config/factSources.snapshot.json';
import {
  gravityLabelKey,
  radiusLabelKey,
  rotationLabelKey,
  temperatureLabelKey,
} from '@/core/factQuantity';
import type { FactProvenance } from '@/types';

/**
 * CHAQUE LIBELLÉ DE TEMPÉRATURE ET DE ROTATION EST JUSTIFIÉ PAR SA SOURCE (2026-10-03).
 *
 * `core/factQuantity.ts` choisit le libellé d'après la provenance du fait. Ce fichier le confronte
 * à ce que la source a RÉELLEMENT écrit, dans le relevé livré : une phrase pour NASA Science, le
 * champ `desc` pour la SBDB, la citation vérifiée pour un article. Un libellé plus affirmatif que
 * sa source, ou une précision ajoutée sans qu'elle soit écrite, rougit ici.
 */
const s = snapshot as unknown as {
  sbdb: Record<string, { rotationHours?: { desc?: string | null } | null }>;
  nasaScienceBodies: Record<string, { sentence: string }>;
  articles: Record<string, { verifiedQuotes: string[] }>;
  nssdcaDefinitions: Record<string, { verifiedQuotes: string[] }>;
};

interface Shown {
  body: string;
  provenance: FactProvenance;
}

/** Les faits AFFICHÉS d'un champ, sur tout le catalogue (une valeur, pas une raison). */
function shown(
  field: 'meanTempC' | 'rotationPeriod' | 'radiusKm' | 'gravity'
): Shown[] {
  const out: Shown[] = [];
  for (const [body, cfg] of flattenBodies(CELESTIAL_CONFIG)) {
    const entry = bodyFact(cfg, field);
    if (entry.status === 'value')
      out.push({ body, provenance: entry.provenance });
  }
  return out;
}

describe('la rotation', () => {
  const rotations = shown('rotationPeriod');

  it('la SBDB la DÉCLARE synodique, et la fiche le dit', () => {
    const sbdb = rotations.filter((r) => r.provenance.source === 'jpl-sbdb');
    expect(sbdb.length).toBeGreaterThan(0);
    for (const r of sbdb) {
      expect(s.sbdb[r.body]?.rotationHours?.desc, r.body).toContain(
        '(synodic)'
      );
      expect(rotationLabelKey(r.provenance), r.body).toBe(
        'stat.synodicRotation'
      );
    }
  });

  it('un article qui ne la qualifie pas reçoit le libellé neutre', () => {
    // Une rotation SYNCHRONE (Éris, « tidally locked » à l'orbite de Dysnomia, Szakáts 2023) vaut
    // une période orbitale sidérale : elle relève de la règle d'après, pas de celle-ci.
    const synchronous = (r: Shown) =>
      !!r.provenance.detail &&
      'message' in r.provenance.detail &&
      r.provenance.detail.message === 'detail.synchronousRotation';
    const articles = rotations.filter(
      (r) => s.articles[r.provenance.source] && !synchronous(r)
    );
    expect(articles.length).toBeGreaterThan(0);
    for (const r of articles) {
      const quotes = s.articles[r.provenance.source]!.verifiedQuotes.join(' ');
      expect(quotes, r.body).not.toMatch(/sidereal|synodic/i);
      expect(rotationLabelKey(r.provenance), r.body).toBe(
        'stat.rotationPeriod'
      );
    }
  });

  it('« sidérale » ne vient que d’une source qui la définit ainsi', () => {
    for (const r of rotations.filter(
      (x) => rotationLabelKey(x.provenance) === 'stat.siderealRotation'
    ))
      // Les fiches du NSSDCA (« relative to the fixed background stars ») et les rotations
      // synchrones, égales à la période orbitale sidérale.
      expect(
        r.provenance.source === 'nssdca-fact-sheets' ||
          (r.provenance.detail &&
            'message' in r.provenance.detail &&
            r.provenance.detail.message === 'detail.synchronousRotation'),
        r.body
      ).toBe(true);
  });
});

describe('la température', () => {
  const temperatures = shown('meanTempC');

  it('NASA Science : « moyenne » si la phrase dit average, « de surface » si elle dit surface temperature', () => {
    const nasa = temperatures.filter(
      (t) => t.provenance.source === 'nasa-science-bodies'
    );
    expect(nasa.length).toBeGreaterThan(0);
    for (const t of nasa) {
      const sentence = s.nasaScienceBodies[t.body]!.sentence;
      const key = temperatureLabelKey(t.provenance);
      if (/\baverage\b/i.test(sentence))
        expect(key, t.body).toBe('stat.meanTemperature');
      else {
        expect(sentence, t.body).toMatch(/surface temperature/i);
        expect(key, t.body).toBe('stat.surfaceTemperature');
      }
    }
  });

  it('le Soleil a une température effective, et les géantes une moyenne à 1 bar', () => {
    const at = (body: string) =>
      temperatureLabelKey(
        temperatures.find((t) => t.body === body)?.provenance
      );
    expect(at('sun')).toBe('stat.effectiveTemperature');
    for (const giant of ['jupiter', 'saturn', 'uranus', 'neptune'])
      expect(at(giant), giant).toBe('stat.meanTemperature1Bar');
    expect(at('earth')).toBe('stat.meanTemperature');
  });

  /**
   * « Moyenne de deux hémisphères » (2026-10-12) : les notes du NSSDCA le DISENT de Mercure et de
   * la Lune, et de personne d'autre. La précision vient de cette phrase, vérifiée dans le texte
   * servi par le relevé ; elle est portée par ces deux corps exactement, sur une valeur du NSSDCA.
   */
  it('Mercure et la Lune, et eux seuls, portent la moyenne des deux hémisphères', () => {
    const quote =
      s.nssdcaDefinitions.hemisphereAverage!.verifiedQuotes.join(' ');
    expect(quote).toMatch(/For Mercury and the Moon/);
    expect(quote).toMatch(/not representative of any given region/);
    const carriers = temperatures.filter(
      (t) =>
        t.provenance.detail &&
        'message' in t.provenance.detail &&
        t.provenance.detail.message === 'detail.hemisphereAverage'
    );
    expect(carriers.map((t) => t.body).sort()).toEqual(['mercury', 'moon']);
    for (const t of carriers) {
      expect(t.provenance.source, t.body).toBe('nssdca-fact-sheets');
      // Une précision de DÉFINITION ne change pas la grandeur : c'est bien une moyenne.
      expect(temperatureLabelKey(t.provenance), t.body).toBe(
        'stat.meanTemperature'
      );
    }
  });
});

/**
 * LA SPHÈRE D'UNE GÉANTE EST LE NIVEAU DE 1 BAR (lot 51). Le relevé lit leur rayon sous le
 * libellé « Equatorial radius (1 bar level) (km) » et leur gravité sous « Gravity (mean, 1 bar) »
 * (`scripts/snapshot-fact-sources.mjs`, liste `giant`) ; le libellé de la fiche et de la page le
 * dit, sur ces quatre corps et sur eux seuls, et jamais « de surface ».
 */
describe('le rayon et la gravité d’une géante', () => {
  const GIANTS = ['jupiter', 'neptune', 'saturn', 'uranus'];
  it('« à 1 bar » sur les quatre géantes, et sur elles seules', () => {
    const radius = shown('radiusKm').filter(
      (r) => radiusLabelKey(r.provenance) === 'stat.radius1Bar'
    );
    const gravity = shown('gravity').filter(
      (g) => gravityLabelKey(g.provenance) === 'stat.gravity1Bar'
    );
    expect(radius.map((r) => r.body).sort()).toEqual(GIANTS);
    expect(gravity.map((g) => g.body).sort()).toEqual(GIANTS);
    for (const r of [...radius, ...gravity])
      expect(r.provenance.source, r.body).toBe('nssdca-fact-sheets');
  });
});
