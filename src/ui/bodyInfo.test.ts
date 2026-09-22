import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { flattenBodies } from '@/config/catalog';
import { NAVIGABLE_TARGETS } from '@/config/navigable';
import { setLocale } from '@/i18n';
import { bodySources, bodyStats, formatPositionProvenance } from './bodyInfo';

/**
 * Les libellés de la fiche sont des affirmations scientifiques. Chacun de ces cas a été livré
 * faux : « Distance (Terre) » pour Titan, « Jour » pour une rotation sidérale, « -142h 57m »
 * pour Triton, « Lunes : 8 » pour le Soleil.
 */
const CONFIGS = flattenBodies(CELESTIAL_CONFIG);
function stats(name: string): Map<string, string> {
  const cfg = CONFIGS.get(name);
  if (!cfg) throw new Error(`corps absent du catalogue : ${name}`);
  return new Map(bodyStats(name, cfg).map((s) => [s.label, s.value]));
}

describe('fiche d’information — libellés', () => {
  beforeAll(() => {
    // `setLocale` écrit `<html lang>` ; l'environnement de test n'a pas de DOM. Passer par
    // l'anglais d'abord : sur une machine française, la détection choisit déjà `fr` et
    // `setLocale('fr')` ne fait rien — c'est ainsi que ce test passait en local et cassait en CI.
    vi.stubGlobal('document', { documentElement: {} });
    setLocale('en');
    setLocale('fr');
  });

  it('mesure la distance d’un satellite depuis son parent réel', () => {
    const titan = stats('titan');
    expect(titan.has('Distance moyenne (Saturne)')).toBe(true);
    expect([...titan.keys()].join(' ')).not.toMatch(/Terre|Soleil/);
    expect(stats('io').has('Distance moyenne (Jupiter)')).toBe(true);
    expect(stats('jupiter').has('Distance moyenne (Soleil)')).toBe(true);
  });

  it('appelle la rotation sidérale par son nom, et sa durée reste positive', () => {
    const triton = stats('triton').get('Rotation sidérale');
    expect(triton).toBeDefined();
    expect(triton).not.toMatch(/-/);
    expect(stats('earth').has('Jour')).toBe(false);
  });

  it('dit « moyenne » pour une température moyenne', () => {
    expect(stats('mars').has('Température moyenne')).toBe(true);
  });

  it('ne compte pas de lunes au Soleil', () => {
    expect(stats('sun').has('Lunes connues')).toBe(false);
    expect(stats('earth').get('Lunes connues')).toBe('1');
  });
});

describe('fiche d’information : faits sourcés', () => {
  beforeAll(() => {
    vi.stubGlobal('document', { documentElement: {} });
    setLocale('en');
    setLocale('fr');
  });

  const statsOf = (name: string) => bodyStats(name, CONFIGS.get(name)!);
  const stat = (name: string, label: string) =>
    statsOf(name).find((s) => s.label === label);

  it('renvoie chaque valeur à une source numérotée de la liste', () => {
    const jupiter = statsOf('jupiter');
    const sources = bodySources('jupiter', CONFIGS.get('jupiter')!);
    const indexes = new Set(sources.map((s) => s.index));
    for (const s of jupiter) {
      expect(s.sourceIndex, s.label).toBeDefined();
      expect(indexes.has(s.sourceIndex!), s.label).toBe(true);
    }
    expect(sources.map((s) => s.publisher)).toEqual([
      'NASA NSSDCA',
      'NASA Science',
    ]);
  });

  it('date un fait qui évolue', () => {
    // 115 lunes n'est vrai qu'à une date : NASA Science l'annonce « as of August 2026 ».
    const moons = stat('jupiter', 'Lunes connues');
    expect(moons?.value).toBe('115');
    expect(moons?.asOf).toBe('août 2026');
  });

  it('dit « pas encore sourcée » plutôt que d’afficher un chiffre sans source', () => {
    // Titan portait « -179 °C » : une mesure locale de Huygens présentée comme une moyenne.
    const temperature = stat('titan', 'Température moyenne');
    expect(temperature?.value).toBe('n.d.');
    expect(temperature?.note).toMatch(/^Pas encore sourcée : /);
    expect(temperature?.sourceIndex).toBeUndefined();
  });

  it('distingue une donnée non publiée d’une donnée pas encore sourcée', () => {
    expect(stat('ganymede', 'Température moyenne')?.note).toMatch(
      /^Donnée non publiée : /
    );
  });

  it('montre une incertitude qui change la lecture du chiffre', () => {
    // Masse de Protée : GM 2,58 ± 2,42 km³/s² (JPL SSD).
    expect(stat('proteus', 'Masse')?.value).toMatch(/\(±\u00a094\u00a0%\)$/);
    expect(stat('titan', 'Masse')?.value).not.toMatch(/±/);
  });

  it('nomme la méthode dans la provenance', () => {
    expect(stat('titan', 'Masse')?.provenance).toMatch(/^valeur dérivée/);
    expect(stat('earth', 'Rayon')?.provenance).toMatch(/^valeur mesurée/);
  });
});

/**
 * Provenance temporelle de la position : la catégorie et l'écart mesuré sont DEUX axes. Les
 * confondre ferait lire « prédit » comme « précis » — les éléments d'Hygie, mesurés, s'écartent de 6e7 km.
 */
describe('fiche d’information — provenance de la position', () => {
  const stamp = {
    category: 'predicted' as const,
    confidence: 'nominal' as const,
    offsetMs: 0,
    offset: false,
    ongoing: false,
  };

  it('nomme la source, la catégorie et l’écart mesuré avec sa fenêtre', () => {
    const text = formatPositionProvenance({
      source: 'horizons',
      stamp,
      error: {
        from: Date.parse('1900-01-02T00:00:00Z'),
        to: Date.parse('2100-12-30T00:00:00Z'),
        meanKm: 3.546,
      },
    });
    expect(text.source).toBe('éphéméride JPL Horizons (précalculée) · prédit');
    expect(text.error).toContain('3,5 km');
    // Bornes arrondies à l'année la plus proche : 1900-01-02 et 2100-12-30 encadrent 1900-2100.
    expect(text.error).toContain('(1900–2100)');
  });

  it('arrondit le début à l’année la plus proche et la fin vers le bas', () => {
    // 2015-12-31 → 2016 au début ; fin exclusive 2036-01-01 → dernier jour mesuré en 2035.
    const text = formatPositionProvenance({
      source: 'kepler',
      stamp,
      error: {
        from: Date.parse('2015-12-31T00:00:00Z'),
        to: Date.parse('2036-01-01T00:00:00Z'),
        meanKm: 2110,
      },
    });
    expect(text.error).toContain('(2016–2035)');
  });

  it('dit qu’un écart n’a pas été mesuré plutôt que de n’en montrer aucun', () => {
    const text = formatPositionProvenance({
      source: 'kepler',
      stamp: { ...stamp, category: 'extrapolated' },
      error: null,
    });
    expect(text.source).toContain('éléments orbitaux képlériens');
    expect(text.source).toContain('extrapolé');
    expect(text.error).toBe('Écart à JPL Horizons non mesuré à cette date');
  });

  it('affiche la confiance réduite d’une prévision sans changer la catégorie', () => {
    const text = formatPositionProvenance({
      source: 'astronomy-engine',
      stamp: { ...stamp, confidence: 'reduced' },
      error: null,
    });
    expect(text.source).toContain('prédit · confiance réduite');
  });
});

/**
 * Lot 10 : le lanceur et le site d'une sonde sont des NOMS recopiés de la source, jamais
 * traduits ; la magnitude absolue porte son incertitude en valeur absolue, pas en pourcentage.
 */
describe('fiche d’information : faits nommés et magnitude', () => {
  beforeAll(() => {
    vi.stubGlobal('document', { documentElement: {} });
    setLocale('en');
    setLocale('fr');
  });

  const statOf = (name: string, label: string) =>
    bodyStats(name, NAVIGABLE_TARGETS.get(name)!).find(
      (s) => s.label === label
    );

  it('montre le lanceur et le site tels que la source les écrit, même en français', () => {
    expect(statOf('voyager1', 'Lanceur')?.value).toBe('Titan IIIE-Centaur');
    expect(statOf('voyager1', 'Site de lancement')?.value).toBe(
      'Cape Canaveral, United States'
    );
    expect(statOf('hayabusa2', 'Lanceur')?.sourceIndex).toBeDefined();
  });

  it('écrit l’incertitude d’une magnitude en magnitudes, pas en pour cent', () => {
    // 0,445 sur 22,08 ferait « 2 % », sous le seuil, donc tu : or 0,45 magnitude est un
    // facteur 1,5 sur la brillance.
    expect(statOf('oumuamua', 'Magnitude absolue')?.value).toBe(
      '22,08 (±\u00a00,45)'
    );
  });

  it('refuse la magnitude d’une comète interstellaire, avec la raison', () => {
    const atlas = statOf('atlas', 'Magnitude absolue');
    expect(atlas?.note).toMatch(/M1/);
    expect(atlas?.sourceIndex).toBeUndefined();
  });
});
