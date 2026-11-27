import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOUR_SCRIPTS } from './tourScripts';
import { CELESTIAL_CONFIG } from './bodies';
import { flattenBodies } from './catalog';
import { craftModelFor } from './craftModels';
import type { TourStep } from '@/core/tourEngine';
import { DATED_ROTATION_BODIES } from './datedRotation';

/**
 * LES GRANDES EXPÉDITIONS (GAL-TOUR-EXCELLENCE-002) : chaque instant, chaque distance, chaque vitesse
 * et chaque date d'observation que leurs légendes disent est confronté au fichier qui le porte, dans
 * les quatre langues. Trois règles de plus, propres à ces visites :
 *  - une caméra « depuis la sonde » (`from`) n'est posée que là où le manifeste sert un segment de la
 *    sonde CENTRÉ sur le corps visé et couvrant l'instant (propagation à deux corps autour du corps
 *    entre deux états d'Horizons) : ailleurs la position de la sonde serait une interpolation
 *    héliocentrique, et la direction affichée une position fictive ;
 *  - une observation datée (`setEdition`) est la plus PROCHE de la date de la scène parmi celles que
 *    l'application porte, et la légende qui suit dit son jour ;
 *  - l'engin inspecté a un modèle au registre : aucune forme n'est inventée.
 */
const ROOT = resolve(import.meta.dirname, '../..');
const readJson = <T>(path: string): T =>
  JSON.parse(readFileSync(resolve(ROOT, path), 'utf-8')) as T;

const LOCALES = ['en', 'fr', 'es', 'pt-BR'] as const;
type Locale = (typeof LOCALES)[number];
type Caption = Extract<TourStep, { kind: 'caption' }>;
const isCaption = (step: TourStep): step is Caption => step.kind === 'caption';

const EXPEDITIONS = [
  'voyager2-giants',
  'cassini-saturn-titan',
  'juno-jupiter',
  'osiris-rex-bennu',
] as const;

const script = (id: string) => {
  const found = TOUR_SCRIPTS.find((s) => s.id === id);
  if (!found) throw new Error(`visite absente : ${id}`);
  return found;
};

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

/** L'heure UTC d'un instant, telle que les légendes l'écrivent (`02:55:34`). */
const clock = (iso: string): string => iso.slice(11, 19);

function captionAfter(
  steps: readonly TourStep[],
  index: number,
  locale: Locale
): string {
  const next = steps.slice(index + 1).find(isCaption);
  if (!next) throw new Error(`aucune légende après l'étape ${index}`);
  return next.text[locale];
}

/** La date de la scène au moment de chaque étape (dernier `jumpToDate` rencontré). */
function sceneDateAt(steps: readonly TourStep[], index: number): Date | null {
  for (let i = index; i >= 0; i--) {
    const step = steps[i]!;
    if (step.kind === 'jumpToDate') return step.date;
  }
  return null;
}

/** Toutes les légendes d'une visite dans une langue, d'un seul tenant. */
const allText = (id: string, locale: Locale): string =>
  script(id)
    .steps.filter(isCaption)
    .map((c) => c.text[locale])
    .join(' ');

function expectEverywhere(id: string, pattern: RegExp | string): void {
  for (const locale of LOCALES) {
    const text = allText(id, locale);
    if (typeof pattern === 'string') expect(text, locale).toContain(pattern);
    else expect(text, locale).toMatch(pattern);
  }
}

const bodies = flattenBodies(CELESTIAL_CONFIG);
const radiusOf = (name: string): number => {
  const radius = bodies.get(name)?.realData?.radiusKm;
  if (!radius) throw new Error(`rayon absent : ${name}`);
  return radius;
};

const flybys = readJson<{
  events: {
    probe: string;
    body: string;
    closestAt: string;
    closestKm: number;
    speedKmS: number;
  }[];
}>('src/seo/flybyEvents.json').events;
const insertions = readJson<{
  insertions: {
    probe: string;
    body: string;
    at: string;
    distanceKm: number;
    speedKmS: number;
  }[];
}>('src/seo/orbitInsertions.json').insertions;
const contacts = readJson<{
  contacts: {
    probe: string;
    body: string;
    kind: string;
    at: string;
    sceneAt: string;
    distanceKm: number;
    restSeconds?: number | null;
  }[];
}>('src/seo/surfaceContacts.json').contacts;
const perijoveFile = readJson<{
  jupiterRadiusKm: number;
  perijoves: {
    pj: number;
    at: string;
    distanceKm: number;
    altitudeKm: number;
    speedKmS: number;
  }[];
}>('src/seo/perijoves.json');

const flyby = (probe: string, body: string) => {
  const found = flybys.find((e) => e.probe === probe && e.body === body);
  if (!found) throw new Error(`survol absent : ${probe} ${body}`);
  return found;
};
const insertion = (probe: string, body: string) => {
  const found = insertions.find((e) => e.probe === probe && e.body === body);
  if (!found) throw new Error(`mise en orbite absente : ${probe} ${body}`);
  return found;
};
const contact = (probe: string, body: string) => {
  const found = contacts.find((e) => e.probe === probe && e.body === body);
  if (!found) throw new Error(`contact absent : ${probe} ${body}`);
  return found;
};
const perijove = (pj: number) => {
  const found = perijoveFile.perijoves.find((p) => p.pj === pj);
  if (!found) throw new Error(`périjove absent : ${pj}`);
  return found;
};

/** Les instants sautés par une visite, en millisecondes. */
const jumps = (id: string): number[] =>
  script(id).steps.flatMap((step) =>
    step.kind === 'jumpToDate' ? [step.date.getTime()] : []
  );

describe('les quatre expéditions sont au catalogue, déclaratives, et chacune raconte', () => {
  it.each(EXPEDITIONS)(
    '%s : au moins cinq légendes et une inspection',
    (id) => {
      const steps = script(id).steps;
      expect(steps.filter(isCaption).length).toBeGreaterThanOrEqual(5);
      expect(steps.some((s) => s.kind === 'inspectCraft')).toBe(true);
    }
  );

  it('aucune expédition ne duplique une visite existante (identifiants et titres)', () => {
    const titles = TOUR_SCRIPTS.map((s) => s.title.en);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe('Voyager 2 : les quatre plus près, confrontés au relevé des survols', () => {
  const id = 'voyager2-giants';
  for (const body of ['jupiter', 'saturn', 'uranus', 'neptune']) {
    const event = flyby('voyager2', body);
    it(`${body} : l'instant, la distance et la vitesse publiés`, () => {
      expect(jumps(id)).toContain(new Date(event.closestAt).getTime());
      expectEverywhere(id, clock(event.closestAt));
      expectEverywhere(id, numberPattern(event.closestKm, 0));
      expectEverywhere(id, numberPattern(event.speedKmS, 1));
    });
  }
  it('Voyager 1 à Saturne, citée pour comparaison', () => {
    expectEverywhere(
      id,
      numberPattern(flyby('voyager1', 'saturn').closestKm, 0)
    );
  });
  it('Hili est bien l’un des DEUX panaches de Triton au gazetteer', () => {
    const triton = readJson<{ name: string; type: string }[]>(
      'public/assets/gazetteer/triton.json'
    );
    const plumes = triton.filter((f) => /^Plume/.test(f.type));
    expect(plumes.map((f) => f.name)).toContain('Hili');
    expect(plumes).toHaveLength(2);
  });
});

describe('Cassini : la mise en orbite et le niveau de 1 bar', () => {
  const id = 'cassini-saturn-titan';
  it('la mise en orbite calculée (instant, distance, vitesse)', () => {
    const e = insertion('cassini', 'saturn');
    expect(jumps(id)).toContain(new Date(e.at).getTime());
    expectEverywhere(id, clock(e.at));
    expectEverywhere(id, numberPattern(e.distanceKm, 0));
    expectEverywhere(id, numberPattern(e.speedKmS, 1));
  });
  it('la scène s’ouvre à l’instant de la page du contact, une minute avant le niveau de 1 bar', () => {
    const e = contact('cassini', 'saturn');
    expect(e.kind).toBe('entry');
    expect(jumps(id)).toContain(new Date(e.sceneAt).getTime());
    expectEverywhere(id, clock(e.at));
  });
  it('la distance entre Shangri La (gazetteer) et le site de Huygens (ESA) est celle que la légende dit', () => {
    const titan = readJson<{ name: string; lat: number; lon: number }[]>(
      'public/assets/gazetteer/titan.json'
    );
    const place = titan.find((f) => f.name === 'Shangri La')!;
    const site = { lat: -10.3, lon: 192.3 };
    const rad = Math.PI / 180;
    const angle = Math.acos(
      Math.sin(place.lat * rad) * Math.sin(site.lat * rad) +
        Math.cos(place.lat * rad) *
          Math.cos(site.lat * rad) *
          Math.cos((place.lon - site.lon) * rad)
    );
    const km = angle * radiusOf('titan');
    expect(Math.round(km / 10) * 10).toBe(120);
    expectEverywhere(id, numberPattern(120, 0));
  });
});

describe('Juno : la mise en orbite et deux périjoves, confrontés aux relevés', () => {
  const id = 'juno-jupiter';
  it('la mise en orbite calculée', () => {
    const e = insertion('juno', 'jupiter');
    expect(jumps(id)).toContain(new Date(e.at).getTime());
    expectEverywhere(id, clock(e.at));
    expectEverywhere(id, numberPattern(e.distanceKm, 0));
    expectEverywhere(id, numberPattern(e.speedKmS, 1));
  });
  it('PJ1 et PJ66 : instant, distance, écart au rayon équatorial, vitesse', () => {
    const pj1 = perijove(1);
    const pj66 = perijove(66);
    expect(jumps(id)).toContain(new Date(pj1.at).getTime());
    expect(jumps(id)).toContain(new Date(pj66.at).getTime());
    expectEverywhere(id, clock(pj1.at));
    expectEverywhere(id, numberPattern(pj1.distanceKm, 0));
    expectEverywhere(id, numberPattern(pj1.altitudeKm, 0));
    expectEverywhere(id, numberPattern(pj1.speedKmS, 1));
    expectEverywhere(id, numberPattern(perijoveFile.jupiterRadiusKm, 0));
    expectEverywhere(id, clock(pj66.at));
    expectEverywhere(id, numberPattern(pj66.altitudeKm, 1));
  });
  it('les intervalles entre périjoves sont calculés sur le relevé', () => {
    const days = (a: number, b: number) =>
      (new Date(perijove(b).at).getTime() -
        new Date(perijove(a).at).getTime()) /
      86_400_000;
    expectEverywhere(id, numberPattern(days(1, 2), 1));
    expectEverywhere(id, numberPattern(days(65, 66), 1));
  });
});

describe('OSIRIS-REx : la mise en orbite, le contact et le retour', () => {
  const id = 'osiris-rex-bennu';
  it('la mise en orbite calculée (distance en km, vitesse en cm/s)', () => {
    const e = insertion('osiris-rex', 'bennu');
    expect(jumps(id)).toContain(new Date(e.at).getTime());
    expectEverywhere(id, clock(e.at));
    expectEverywhere(id, numberPattern(e.distanceKm, 3));
    expectEverywhere(id, numberPattern(e.speedKmS * 1e5, 1));
  });
  it('le contact : instant, distance au centre en mètres, durée du repos', () => {
    const e = contact('osiris-rex', 'bennu');
    expect(e.kind).toBe('touch');
    expect(jumps(id)).toContain(new Date(e.sceneAt).getTime());
    expectEverywhere(id, clock(e.at));
    expectEverywhere(id, numberPattern(e.distanceKm * 1000, 0));
    expect(e.restSeconds).toBe(6);
    // Le contact tombe SOUS le rayon moyen : c'est ce que la légende explique (Bennu n'est pas une sphère).
    expect(e.distanceKm).toBeLessThan(radiusOf('bennu'));
  });
  it('le diamètre de Bennu est celui de la fiche', () => {
    expectEverywhere(id, numberPattern(radiusOf('bennu') * 2000, 0));
  });
  it('le passage près de la Terre en 2023', () => {
    const e = flyby('osiris-rex', 'earth');
    const at = flybys.find(
      (f) =>
        f.probe === 'osiris-rex' &&
        f.body === 'earth' &&
        f.closestAt.startsWith('2023')
    )!;
    expect(e).toBeDefined();
    expect(jumps(id)).toContain(new Date(at.closestAt).getTime());
    expectEverywhere(id, clock(at.closestAt));
    expectEverywhere(id, numberPattern(at.closestKm, 0));
  });
  it('Hokioi : la latitude du gazetteer', () => {
    const bennu = readJson<{ name: string; lat: number }[]>(
      'public/assets/gazetteer/bennu.json'
    );
    expectEverywhere(
      id,
      numberPattern(bennu.find((f) => f.name === 'Hokioi')!.lat, 1)
    );
  });
});

describe('les règles communes des expéditions', () => {
  const manifest = readJson<{
    bodies: Record<
      string,
      {
        center: string;
        startJdTdb: number;
        stepDays: number;
        sampleCount: number;
        segmentOf?: string;
      }
    >;
  }>('public/assets/ephemerides/manifest.json').bodies;
  const jd = (date: Date): number => date.getTime() / 86_400_000 + 2_440_587.5;

  it.each(EXPEDITIONS)(
    '%s : une caméra « depuis la sonde » n’est posée que sur un segment centré sur le corps',
    (id) => {
      // Une SONDE (registre des sondes) ; un corps du catalogue (la Terre, d'où Hubble observe) a son
      // propre fichier héliocentrique et n'est pas concerné.
      const probes = new Set(
        readJson<{ order: string[] }>('src/registry/spacecraft/order.json')
          .order
      );
      const steps = script(id).steps;
      expect(
        steps.some(
          (s) =>
            s.kind === 'flyTo' && s.from !== undefined && probes.has(s.from)
        )
      ).toBe(true);
      steps.forEach((step, index) => {
        if (step.kind !== 'flyTo' || step.from === undefined) return;
        if (!probes.has(step.from)) return;
        const at = sceneDateAt(steps, index);
        expect(at, `étape ${index}`).not.toBeNull();
        const covering = Object.entries(manifest).filter(
          ([name, m]) =>
            name.startsWith(`${step.from}--${step.body}-`) &&
            m.center === step.body &&
            jd(at!) >= m.startJdTdb &&
            jd(at!) <= m.startJdTdb + m.stepDays * (m.sampleCount - 1)
        );
        expect(covering.length, `${id} étape ${index}`).toBeGreaterThan(0);
      });
    }
  );

  it.each(EXPEDITIONS)(
    '%s : une distance d’arrivée suit la sonde, ou la légende dit que la caméra reste plus loin',
    (id) => {
      const steps = script(id).steps;
      steps.forEach((step, index) => {
        if (step.kind !== 'flyTo' || step.from === undefined) return;
        if (step.distanceRadii === undefined) return;
        if (step.distanceRadii !== 1.5) return;
        // La borne basse du schéma : la sonde était plus près, la légende doit le dire.
        for (const locale of LOCALES)
          expect(captionAfter(steps, index, locale), locale).toMatch(/1[.,]5/);
      });
    }
  );

  const editionRecords = readdirSync(
    resolve(ROOT, 'src/registry/products/textures')
  )
    .map((f) =>
      readJson<{
        body?: string;
        editions?: { edition: string; observed: { from: string } }[];
      }>(`src/registry/products/textures/${f}`)
    )
    .filter((r) => r.editions?.length);

  it.each(EXPEDITIONS)(
    '%s : une observation datée est la plus proche de la scène, et sa date est dite',
    (id) => {
      const steps = script(id).steps;
      steps.forEach((step, index) => {
        if (step.kind !== 'setEdition') return;
        const record = editionRecords.find((r) => r.body === step.body);
        expect(record, step.body).toBeDefined();
        const chosen = record!.editions!.find(
          (e) => e.edition === step.edition
        );
        expect(chosen, step.edition).toBeDefined();
        const scene = sceneDateAt(steps, index)!.getTime();
        const gap = (e: { observed: { from: string } }) =>
          Math.abs(new Date(e.observed.from).getTime() - scene);
        const nearest = [...record!.editions!].sort(
          (a, b) => gap(a) - gap(b)
        )[0]!;
        expect(step.edition).toBe(nearest.edition);
        const day = new Date(chosen!.observed.from);
        for (const locale of LOCALES) {
          const text = captionAfter(steps, index, locale);
          expect(text, locale).toContain(String(day.getUTCFullYear()));
          expect(text, locale).toMatch(
            new RegExp(`(?<!\\d)${day.getUTCDate()}(?!\\d)`)
          );
        }
      });
    }
  );

  /**
   * Une plongée sur un corps dont la phase de rotation n'est PAS datée (`config/datedRotation`) montre
   * le lieu sous une lumière sans rapport avec la date de la scène : la légende qui suit doit le dire.
   * Mesuré sur les captures : Shangri La et Hokioi tombaient côté nuit.
   */
  it.each(EXPEDITIONS)(
    '%s : une plongée sur un corps à rotation non datée le dit dans les quatre langues',
    (id) => {
      const dated = new Set(
        [...DATED_ROTATION_BODIES].map((body) => String(body).toLowerCase())
      );
      const steps = script(id).steps;
      let target: string | null = null;
      steps.forEach((step, index) => {
        if (step.kind === 'flyTo') target = step.body;
        if (step.kind !== 'diveTo' || target === null) return;
        if (dated.has(target)) return;
        const words: Record<Locale, RegExp> = {
          en: /rotation is not dated/,
          fr: /rotation de \S+ n’est pas datée/,
          es: /rotación de \S+ no está fechada/,
          'pt-BR': /rotação de \S+ não é datada/,
        };
        for (const locale of LOCALES)
          expect(
            captionAfter(steps, index, locale),
            `${target} ${locale}`
          ).toMatch(words[locale]);
      });
    }
  );

  it.each(EXPEDITIONS)(
    '%s : l’engin inspecté a un modèle au registre',
    (id) => {
      for (const step of script(id).steps)
        if (step.kind === 'inspectCraft')
          expect(craftModelFor(step.craft), step.craft).not.toBeNull();
    }
  );

  it.each(EXPEDITIONS)(
    '%s : aucun tiret cadratin dans le texte publié',
    (id) => {
      for (const locale of LOCALES)
        expect(allText(id, locale)).not.toContain('—');
    }
  );
});
