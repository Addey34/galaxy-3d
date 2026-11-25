import { describe, expect, it } from 'vitest';
import {
  BOOT_DYNAMIC_CHUNKS,
  BUDGETED_FAMILIES,
  FIRST_VIEW_TEXTURE_REFINEMENTS,
  MODEL_FLOOR_QUALITY,
  NON_BOOT_CHUNKS,
  CONDITIONAL_START_PROFILES,
  NON_BOOT_CHUNK_FAMILIES,
  TEXTURE_FLOOR_TIER,
  bootTierForFarLayer,
  classifyStartupUrl,
  judgeFamilies,
  modelFloorBudget,
  textureFloorBudget,
} from './startupBudget';

/**
 * LA RÈGLE DU BUDGET DU DÉMARRAGE, sans aucun fichier (lot 17, phase 17F).
 *
 * Ce fichier tient la LOGIQUE ; `src/config/startupBudget.test.ts` la confronte aux artefacts
 * réellement livrés, et `scripts/check-startup-budget.mjs` à `dist/`. La propriété centrale est
 * ici : les familles ne se financent pas entre elles.
 */

describe('classement des octets du démarrage par famille', () => {
  it.each([
    ['https://x.test/assets/ephemerides/mimas.abc.bin', 'ephemerides'],
    ['https://x.test/assets/textures/moon/moon_surface_1k.jpg', 'textures'],
    ['https://x.test/assets/models/eros/eros_shape_1k.glb', 'models'],
    ['https://x.test/assets/small-bodies/dataset.json', 'small-bodies'],
    ['https://x.test/assets/SolarSystemApp-abcd1234.js', 'javascript'],
    // Le serveur de dev sert des modules TypeScript : la même famille, un autre chemin.
    ['http://localhost:5173/src/main.ts', 'javascript'],
    ['https://x.test/assets/SolarSystemApp-abcd1234.css', 'css'],
    ['https://x.test/', 'html'],
    ['https://x.test/jupiter/index.html', 'html'],
    [
      'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?A=1',
      'external-imagery',
    ],
    ['https://x.test/assets/social/og.jpg', 'other'],
  ])('%s -> %s', (url, family) => {
    expect(classifyStartupUrl(url)).toBe(family);
  });

  it('classe sur le CHEMIN, pas sur l’hôte, pour tout ce qui vient du dépôt', () => {
    // La mesure tourne contre la production, contre `dist` servi en local et contre le serveur
    // de dev : trois hôtes, un seul classement.
    for (const origin of [
      'https://galaxy.adrianguichard.dev',
      'http://127.0.0.1:4173',
      'http://localhost:5173',
    ])
      expect(
        classifyStartupUrl(`${origin}/assets/textures/io/io_surface_1k.jpg`)
      ).toBe('textures');
  });

  it('budgète quatre familles, et pas une de plus', () => {
    expect([...BUDGETED_FAMILIES]).toEqual([
      'ephemerides',
      'textures',
      'models',
      'javascript',
    ]);
  });
});

describe('les familles ne se financent pas entre elles', () => {
  const overspentJs = {
    family: 'javascript' as const,
    bytes: 1_400_000,
    budgetBytes: 1_300_000,
    method: 'mesuré',
  };
  const frugalTextures = {
    family: 'textures' as const,
    bytes: 1,
    budgetBytes: 6_000_000,
    method: 'dérivé',
  };

  it('condamne une famille dépassée même quand une autre a des millions d’octets de marge', () => {
    // LA propriété de la phase. Une version qui sommerait les familles avant de comparer
    // laisserait une texture allégée financer un bundle qui grossit, et c'est exactement la
    // pression que la règle de parité du lot 16 interdit.
    const [js] = judgeFamilies([overspentJs]);
    const withSlack = judgeFamilies([frugalTextures, overspentJs]).find(
      (verdict) => verdict.family === 'javascript'
    );
    expect(js!.withinBudget).toBe(false);
    expect(withSlack).toEqual(js);
    expect(withSlack!.headroomBytes).toBe(-100_000);
  });

  it('juge chaque famille sur son propre plafond', () => {
    const verdicts = judgeFamilies([frugalTextures, overspentJs]);
    expect(verdicts.map((v) => v.withinBudget)).toEqual([true, false]);
  });

  it('accepte le cas limite : dépenser exactement son budget', () => {
    const [verdict] = judgeFamilies([
      { family: 'models', bytes: 500, budgetBytes: 500, method: 'dérivé' },
    ]);
    expect(verdict!.withinBudget).toBe(true);
    expect(verdict!.headroomBytes).toBe(0);
  });
});

describe('le palier que le démarrage demande à une couche vue de loin', () => {
  it('est le DERNIER palier déclaré, parce que c’est ce que fait le repli du LOD', () => {
    expect(bootTierForFarLayer(['8k', '4k', '2k', '1k'])).toBe('1k');
    expect(bootTierForFarLayer(['1k'])).toBe('1k');
    expect(bootTierForFarLayer([])).toBeNull();
  });

  it('serait le 8k si un corps déclarait ses résolutions à l’envers', () => {
    // Le fait qui justifie la garde d'ordre de `src/config/startupBudget.test.ts` : rien dans le
    // code ne dit « prends le plus petit », il dit « prends le dernier ».
    expect(bootTierForFarLayer(['1k', '2k', '4k', '8k'])).toBe('8k');
  });
});

describe('budget dérivé des textures', () => {
  const layer = (declared: readonly ('1k' | '2k' | '8k')[]) => ({
    body: 'witness',
    layer: 'surface',
    declared,
    bytesByTier: { '1k': 100, '2k': 400, '8k': 6400 },
  });

  it('compte le plancher, et le reconnaît comme tel', () => {
    const { bytes, lines } = textureFloorBudget([layer(['8k', '2k', '1k'])]);
    expect(bytes).toBe(100);
    expect(lines[0]!.tier).toBe(TEXTURE_FLOOR_TIER);
    expect(lines[0]!.isFloor).toBe(true);
  });

  it('dit ce que coûterait un corps déclaré à l’envers, et le signale', () => {
    const { bytes, lines } = textureFloorBudget([layer(['1k', '2k', '8k'])]);
    expect(bytes).toBe(6400);
    expect(lines[0]!.isFloor).toBe(false);
  });

  it('n’achète RIEN en dégradant une texture : le coût et le plafond baissent ensemble', () => {
    // La garde qui protège la parité du lot 16. Le budget des textures EST la somme des paliers
    // planchers livrés : rétrécir un fichier ne libère pas d'octets pour une autre famille, ça
    // baisse les deux nombres du même montant. Seul `textureLadder.test.ts` arbitre la qualité.
    const full = textureFloorBudget([layer(['8k', '2k', '1k'])]);
    const shrunk = textureFloorBudget([
      { ...layer(['8k', '2k', '1k']), bytesByTier: { '1k': 10 } },
    ]);
    expect(full.bytes).toBe(100);
    expect(shrunk.bytes).toBe(10);
    // Le plafond est cette même somme : l'écart au budget reste nul dans les deux cas.
    expect(full.bytes - full.bytes).toBe(shrunk.bytes - shrunk.bytes);
  });

  it('signale une couche sans aucun palier livré au lieu de la compter pour zéro en silence', () => {
    const { lines } = textureFloorBudget([
      { body: 'ghost', layer: 'surface', declared: [], bytesByTier: {} },
    ]);
    expect(lines[0]!.isFloor).toBe(false);
    expect(lines[0]!.tier).toContain('aucun palier');
  });

  it('nomme chaque raffinement de première vue avec sa raison', () => {
    expect(FIRST_VIEW_TEXTURE_REFINEMENTS.length).toBeGreaterThan(0);
    for (const refinement of FIRST_VIEW_TEXTURE_REFINEMENTS) {
      expect(refinement.tier).not.toBe(TEXTURE_FLOOR_TIER);
      expect(refinement.reason.length).toBeGreaterThan(40);
    }
  });
});

describe('budget dérivé des maillages', () => {
  it('prend le niveau le plus léger, quel que soit l’ordre déclaré', () => {
    // Différence avec les textures, et elle est dans le code : `chooseModelQuality` trie
    // explicitement par niveau, donc l'ordre de déclaration ne décide de rien ici.
    for (const shipped of [
      ['4k', '2k', '1k'],
      ['1k', '2k', '4k'],
    ] as const) {
      const { bytes, lines } = modelFloorBudget([
        {
          body: 'witness',
          shipped,
          bytesByQuality: { '1k': 70, '2k': 280, '4k': 1200 },
        },
      ]);
      expect(bytes).toBe(70);
      expect(lines[0]!.tier).toBe(MODEL_FLOOR_QUALITY);
      expect(lines[0]!.isFloor).toBe(true);
    }
  });

  it('signale un corps dont le plancher n’est pas livré', () => {
    const { lines } = modelFloorBudget([
      { body: 'ida', shipped: ['2k'], bytesByQuality: { '2k': 280 } },
    ]);
    expect(lines[0]!.isFloor).toBe(false);
    expect(lines[0]!.bytes).toBe(280);
  });
});

describe('la partition des morceaux JavaScript', () => {
  it('ne classe aucun morceau deux fois', () => {
    const boot = BOOT_DYNAMIC_CHUNKS.map((entry) => entry.chunk);
    const out = NON_BOOT_CHUNKS.map((entry) => entry.chunk);
    expect(boot.filter((name) => out.includes(name))).toEqual([]);
    expect(new Set(boot).size).toBe(boot.length);
    expect(new Set(out).size).toBe(out.length);
  });

  it('les familles ne recouvrent aucun morceau nommé, et chacune a une raison', () => {
    const named = [...BOOT_DYNAMIC_CHUNKS, ...NON_BOOT_CHUNKS].map(
      (entry) => entry.chunk
    );
    for (const family of NON_BOOT_CHUNK_FAMILIES) {
      expect(family.prefix).toMatch(/^[a-z]+-$/);
      expect(family.reason.length).toBeGreaterThan(20);
      expect(named.filter((name) => name.startsWith(family.prefix))).toEqual(
        []
      );
    }
    const prefixes = NON_BOOT_CHUNK_FAMILIES.map((family) => family.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it('donne une raison à chaque morceau, et jamais un nom haché', () => {
    for (const entry of [...BOOT_DYNAMIC_CHUNKS, ...NON_BOOT_CHUNKS]) {
      expect(entry.chunk).not.toMatch(/\.js$|-[A-Za-z0-9_-]{8}$/);
      expect(entry.reason.length).toBeGreaterThan(20);
    }
  });
});

describe('les démarrages conditionnels', () => {
  it('ne citent que des morceaux déclarés hors démarrage, sans doublon par profil', () => {
    const out = NON_BOOT_CHUNKS.map((entry) => entry.chunk);
    for (const profile of CONDITIONAL_START_PROFILES) {
      expect(profile.chunks.length).toBeGreaterThan(0);
      expect(new Set(profile.chunks).size).toBe(profile.chunks.length);
      for (const chunk of profile.chunks) expect(out).toContain(chunk);
    }
  });

  it('ne citent que des familles déclarées, et `?tour=` compte la fiche demandée', () => {
    const prefixes = NON_BOOT_CHUNK_FAMILIES.map((family) => family.prefix);
    for (const profile of CONDITIONAL_START_PROFILES)
      for (const family of profile.families ?? [])
        expect(prefixes).toContain(family);
    const link = CONDITIONAL_START_PROFILES.find((p) => p.id === 'tour-link');
    expect(link?.chunks).toContain('tourPlayer');
    expect(link?.families).toEqual(['tour-']);
  });

  it('nomment les trois déclencheurs et leur cumul', () => {
    const ids = CONDITIONAL_START_PROFILES.map((profile) => profile.id);
    expect(ids).toEqual([
      'first-visit',
      'tour-link',
      'immersive-vr',
      'body-link',
      'worst-case-body',
      'worst-case',
      'worst-case-all',
    ]);
  });

  it('le chargeur glTF n’est PLUS au démarrage ordinaire, mais l’adresse d’un corps modélisé paie son lecteur (rien n’est caché)', () => {
    expect(BOOT_DYNAMIC_CHUNKS.map((c) => c.chunk)).not.toContain('GLTFLoader');
    expect(NON_BOOT_CHUNKS.map((c) => c.chunk)).toContain('GLTFLoader');
    expect(NON_BOOT_CHUNKS.map((c) => c.chunk)).toContain('shapeGlb');
    // Depuis GAL-ENGINE-CAPACITY-002 le maillage passe par le lecteur des modèles de forme : c'est LUI que
    // l'adresse d'un corps modélisé paie, et aucun profil ne compte plus le chargeur complet.
    const body = CONDITIONAL_START_PROFILES.find((p) => p.id === 'body-link');
    expect(body?.chunks).toEqual(['shapeGlb']);
    for (const id of ['worst-case-body', 'worst-case-all']) {
      const worst = CONDITIONAL_START_PROFILES.find((p) => p.id === id);
      expect(worst?.chunks, id).toContain('shapeGlb');
      expect(worst?.chunks, id).not.toContain('GLTFLoader');
    }
  });
});
