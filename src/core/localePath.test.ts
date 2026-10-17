import { describe, expect, it } from 'vitest';
import { LOCALES, LOCALE_PATH } from '@/i18n/locales';
import {
  eclipseFromPathname,
  eclipseForSlug,
  eclipsePathname,
} from './eclipsePages';
import { splitLocalePath, withLocalePrefix } from './localePath';
import { bodyFromPathname, pathnameForBody } from './permalink';

/**
 * LES PAGES LOCALISÉES DÉMARRENT SUR CE QU'ELLES NOMMENT (2026-10-17) : `/fr/moon/` sur la Lune,
 * `/fr/eclipse/2026-08-12/` à cette date. Les deux démarraient sur la vue d'ensemble, à la date du
 * jour, en production, depuis le lot 20.
 */
const BODIES = new Set(['moon', 'titan']);

describe('le segment de langue d’un chemin', () => {
  it.each(LOCALES)('la page de corps en %s nomme son corps', (locale) => {
    const prefix = LOCALE_PATH[locale];
    const path = withLocalePrefix(prefix, '/moon/');
    expect(bodyFromPathname(path, BODIES)).toBe('moon');
    // et l'écriture garde la langue : choisir Titan depuis cette page écrit SA page
    expect(pathnameForBody('titan', BODIES, path)).toBe(
      withLocalePrefix(prefix, '/titan/')
    );
  });

  it.each(LOCALES)('la page d’éclipse en %s porte sa date', (locale) => {
    const event = eclipseForSlug('2026-08-12')!;
    const path = eclipsePathname(event, LOCALE_PATH[locale]);
    expect(eclipseFromPathname(path)?.date.getTime()).toBe(
      event.date.getTime()
    );
  });

  it('un segment qui n’est pas une langue ne s’ôte pas', () => {
    expect(splitLocalePath('/de/moon/')).toEqual({
      prefix: '',
      segments: ['de', 'moon'],
    });
    expect(bodyFromPathname('/de/moon/', BODIES)).toBeUndefined();
    expect(bodyFromPathname('/fr/', BODIES)).toBeUndefined();
  });

  it('la vue d’ensemble reste la racine, aucune page /fr/ n’existant', () => {
    expect(pathnameForBody(null, BODIES, '/fr/moon/')).toBe('/');
  });
});
