import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ALL_PROVIDERS,
  FACT_SOURCE_PROVIDERS,
  POSITION_PROVIDERS,
  answersAnyDate,
} from './index';
import { EVENT_PROVIDERS } from './events';
import { FACT_SOURCES, factSource } from '@/config/factSources';
import {
  SUMMARY_PROVIDER,
  type PositionSource,
} from '@/core/positionProvenance';
import manifest from '../../../public/assets/ephemerides/manifest.json';
import summary from '@/config/horizons-validation-summary.json';

/**
 * LE REGISTRE DES FOURNISSEURS ET SES DEUX LECTEURS.
 *
 * `providers/index.ts` est un littéral écrit à la main au-dessus d'un dossier de fichiers : rien
 * n'oblige, par construction, ce littéral à couvrir le dossier. Or l'ORDRE de ce littéral est une
 * donnée PUBLIÉE (le tableau des sources primaires de `/sources`), et une fiche oubliée
 * disparaîtrait de la page sans qu'aucun test ne rougisse. D'où les gardes ci-dessous.
 */

const DIR = resolve(import.meta.dirname);

/** Jour julien → millisecondes UTC. Conversion nominale, sans TT-UTC : granularité du jour. */
const JD_EPOCH = 2440587.5;
const msFromJd = (jd: number): number => (jd - JD_EPOCH) * 86_400_000;

describe('registre des fournisseurs', () => {
  const fileIds = readdirSync(DIR)
    .filter((n) => n.endsWith('.json'))
    .map((n) => n.replace(/\.json$/, ''))
    .sort();

  it('couvre exactement le dossier : aucune fiche orpheline, aucune fiche fantôme', () => {
    const declared = [
      ...Object.keys(FACT_SOURCE_PROVIDERS),
      ...Object.values(POSITION_PROVIDERS).map((p) => p.id),
      ...Object.keys(EVENT_PROVIDERS),
    ].sort();
    expect(
      declared,
      'une fiche présente sur le disque mais absente de providers/index.ts ne serait lue par personne'
    ).toEqual(fileIds);
    expect(fileIds.length).toBe(25);
  });

  it('garde les fiches d’événements HORS du bundle de l’application', () => {
    // Mesuré avant d'être une règle : avec ces deux fiches dans `index.ts`, la prose bilingue
    // de leurs conditions se retrouvait mot pour mot dans `dist/assets/SolarSystemApp-*.js`,
    // alors que rien à l'exécution ne les lit. Le test lit la SOURCE plutôt que le bundle, pour
    // nommer le fichier fautif et ne rien exiger d'un build préalable (même forme que
    // `src/seo/buildOnly.test.ts`).
    const src = resolve(import.meta.dirname, '../..');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (full === join(src, 'seo')) continue;
          walk(full);
          continue;
        }
        if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
        const source = readFileSync(full, 'utf-8');
        if (/from '(\.\/events|@\/registry\/providers\/events)'/.test(source))
          offenders.push(full.slice(src.length + 1));
      }
    };
    walk(src);
    expect(
      offenders,
      'ces fiches ne servent qu’au build et aux tests : les importer depuis l’application les livrerait à chaque visiteur'
    ).toEqual([]);
  });

  it('indexe chaque fiche sous son propre identifiant', () => {
    for (const [key, provider] of Object.entries(FACT_SOURCE_PROVIDERS))
      expect(provider.id, `clé ${key}`).toBe(key);
    for (const [key, provider] of Object.entries(EVENT_PROVIDERS))
      expect(provider.id, `clé ${key}`).toBe(key);
    // Les sources de position sont indexées par la clé que renvoie `BodyPositionResolver`, pas
    // par leur identifiant de fiche : c'est `positionSource` qui doit correspondre.
    for (const [key, provider] of Object.entries(POSITION_PROVIDERS))
      expect(provider.positionSource, `clé ${key}`).toBe(key);
  });

  it('sépare les trois rôles sans recouvrement', () => {
    for (const provider of Object.values(FACT_SOURCE_PROVIDERS))
      expect(provider.role, provider.id).toBe('fact-source');
    for (const provider of Object.values(POSITION_PROVIDERS))
      expect(provider.role, provider.id).toBe('position-source');
    for (const provider of Object.values(EVENT_PROVIDERS))
      expect(provider.role, provider.id).toBe('event-source');
    expect(ALL_PROVIDERS.length + Object.keys(EVENT_PROVIDERS).length).toBe(25);
  });
});

describe('FACT_SOURCES dérivé du registre', () => {
  it('expose les 19 sources de faits, dans l’ordre du registre', () => {
    // L'ordre est publié : `/sources` écrit son tableau en parcourant cet objet.
    expect(Object.keys(FACT_SOURCES)).toEqual(
      Object.keys(FACT_SOURCE_PROVIDERS)
    );
    expect(Object.keys(FACT_SOURCES).length).toBe(19);
  });

  it('n’expose AUCUNE source de position comme source de fait', () => {
    // Une fiche `position-source` n'a ni `accessed` ni vocation à être citée sur une fiche de
    // corps : `factProvenance.test.ts` la refuserait comme source orpheline.
    for (const provider of Object.values(POSITION_PROVIDERS))
      expect(factSource(provider.id), provider.id).toBeUndefined();
  });
});

describe('SUMMARY_PROVIDER lu dans le registre', () => {
  const sources: PositionSource[] = [
    'horizons',
    'spk',
    'astronomy-engine',
    'kepler',
  ];

  /**
   * Ce test a d'abord comparé `SUMMARY_PROVIDER[source]` au `validationProviderId` de la fiche,
   * ce qui ne prouvait RIEN : depuis l'absorption, les deux côtés sortent du même fichier.
   * La falsification l'a montré (un identifiant changé en « keplerien » restait vert). La vraie
   * affirmation est ailleurs : cet identifiant doit être un nom que le résumé de validation
   * emploie réellement, sinon `measuredWindows` ne filtrerait plus aucune ligne et la fiche
   * annoncerait « extrapolé » partout, en silence.
   */
  it('nomme chaque source comme le fait le résumé de validation', () => {
    const inSummary = new Set(summary.rows.map((row) => row.provider));
    expect(inSummary.size).toBeGreaterThan(1);
    for (const [key, provider] of Object.entries(POSITION_PROVIDERS))
      expect(
        [...inSummary],
        `${key} : validationProviderId absent du résumé de validation`
      ).toContain(provider.validationProviderId);
  });

  it('couvre les quatre sources que le résolveur peut renvoyer', () => {
    expect(Object.keys(SUMMARY_PROVIDER).sort()).toEqual([...sources].sort());
  });
});

describe('couverture temporelle déclarée', () => {
  it('dit « répond à toute date » pour les seules sources qui calculent', () => {
    expect(answersAnyDate(POSITION_PROVIDERS['astronomy-engine'])).toBe(true);
    expect(answersAnyDate(POSITION_PROVIDERS.kepler)).toBe(true);
    // Un binaire est borné, un noyau SPK ne déclare rien à ce niveau : ni l'un ni l'autre ne
    // peut « extrapoler », et c'est ce que `core/positionProvenance.ts` lit ici.
    expect(answersAnyDate(POSITION_PROVIDERS.horizons)).toBe(false);
    expect(answersAnyDate(POSITION_PROVIDERS.spk)).toBe(false);
  });

  it('ne confond pas « pas de borne » avec « une seule borne »', () => {
    expect(
      answersAnyDate({
        id: 'moitié-ouvert',
        extent: {
          temporal: { interval: [['1900-01-01T00:00:00Z', null]] },
        },
      })
    ).toBe(false);
  });

  /**
   * La fiche `horizons-binary` déclare l'ENVELOPPE des binaires livrés. Une enveloppe recopiée
   * une fois est une enveloppe fausse dès la prochaine régénération : elle est donc confrontée au
   * manifeste, qui est l'autorité (`pnpm ephemeris:generate` le réécrit).
   */
  it('contient chaque binaire du manifeste des éphémérides', () => {
    const interval = POSITION_PROVIDERS.horizons.extent.temporal.interval[0]!;
    const [from, to] = interval;
    expect(from).not.toBeNull();
    expect(to).not.toBeNull();
    const fromMs = Date.parse(from!);
    const toMs = Date.parse(to!);

    const bodies = Object.entries(
      manifest.bodies as Record<
        string,
        { startJdTdb: number; stepDays: number; sampleCount: number }
      >
    );
    expect(bodies.length).toBeGreaterThan(40);
    const outside: string[] = [];
    for (const [name, body] of bodies) {
      const start = msFromJd(body.startJdTdb);
      const end = msFromJd(
        body.startJdTdb + (body.sampleCount - 1) * body.stepDays
      );
      if (start < fromMs || end > toMs)
        outside.push(
          `${name} (${new Date(start).toISOString()} → ${new Date(end).toISOString()})`
        );
    }
    expect(
      outside,
      'la couverture déclarée par providers/horizons-binary.json ne contient plus tout le manifeste'
    ).toEqual([]);
  });

  it('déclare une cadence qui encadre celle du manifeste', () => {
    const step = POSITION_PROVIDERS.horizons.samplingStepSeconds;
    const days = Object.values(
      manifest.bodies as Record<string, { stepDays: number }>
    ).map((b) => b.stepDays);
    expect(Math.min(...days) * 86_400).toBe(step.min);
    expect(Math.max(...days) * 86_400).toBe(step.max);
  });
});
