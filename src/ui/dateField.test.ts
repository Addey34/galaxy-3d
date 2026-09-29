import { describe, expect, it } from 'vitest';
import {
  dateFieldTarget,
  dateFieldValue,
  timeFieldTarget,
  timeFieldValue,
} from './dateField';

const at = (iso: string): Date => new Date(iso);

describe('dateFieldValue', () => {
  it('écrit toujours quatre chiffres d’année : sinon le champ se VIDE', () => {
    // Le défaut du lot 39, en une ligne : « 500-05-14 » n'est pas une date valide pour un
    // `<input type="date">`, et le navigateur remplace la valeur par la chaîne vide.
    const d = new Date(0);
    d.setUTCFullYear(500, 4, 14);
    expect(dateFieldValue(d)).toBe('0500-05-14');
    expect(/^\d{4}-\d{2}-\d{2}$/.test(dateFieldValue(d))).toBe(true);
  });

  it('reste inchangé pour les dates ordinaires', () => {
    expect(dateFieldValue(at('2026-09-29T18:04:05Z'))).toBe('2026-09-29');
    expect(dateFieldValue(at('9999-12-20T00:00:00Z'))).toBe('9999-12-20');
  });
});

describe('timeFieldValue', () => {
  it('écrit hh:mm:ss en UTC', () => {
    expect(timeFieldValue(at('2026-09-29T04:05:06Z'))).toBe('04:05:06');
  });
});

describe('dateFieldTarget', () => {
  it('relit une année à quatre chiffres sans la replier sur le XXe siècle', () => {
    // `new Date(50, 0, 1)` et `Date.UTC(50, 0, 1)` donnent 1950 : c'est la raison d'être de
    // `setUTCFullYear` ici, et ce test échoue si quelqu'un revient à l'un des deux.
    const target = dateFieldTarget('0050-03-04', at('2026-09-29T11:22:33Z'));
    expect(target?.getUTCFullYear()).toBe(50);
    expect(target?.getUTCMonth()).toBe(2);
    expect(target?.getUTCDate()).toBe(4);
  });

  it('conserve l’heure du jour', () => {
    const target = dateFieldTarget('1610-01-07', at('2026-09-29T11:22:33Z'));
    expect(target?.toISOString()).toBe('1610-01-07T11:22:33.000Z');
  });

  it('refuse une valeur vide ou mal formée plutôt que de sauter n’importe où', () => {
    const now = at('2026-09-29T11:22:33Z');
    expect(dateFieldTarget('', now)).toBeNull();
    expect(dateFieldTarget('500-05-14', now)).toBeNull();
    expect(dateFieldTarget('pas-une-date', now)).toBeNull();
  });
});

describe('timeFieldTarget', () => {
  it('lit hh:mm:ss et hh:mm, et conserve le jour', () => {
    const day = at('1610-01-07T11:22:33Z');
    expect(timeFieldTarget('04:05:06', day)?.toISOString()).toBe(
      '1610-01-07T04:05:06.000Z'
    );
    expect(timeFieldTarget('04:05', day)?.toISOString()).toBe(
      '1610-01-07T04:05:00.000Z'
    );
    expect(timeFieldTarget('', day)).toBeNull();
  });
});
