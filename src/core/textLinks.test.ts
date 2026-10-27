import { describe, expect, it } from 'vitest';
import { splitUrls } from './textLinks';

describe('splitUrls', () => {
  it('rend un texte sans adresse en un seul morceau', () => {
    expect(splitUrls('© IGN, BD TOPO')).toEqual([
      { kind: 'text', value: '© IGN, BD TOPO' },
    ]);
  });

  it("isole l'adresse finale de l'attribution ODbL", () => {
    const text =
      'made available here under the Open Database License (ODbL), https://opendatacommons.org/licenses/odbl/1-0/';
    expect(splitUrls(text)).toEqual([
      {
        kind: 'text',
        value: 'made available here under the Open Database License (ODbL), ',
      },
      { kind: 'url', value: 'https://opendatacommons.org/licenses/odbl/1-0/' },
    ]);
  });

  it('laisse la ponctuation finale dans le texte', () => {
    expect(splitUrls('voir (https://a.org/x), puis https://b.org/y.')).toEqual([
      { kind: 'text', value: 'voir (' },
      { kind: 'url', value: 'https://a.org/x' },
      { kind: 'text', value: '), puis ' },
      { kind: 'url', value: 'https://b.org/y' },
      { kind: 'text', value: '.' },
    ]);
  });

  it('recolle exactement le texte de départ', () => {
    const text = 'a https://x.org/p. b https://y.org/q, c';
    expect(
      splitUrls(text)
        .map((p) => p.value)
        .join('')
    ).toBe(text);
  });

  it('ne rend pas cliquable un http en clair', () => {
    expect(splitUrls('http://x.org')).toEqual([
      { kind: 'text', value: 'http://x.org' },
    ]);
  });
});
