import { describe, expect, it } from 'vitest';
import { doiUrl, splitCitation } from './citationParts';

describe('splitCitation', () => {
  it('fait de chaque DOI présent un morceau, le reste reste du texte', () => {
    expect(
      splitCitation('A (2020). T. doi:10.1/a ; B. doi:10.2/b.', [
        '10.1/a',
        '10.2/b',
      ])
    ).toEqual([
      { kind: 'text', text: 'A (2020). T. doi:' },
      { kind: 'doi', doi: '10.1/a' },
      { kind: 'text', text: ' ; B. doi:' },
      { kind: 'doi', doi: '10.2/b' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('ignore un DOI absent du texte et un DOI vide', () => {
    expect(splitCitation('sans identifiant', ['10.9/z', ''])).toEqual([
      { kind: 'text', text: 'sans identifiant' },
    ]);
  });

  it('préfère le DOI le plus long quand l’un préfixe l’autre', () => {
    expect(splitCitation('10.1/ab', ['10.1/a', '10.1/ab'])).toEqual([
      { kind: 'doi', doi: '10.1/ab' },
    ]);
  });

  it('rend le même texte une fois les morceaux recollés', () => {
    const text = 'x 10.1/a y 10.1/a z';
    const joined = splitCitation(text, ['10.1/a'])
      .map((p) => (p.kind === 'text' ? p.text : p.doi))
      .join('');
    expect(joined).toBe(text);
  });
});

describe('doiUrl', () => {
  it('pointe sur doi.org et encode les caractères réservés', () => {
    expect(doiUrl('10.1088/0004-6256/139/6/2700')).toBe(
      'https://doi.org/10.1088/0004-6256/139/6/2700'
    );
    expect(doiUrl('10.1002/(SICI)1097 x')).toBe(
      'https://doi.org/10.1002/(SICI)1097%20x'
    );
  });
});
