import { describe, expect, it } from 'vitest';
import {
  ECLIPSE_PAGE_WINDOW,
  ECLIPSE_PEAK_TOLERANCE_MS,
  eclipseFocusBody,
  eclipseViewFrom,
  eclipseForSlug,
  eclipseFromPathname,
  eclipsePathname,
  eclipseSlug,
  eclipseStillDescribed,
  eclipseTitleKey,
  eclipsesInPageWindow,
  formatEclipseDate,
} from './eclipsePages';
import { messages } from '@/i18n/locales';

const eclipses = eclipsesInPageWindow();
const bySlug = (slug: string) => {
  const found = eclipses.find((event) => eclipseSlug(event) === slug);
  if (!found) throw new Error(`éclipse absente : ${slug}`);
  return found;
};

describe('eclipsesInPageWindow', () => {
  it('lists the 53 eclipses of 2024-2035, in order, inside the window', () => {
    // 53 : compté sur astronomy-engine au moment du choix de la fenêtre (2026-09-15). Un
    // changement ici veut dire que le calcul a bougé — et donc des URL déjà indexées.
    expect(eclipses).toHaveLength(53);
    for (let i = 1; i < eclipses.length; i++)
      expect(eclipses[i]!.date.getTime()).toBeGreaterThan(
        eclipses[i - 1]!.date.getTime()
      );
    expect(eclipses[0]!.date >= ECLIPSE_PAGE_WINDOW.from).toBe(true);
    expect(eclipses.at(-1)!.date < ECLIPSE_PAGE_WINDOW.to).toBe(true);
  });

  it('gives every eclipse its own UTC day — the URL carries nothing else', () => {
    const slugs = eclipses.map(eclipseSlug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it.each([
    ['2024-04-08', 'solar-eclipse', 'total'],
    ['2026-08-12', 'solar-eclipse', 'total'],
    ['2026-08-28', 'lunar-eclipse', 'partial'],
    ['2027-08-02', 'solar-eclipse', 'total'],
  ] as const)('knows %s as a %s (%s)', (slug, kind, eclipseKind) => {
    const event = bySlug(slug);
    expect(event.kind).toBe(kind);
    expect(event.eclipseKind).toBe(eclipseKind);
  });
});

describe('eclipseForSlug — what the app recomputes on arrival', () => {
  it('finds the instant the build announced, for all 53 pages', () => {
    // La page et le voyage qu'elle déclenche passent par deux appels différents (fenêtre de
    // douze ans au build, journée seule à l'arrivée). La recherche itérative d'astronomy-engine
    // ne converge pas au même bit selon son point de départ : écart MESURÉ de 1 ms au plus
    // (2028-07-06) — la première version de ce test exigeait 0 et l'a trouvé. Une seconde de
    // tolérance : le permalien est à la seconde, et l'état en tolère soixante.
    for (const event of eclipses) {
      const found = eclipseForSlug(eclipseSlug(event));
      expect(
        Math.abs(found!.date.getTime() - event.date.getTime()),
        eclipseSlug(event)
      ).toBeLessThan(1000);
      expect(found?.eclipseKind).toBe(event.eclipseKind);
    }
  });

  it.each([
    ['2026-08-13', 'a day without eclipse'],
    ['2026-02-30', 'a date that does not exist'],
    // Normalisé par Date.parse sur le 2026-03-03, jour d'une vraie éclipse totale de Lune.
    ['2026-02-31', 'an impossible date that lands on a real eclipse day'],
    ['2023-10-14', 'a real eclipse, before the window'],
    ['2036-02-27', 'a real eclipse, after the window'],
    ['2026-8-12', 'a malformed day'],
    ['jupiter', 'not a date at all'],
  ])('refuses %s (%s)', (slug) => {
    expect(eclipseForSlug(slug)).toBeUndefined();
  });
});

describe('eclipseFromPathname', () => {
  it('reads /eclipse/<day>/ with or without its trailing slash', () => {
    expect(eclipseSlug(eclipseFromPathname('/eclipse/2026-08-12/')!)).toBe(
      '2026-08-12'
    );
    expect(eclipseFromPathname('/eclipse/2026-08-12')).toBeDefined();
  });

  it.each([
    '/',
    '/eclipse/',
    '/jupiter/',
    '/eclipse/2026-08-12/extra/',
    '/eclipses/2026-08-12/',
  ])('names no eclipse on %s', (pathname) => {
    expect(eclipseFromPathname(pathname)).toBeUndefined();
  });

  it('writes back the path it reads', () => {
    for (const event of eclipses)
      expect(
        Math.abs(
          eclipseFromPathname(eclipsePathname(event))!.date.getTime() -
            event.date.getTime()
        )
      ).toBeLessThan(1000);
  });
});

describe('eclipseFocusBody', () => {
  it('opens a solar eclipse on the Earth and a lunar one on the Moon', () => {
    expect(eclipseFocusBody(bySlug('2026-08-12'))).toBe('earth');
    expect(eclipseFocusBody(bySlug('2026-08-28'))).toBe('moon');
  });
});

describe('eclipseViewFrom — d’où la page regarde l’éclipse', () => {
  it('impose la Terre pour une éclipse de Lune, rien pour une éclipse de Soleil', () => {
    // Une Lune éclipsée n'est cuivrée que sur la face tournée vers nous : cadrée d'ailleurs,
    // la page ouvrait sur un disque noir (la nuit lunaire, pas l'ombre terrestre).
    expect(eclipseViewFrom(bySlug('2026-08-28'))).toBe('earth');
    expect(eclipseViewFrom(bySlug('2026-08-12'))).toBeNull();
  });
});

describe('eclipseStillDescribed — when the address keeps /eclipse/…', () => {
  const event = bySlug('2026-08-12');
  const at = (offsetMs: number) => new Date(event.date.getTime() + offsetMs);

  it('holds at the peak, on the focused body', () => {
    expect(eclipseStillDescribed(event, 'earth', at(0))).toBe(true);
    expect(
      eclipseStillDescribed(event, 'earth', at(-ECLIPSE_PEAK_TOLERANCE_MS))
    ).toBe(true);
  });

  it('lets go as soon as the body or the date changes', () => {
    expect(eclipseStillDescribed(event, 'jupiter', at(0))).toBe(false);
    expect(eclipseStillDescribed(event, null, at(0))).toBe(false);
    expect(
      eclipseStillDescribed(
        event,
        'earth',
        at(ECLIPSE_PEAK_TOLERANCE_MS + 1000)
      )
    ).toBe(false);
  });
});

describe('eclipse titles', () => {
  it('formats the peak day with a FIXED locale per language', () => {
    const date = new Date('2026-08-12T17:45:00Z');
    expect(formatEclipseDate(date, 'en')).toBe('August 12, 2026');
    expect(formatEclipseDate(date, 'fr')).toBe('12 août 2026');
    expect(formatEclipseDate(new Date('2030-06-01T06:00:00Z'), 'fr')).toBe(
      '1er juin 2030'
    );
  });

  it('has a title in both languages for every eclipse of the window', () => {
    for (const event of eclipses) {
      const key = eclipseTitleKey(event);
      expect(messages.en[key], `${key} (en)`).toContain('{date}');
      expect(messages.fr[key], `${key} (fr)`).toContain('{date}');
    }
  });
});
