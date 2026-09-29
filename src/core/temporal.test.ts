import { describe, it, expect } from 'vitest';
import {
  classifyTemporal,
  signedDistanceToInterval,
  spanInterval,
  temporalCategoryLabelKey,
  utcDayInterval,
  utcHourInterval,
  utcMonthInterval,
  DAY_MS,
  TEMPORAL_CATEGORIES,
  type DatedProduct,
} from './temporal';

const now = new Date('2026-08-14T12:00:00Z');
const at = (iso: string) => new Date(iso);
const instant = (iso: string) => ({
  from: Date.parse(iso),
  to: Date.parse(iso),
});

describe('intervalles', () => {
  it('jour, mois et heure UTC', () => {
    expect(utcDayInterval('2026-08-14')).toEqual({
      from: Date.parse('2026-08-14T00:00:00Z'),
      to: Date.parse('2026-08-15T00:00:00Z'),
    });
    // Décembre → janvier de l'année suivante.
    expect(utcMonthInterval('2025-12-01')).toEqual({
      from: Date.parse('2025-12-01T00:00:00Z'),
      to: Date.parse('2026-01-01T00:00:00Z'),
    });
    expect(utcHourInterval(at('2026-08-14T09:40:12Z'))).toEqual(
      spanInterval(Date.parse('2026-08-14T09:00:00Z'), 3_600_000)
    );
  });

  it('distance signée : positive si l’intervalle est après, nulle dedans', () => {
    const day = utcDayInterval('2026-08-14');
    expect(
      signedDistanceToInterval(Date.parse('2026-08-14T08:00:00Z'), day)
    ).toBe(0);
    expect(
      signedDistanceToInterval(Date.parse('2026-08-13T00:00:00Z'), day)
    ).toBe(DAY_MS);
    expect(
      signedDistanceToInterval(Date.parse('2026-08-16T00:00:00Z'), day)
    ).toBe(-DAY_MS);
  });
});

describe('classifyTemporal', () => {
  it('la NATURE décide mesure ou modèle : même date passée, deux catégories', () => {
    const validTime = utcDayInterval('2026-08-10');
    const sim = at('2026-08-10T12:00:00Z');
    expect(
      classifyTemporal({ kind: 'measurement', validTime }, sim, now).category
    ).toBe('observed');
    expect(
      classifyTemporal({ kind: 'reanalysis', validTime }, sim, now).category
    ).toBe('reconstructed');
    expect(
      classifyTemporal(
        { kind: 'ephemeris', validTime: instant('1950-01-01T00:00:00Z') },
        at('1950-01-01T00:00:00Z'),
        now
      ).category
    ).toBe('reconstructed');
  });

  it('un instant futur est prédit, jamais observé', () => {
    const sim = at('2030-01-01T00:00:00Z');
    const validTime = instant('2030-01-01T00:00:00Z');
    expect(
      classifyTemporal({ kind: 'ephemeris', validTime }, sim, now).category
    ).toBe('predicted');
    // Même une « mesure » future mal déclarée n'est pas présentée comme une observation.
    expect(
      classifyTemporal({ kind: 'measurement', validTime }, sim, now).category
    ).toBe('predicted');
  });

  it('confiance réduite au-delà de l’horizon fiable, catégorie inchangée', () => {
    const product = (iso: string): DatedProduct => ({
      kind: 'forecastModel',
      validTime: instant(iso),
      reliableHorizonMs: 7 * DAY_MS,
    });
    expect(
      classifyTemporal(
        product('2026-08-18T12:00:00Z'),
        at('2026-08-18T12:00:00Z'),
        now
      )
    ).toMatchObject({ category: 'predicted', confidence: 'nominal' });
    expect(
      classifyTemporal(
        product('2026-08-25T12:00:00Z'),
        at('2026-08-25T12:00:00Z'),
        now
      )
    ).toMatchObject({ category: 'predicted', confidence: 'reduced' });
  });

  it('hors de la fenêtre mesurée → extrapolé, avant toute autre règle', () => {
    const measured = {
      from: Date.parse('2016-01-01T00:00:00Z'),
      to: Date.parse('2036-01-01T00:00:00Z'),
    };
    const product = (iso: string): DatedProduct => ({
      kind: 'ephemeris',
      validTime: instant(iso),
      measured,
      liveToleranceMs: 5 * 60_000,
    });
    expect(
      classifyTemporal(
        product('2050-01-01T00:00:00Z'),
        at('2050-01-01T00:00:00Z'),
        now
      ).category
    ).toBe('extrapolated');
    expect(
      classifyTemporal(
        product('1990-01-01T00:00:00Z'),
        at('1990-01-01T00:00:00Z'),
        now
      ).category
    ).toBe('extrapolated');
    // Fenêtre ouverte d'un côté : aucune borne de ce côté.
    expect(
      classifyTemporal(
        {
          kind: 'ephemeris',
          validTime: instant('1500-01-01T00:00:00Z'),
          measured: { from: null, to: measured.to },
        },
        at('1500-01-01T00:00:00Z'),
        now
      ).category
    ).toBe('reconstructed');
  });

  it('en direct seulement si la source l’autorise ET que scène et donnée sont au présent', () => {
    const live: DatedProduct = {
      kind: 'ephemeris',
      validTime: instant('2026-08-14T12:02:00Z'),
      liveToleranceMs: 5 * 60_000,
    };
    expect(
      classifyTemporal(live, at('2026-08-14T12:02:00Z'), now).category
    ).toBe('live');
    // Scène à 10 min du présent : plus en direct.
    const later = { ...live, validTime: instant('2026-08-14T12:10:00Z') };
    expect(
      classifyTemporal(later, at('2026-08-14T12:10:00Z'), now).category
    ).toBe('predicted');
    // Sans tolérance déclarée (tuile satellite), jamais en direct.
    const tile: DatedProduct = {
      kind: 'measurement',
      validTime: utcDayInterval('2026-08-14'),
    };
    expect(classifyTemporal(tile, now, now).category).toBe('observed');
  });

  it('écart à la scène : signalé au-delà de la tolérance, signé', () => {
    // Tuile du 12/08 servie pour une scène en 2030 : donnée ANTÉRIEURE à la scène.
    const tile: DatedProduct = {
      kind: 'measurement',
      validTime: utcDayInterval('2026-08-12'),
    };
    const stale = classifyTemporal(tile, at('2030-01-01T00:00:00Z'), now);
    expect(stale.offset).toBe(true);
    expect(stale.offsetMs).toBeLessThan(0);
    // Scène dans le jour décrit : aucun écart.
    expect(
      classifyTemporal(tile, at('2026-08-12T23:00:00Z'), now)
    ).toMatchObject({
      offset: false,
      offsetMs: 0,
    });
    // Valeur horaire de 09:00 pour une scène à 09:40, tolérance d'une heure : pas d'écart signalé.
    const hourly: DatedProduct = {
      kind: 'reanalysis',
      validTime: instant('2020-06-01T09:00:00Z'),
      offsetToleranceMs: 3_600_000,
    };
    const within = classifyTemporal(hourly, at('2020-06-01T09:40:00Z'), now);
    expect(within.offset).toBe(false);
    expect(within.offsetMs).toBe(-40 * 60_000);
  });

  it('un événement rapporté n’est ni une mesure ni un modèle', () => {
    // La distinction est le point du lot : un séisme mesuré et un incendie rapporté par un
    // tiers se dessinent sur la même sphère et ne disent pas la même chose.
    const report: DatedProduct = {
      kind: 'report',
      validTime: {
        from: at('2026-08-01T00:00:00Z').getTime(),
        to: at('2026-08-05T00:00:00Z').getTime(),
      },
    };
    expect(
      classifyTemporal(report, at('2026-08-03T00:00:00Z'), now).category
    ).toBe('reported');
    const measurement: DatedProduct = {
      kind: 'measurement',
      validTime: report.validTime,
    };
    expect(
      classifyTemporal(measurement, at('2026-08-03T00:00:00Z'), now).category
    ).toBe('observed');
  });

  it('un intervalle OUVERT va jusqu’à maintenant, et pas au-delà', () => {
    // « Pas de fin déclarée » ne veut pas dire « sans fin » : personne ne sait ce qui est
    // encore en cours après l'instant réel, donc une scène plus tardive garde son écart.
    const ongoing: DatedProduct = {
      kind: 'report',
      validTime: {
        from: at('2026-08-01T00:00:00Z').getTime(),
        to: at('2026-08-05T00:00:00Z').getTime(),
      },
      openEnded: true,
    };
    const atNow = classifyTemporal(ongoing, now, now);
    expect(atNow.ongoing).toBe(true);
    expect(atNow.offset).toBe(false);
    expect(atNow.offsetMs).toBe(0);

    const later = classifyTemporal(ongoing, at('2030-01-01T00:00:00Z'), now);
    expect(later.ongoing).toBe(true);
    expect(later.offset).toBe(true);
    expect(later.offsetMs).toBeLessThan(0);

    // Sans le drapeau, la même donnée s'arrête à son dernier relevé.
    const closed = classifyTemporal({ ...ongoing, openEnded: false }, now, now);
    expect(closed.ongoing).toBe(false);
    expect(closed.offset).toBe(true);
  });

  it('une clé i18n par catégorie', () => {
    expect(TEMPORAL_CATEGORIES.map(temporalCategoryLabelKey)).toContain(
      'time.category.extrapolated'
    );
  });
});

/**
 * LA CATÉGORIE NE DÉPEND QUE DE CE QUE LE PRODUIT DÉCLARE, et de rien d'autre.
 *
 * L'en-tête de `core/temporal.ts` porte depuis longtemps une affirmation : `observationTime` et
 * `publicationTime` — quand la mesure a été prise, quand la source l'a publiée — ne sont PAS
 * portés par `DatedProduct`, parce qu'AUCUNE catégorie n'en dépend. C'était vrai, et ce n'était
 * qu'une phrase : rien ne serait tombé si quelqu'un s'était mis à lire un de ces champs pour
 * décider d'une catégorie, et la phrase serait devenue fausse en silence.
 *
 * Cette garde la rend vérifiable, et par le seul moyen honnête : on ajoute ces deux champs au
 * produit, avec des valeurs ABSURDES, et on exige que l'horodatage rendu soit identique octet
 * pour octet. C'est la ligne 22.8 (c), fermée par sa SECONDE branche — le besoin n'existe
 * toujours pas, mais l'affirmation ne repose plus sur la bonne foi du lecteur.
 *
 * Si un jour une catégorie doit dépendre de la date de publication (par exemple pour distinguer
 * une réanalyse rejouée d'une réanalyse d'époque), c'est CE test qui tombera en premier, et
 * c'est là qu'il faudra écrire la nouvelle règle.
 */
describe('la catégorie ignore ce que le produit ne déclare pas', () => {
  const validTime = utcDayInterval('2026-08-10');
  const sim = at('2026-08-10T12:00:00Z');
  const cases: { readonly what: string; readonly product: DatedProduct }[] = [
    { what: 'mesure', product: { kind: 'measurement', validTime } },
    { what: 'réanalyse', product: { kind: 'reanalysis', validTime } },
    { what: 'éphéméride', product: { kind: 'ephemeris', validTime } },
    {
      what: 'prévision',
      product: {
        kind: 'forecastModel',
        validTime: {
          from: at('2026-08-14T00:00:00Z').getTime(),
          to: at('2026-08-24T00:00:00Z').getTime(),
        },
        reliableHorizonMs: 5 * 86_400_000,
      },
    },
    {
      what: 'signalement en cours',
      product: { kind: 'report', validTime, openEnded: true },
    },
  ];

  for (const { what, product } of cases)
    it(`${what} : deux champs de plus ne changent rien`, () => {
      const reference = classifyTemporal(product, sim, now);
      // Des valeurs volontairement incohérentes : si une branche les lisait, elle basculerait.
      const polluted = {
        ...product,
        observationTime: at('1801-01-01T00:00:00Z').getTime(),
        publicationTime: at('2999-12-31T00:00:00Z').getTime(),
      } as DatedProduct;
      expect(classifyTemporal(polluted, sim, now)).toEqual(reference);
    });
});
