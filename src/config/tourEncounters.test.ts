import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOUR_SCRIPTS } from './tourScripts';
import { CELESTIAL_CONFIG } from './bodies';
import { flattenBodies } from './catalog';
import type { TourStep } from '@/core/tourEngine';

/**
 * LES DEUX VISITES DE GAL-TOUR-004 : chaque chiffre que leurs légendes disent est confronté à la
 * source qui le porte, dans les quatre langues. Une légende écrite à la main qui dérive d'un
 * relevé (le plus près de Pluton, une taille de l'UAI, une année d'acquisition) fait échouer ce
 * fichier au lieu d'être publiée fausse.
 */
const ROOT = resolve(import.meta.dirname, '../..');
const readJson = <T>(path: string): T =>
  JSON.parse(readFileSync(resolve(ROOT, path), 'utf-8')) as T;

const LOCALES = ['en', 'fr', 'es', 'pt-BR'] as const;
type Locale = (typeof LOCALES)[number];

const script = (id: string) => {
  const found = TOUR_SCRIPTS.find((s) => s.id === id);
  if (!found) throw new Error(`visite absente : ${id}`);
  return found;
};

type Caption = Extract<TourStep, { kind: 'caption' }>;
const isCaption = (step: TourStep): step is Caption => step.kind === 'caption';

/** Un nombre tel que les quatre langues l'écrivent : séparateur de milliers et décimale variables. */
function numberPattern(value: number, decimals: number): RegExp {
  const [whole, fraction] = value.toFixed(decimals).split('.');
  const groups = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, '#');
  const body = groups
    .split('#')
    .join('[,.\\u00a0\\u202f ]')
    .concat(fraction ? `[.,]${fraction}` : '');
  return new RegExp(`(?<![\\d.,])${body}(?![\\d])`);
}

/** Le texte de la première légende qui suit l'étape `index`. */
function captionAfter(
  steps: readonly TourStep[],
  index: number,
  locale: Locale
): string {
  const next = steps.slice(index + 1).find(isCaption);
  if (!next) throw new Error(`aucune légende après l'étape ${index}`);
  return next.text[locale];
}

describe('new-horizons-pluto : la rencontre, confrontée au relevé des survols', () => {
  const flyby = readJson<{
    events: {
      probe: string;
      body: string;
      closestAt: string;
      closestKm: number;
      speedKmS: number;
    }[];
  }>('src/seo/flybyEvents.json').events.find(
    (event) => event.probe === 'new-horizons' && event.body === 'pluto'
  )!;
  const steps = script('new-horizons-pluto').steps;
  const radiusKm =
    flattenBodies(CELESTIAL_CONFIG).get('pluto')!.realData!.radiusKm!;
  const closest = new Date(flyby.closestAt).getTime();

  it('le relevé de New Horizons à Pluton existe', () => {
    expect(flyby).toBeDefined();
  });

  it('saute à l’instant mesuré du plus près, et à deux autres instants proches', () => {
    const jumps = steps.flatMap((step, index) =>
      step.kind === 'jumpToDate' ? [{ index, time: step.date.getTime() }] : []
    );
    expect(jumps.map((jump) => jump.time)).toContain(closest);
    for (const jump of jumps)
      expect(Math.abs(jump.time - closest)).toBeLessThanOrEqual(2 * 3600e3);
  });

  it('place la caméra à la distance MESURÉE au plus près, en rayons de Pluton', () => {
    const at = steps.findIndex(
      (step) => step.kind === 'jumpToDate' && step.date.getTime() === closest
    );
    const frame = steps
      .slice(at + 1)
      .find((step) => step.kind === 'flyTo' && step.from === 'new-horizons');
    expect(frame).toMatchObject({ kind: 'flyTo', body: 'pluto' });
    const radii = (frame as Extract<TourStep, { kind: 'flyTo' }>)
      .distanceRadii!;
    expect(Math.abs((radii * radiusKm) / flyby.closestKm - 1)).toBeLessThan(
      0.01
    );
  });

  it('fige la vitesse du temps à 1:1 AVANT le premier saut : une vitesse du visiteur ne déplace pas les vues', () => {
    const scale = steps.findIndex((step) => step.kind === 'setTimeScale');
    const firstJump = steps.findIndex((step) => step.kind === 'jumpToDate');
    expect(scale).toBeGreaterThan(-1);
    expect(scale).toBeLessThan(firstJump);
    expect(steps[scale]).toEqual({ kind: 'setTimeScale', scale: 1 });
  });

  it('passe en vraie échelle avant de cadrer : en Éduc, une sonde à 13 676 km est invisible', () => {
    const mode = steps.findIndex((step) => step.kind === 'setMode');
    const firstFlight = steps.findIndex((step) => step.kind === 'flyTo');
    expect(steps[mode]).toEqual({ kind: 'setMode', mode: 'explo' });
    expect(mode).toBeLessThan(firstFlight);
  });

  it.each(LOCALES)(
    '%s : les chiffres des légendes sont ceux du relevé',
    (locale) => {
      const at = steps.findIndex(
        (step) => step.kind === 'jumpToDate' && step.date.getTime() === closest
      );
      const text = captionAfter(steps, at, locale);
      expect(text).toMatch(numberPattern(flyby.closestKm, 0));
      expect(text).toMatch(numberPattern(flyby.speedKmS, 2));
      expect(text).toMatch(numberPattern(radiusKm, 0));
      // « environ 12 500 km au-dessus de la surface » : distance au centre moins le rayon, arrondie
      // à la centaine. Une altitude n'est pas une distance au centre.
      const altitude = Math.round((flyby.closestKm - radiusKm) / 100) * 100;
      expect(text).toMatch(numberPattern(altitude, 0));
    }
  );

  it.each(LOCALES)(
    '%s : chaque légende datée donne l’heure UTC de son saut',
    (locale) => {
      steps.forEach((step, index) => {
        if (step.kind !== 'jumpToDate') return;
        const hours = String(step.date.getUTCHours()).padStart(2, '0');
        const minutes = String(step.date.getUTCMinutes()).padStart(2, '0');
        expect(captionAfter(steps, index, locale)).toMatch(
          new RegExp(`${hours}\\D{1,6}${minutes}`)
        );
      });
    }
  );

  it('la carte affichée est datée par sa fiche : janvier à novembre 2015, publiée en juillet 2017', () => {
    const tileset = readJson<{
      title: string;
      acquired: { interval: [string, string][] };
    }>('src/registry/products/tilesets/pluto-newhorizons-global-300m.json');
    const [start, end] = tileset.acquired.interval[0]!;
    expect(start.startsWith('2015-01')).toBe(true);
    expect(end.startsWith('2015-11')).toBe(true);
    expect(tileset.title).toContain('Jul2017');
    const english = steps.filter(isCaption).map((step) => step.text.en);
    expect(english.join(' ')).toMatch(/January and November 2015/);
    expect(english.join(' ')).toMatch(/July 2017/);
  });

  it('ne présente jamais une reconstruction comme une photographie', () => {
    const first = steps.find(isCaption)!;
    expect(first.text.en).toMatch(/not photographs/);
    expect(first.text.fr).toMatch(/pas des photographies/);
    expect(first.text.es).toMatch(/no fotografías/);
    expect(first.text['pt-BR']).toMatch(/não fotografias/);
  });
});

describe('mars-valles-olympus : les tailles sont celles du répertoire de l’UAI', () => {
  const steps = script('mars-valles-olympus').steps;
  const gazetteer = readJson<
    { name: string; type: string; diameterKm: number }[]
  >('public/assets/gazetteer/mars.json');
  const terms = readJson<{ terms: { label: string; definition: string }[] }>(
    'src/seo/descriptorTerms.json'
  ).terms;
  const dives = steps.flatMap((step, index) =>
    step.kind === 'diveTo' ? [{ place: step.place, index }] : []
  );

  it('plonge sur Valles Marineris, Melas Chasma, Olympus Rupes et Olympus Mons', () => {
    expect(dives.map((dive) => dive.place)).toEqual([
      'Valles Marineris',
      'Melas Chasma',
      'Olympus Rupes',
      'Olympus Mons',
    ]);
  });

  it.each(LOCALES)(
    '%s : chaque taille citée est celle du répertoire',
    (locale) => {
      for (const { place, index } of dives) {
        const feature = gazetteer.find((f) => f.name === place)!;
        const text = captionAfter(steps, index, locale);
        const decimal = numberPattern(feature.diameterKm, 1);
        const rounded = numberPattern(Math.round(feature.diameterKm), 0);
        expect(
          decimal.test(text) || rounded.test(text),
          `${place} (${feature.diameterKm} km) dans « ${text.slice(0, 60)}… »`
        ).toBe(true);
      }
    }
  );

  it('une taille du répertoire n’est jamais dite hauteur ni profondeur : la légende le nie', () => {
    for (const { place, index } of dives) {
      const english = captionAfter(steps, index, 'en');
      expect(english, place).toMatch(/not a (depth|height)/);
    }
  });

  it('les termes UAI cités (escarpement, dépression, montagne) sont ceux de la table publiée', () => {
    const define = (label: string) =>
      terms.find((term) => term.label === label)?.definition;
    expect(define('Rupes, rupēs')).toBe('Scarp');
    expect(define('Chasma, chasmata')).toBe(
      'A deep, elongated, steep-sided depression'
    );
    expect(define('Mons, montes')).toBe('Mountain');
    const type = (name: string) => gazetteer.find((f) => f.name === name)?.type;
    expect(type('Olympus Rupes')).toBe('Rupes, rupēs');
    expect(type('Melas Chasma')).toBe('Chasma, chasmata');
    expect(type('Olympus Mons')).toBe('Mons, montes');
  });

  it('le relief fin cité existe : Melas Chasma et Olympus Mons sont des aires cuites du manifeste MOLA', () => {
    const manifest = readJson<{
      coverage: { area?: { name: string } }[];
    }>('public/assets/height-tiles/mars/manifest.json');
    const areas = manifest.coverage.flatMap((c) =>
      c.area ? [c.area.name] : []
    );
    expect(areas).toContain('Melas Chasma');
    expect(areas).toContain('Olympus Mons');
    // Les deux légendes qui parlent d'un relief plus fin sont celles de ces deux lieux.
    const withRelief = dives
      .filter(({ index }) => /MOLA/.test(captionAfter(steps, index, 'en')))
      .map((dive) => dive.place);
    expect(withRelief).toEqual(['Melas Chasma', 'Olympus Mons']);
    const heightfield = readJson<{
      acquired: { interval: [string, string][] };
    }>('src/registry/products/heightfields/mars-mola-megr.json');
    const [start, end] = heightfield.acquired.interval[0]!;
    expect(start.startsWith('1997')).toBe(true);
    expect(end.startsWith('2001')).toBe(true);
  });

  it('la mosaïque Viking est datée par sa fiche : 1976 à 1980', () => {
    const tileset = readJson<{ acquired: { interval: [string, string][] } }>(
      'src/registry/products/tilesets/mars-viking-mdim21-clrmosaic-global-232m.json'
    );
    const [start, end] = tileset.acquired.interval[0]!;
    expect(start.startsWith('1976')).toBe(true);
    expect(end.startsWith('1980')).toBe(true);
    const first = captionAfter(steps, dives[0]!.index, 'en');
    expect(first).toMatch(/1976 and 1980/);
  });

  it('fige la vitesse du temps à 1:1 avant la première plongée', () => {
    const scale = steps.findIndex((step) => step.kind === 'setTimeScale');
    expect(scale).toBeGreaterThan(-1);
    expect(scale).toBeLessThan(dives[0]!.index);
    expect(steps[scale]).toEqual({ kind: 'setTimeScale', scale: 1 });
  });
});
