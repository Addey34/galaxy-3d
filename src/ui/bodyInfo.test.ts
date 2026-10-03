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
  beforeAll(async () => {
    // `setLocale` écrit `<html lang>` ; l'environnement de test n'a pas de DOM. Passer par
    // l'anglais d'abord : sur une machine française, la détection choisit déjà `fr` et
    // `setLocale('fr')` ne fait rien — c'est ainsi que ce test passait en local et cassait en CI.
    // Et l'ATTENDRE depuis le lot 20 : le dictionnaire arrive par un import dynamique, donc sans
    // `await` les seize cas de ce fichier comparaient des libellés français à un rendu anglais.
    vi.stubGlobal('document', { documentElement: {} });
    await setLocale('en');
    await setLocale('fr');
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
  beforeAll(async () => {
    vi.stubGlobal('document', { documentElement: {} });
    await setLocale('en');
    await setLocale('fr');
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

  it('date un fait qui évolue, et de la date de SA source quand elle en donne une', () => {
    // 115 lunes n'est vrai qu'à une date. NASA Science l'annonçait « as of August 2026 » jusqu'au
    // 2026-09-28, puis a retiré la mention : la fiche affiche alors le jour où la page a été LUE
    // (lot 25), et `factProvenance.test.ts` confronte cette date au relevé. Saturne, dont la page
    // donne toujours la sienne, garde celle de la SOURCE : les deux règles sont ici côte à côte.
    const moons = stat('jupiter', 'Lunes connues');
    expect(moons?.value).toBe('115');
    expect(moons?.asOf).toBe('septembre 2026');
    const saturn = stat('saturn', 'Lunes connues');
    expect(saturn?.value).toBe('293');
    expect(saturn?.asOf).toBe('août 2026');
  });

  it('n’affiche plus « pas encore sourcée » nulle part, et n’affiche pas non plus de chiffre sans source', () => {
    // Titan portait « -179 °C » : une mesure locale de Huygens présentée comme une moyenne.
    // Il dit aujourd'hui pourquoi il n'en affiche aucune, comme les 62 autres champs que le
    // lot 23 a rédigés. Le repli « pas encore sourcée » reste dans le code (`bodyFacts.ts`,
    // règle 4) et dans sa propre garde ; ce qu'il ne doit plus faire, c'est apparaître.
    const temperature = stat('titan', 'Température moyenne');
    expect(temperature?.value).toBe('n.d.');
    expect(temperature?.note).toMatch(/^Donnée non publiée : /);
    expect(temperature?.sourceIndex).toBeUndefined();
    const left: string[] = [];
    for (const [name, cfg] of CONFIGS)
      for (const entry of bodyStats(name, cfg))
        if (entry.note?.startsWith('Pas encore sourcée'))
          left.push(`${name} — ${entry.label}`);
    for (const [name, cfg] of NAVIGABLE_TARGETS)
      for (const entry of bodyStats(name, cfg))
        if (entry.note?.startsWith('Pas encore sourcée'))
          left.push(`${name} — ${entry.label}`);
    expect(left).toEqual([]);
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

  /**
   * AVANT L'AN 1 (ligne 22.10) : une tranche astronomique -1000 → 0 se lit « 1001 av. J.-C. –
   * 1 av. J.-C. », jamais « -1000–0 », que le permalien pourrait déjà faire afficher.
   */
  it('écrit une tranche avant notre ère en années avant J.-C.', () => {
    const text = formatPositionProvenance({
      source: 'astronomy-engine',
      stamp,
      error: {
        from: Date.parse('-001000-01-01T00:00:00Z'),
        to: Date.parse('0001-01-01T00:00:00Z'),
        meanKm: 1_000_000,
      },
    });
    expect(text.error).toContain('(1001 av. J.-C.–1 av. J.-C.)');
  });

  it('ne confond pas l’an 1 avec 1901 en arrondissant le début', () => {
    // `Date.UTC(1, 0, 1)` vaut 1901 : un début au 31 décembre de l'an 1 restait « 1 » au lieu de
    // s'arrondir à 2, l'année la plus proche. Le 1er janvier ne le montrerait pas (coïncidence).
    const text = formatPositionProvenance({
      source: 'astronomy-engine',
      stamp,
      error: {
        from: Date.parse('0001-12-31T00:00:00Z'),
        to: Date.parse('1000-01-01T00:00:00Z'),
        meanKm: 30_000,
      },
    });
    expect(text.error).toContain('(2–999)');
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

  /**
   * L'ÉCART QUI DÉPASSE LE DIAMÈTRE (ligne 22.10, 2026-10-03) : au-delà, la sphère dessinée et la
   * vraie ne se recouvrent plus, et la fiche le dit en une seconde phrase. La Terre vers 9998
   * av. J.-C. est la mesure réelle du résumé : 1 413 000 km pour un rayon de 6 371 km.
   */
  const deep = {
    from: Date.parse('-009997-01-01T00:00:00Z'),
    to: Date.parse('-009000-01-01T00:00:00Z'),
  };
  it('dit qu’un corps est dessiné hors de sa place quand l’écart dépasse son diamètre', () => {
    const text = formatPositionProvenance({
      source: 'astronomy-engine',
      stamp,
      error: { ...deep, meanKm: 1_413_000, radiusKm: 6371 },
    });
    expect(text.offset).toBe(
      'Soit 110 fois son diamètre : à cette date, le corps est dessiné hors de sa place réelle.'
    );
  });

  it('se tait tant que l’écart reste sous le diamètre, et sans rayon publié', () => {
    const at = (meanKm: number, radiusKm: number | null) =>
      formatPositionProvenance({
        source: 'horizons',
        stamp,
        error: { ...deep, meanKm, radiusKm },
      }).offset;
    // Juste sous et juste au-dessus d'un diamètre (2 × 100 km).
    expect(at(199, 100)).toBeNull();
    expect(at(201, 100)).toContain('1 fois son diamètre');
    // Une sonde n'a pas de rayon dans le résumé : aucune phrase plutôt qu'une division par rien.
    expect(at(1_000_000, null)).toBeNull();
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
  beforeAll(async () => {
    vi.stubGlobal('document', { documentElement: {} });
    await setLocale('en');
    await setLocale('fr');
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
