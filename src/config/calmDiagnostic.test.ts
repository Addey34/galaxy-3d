import { describe, expect, it } from 'vitest';
import {
  formatCalmWindow,
  parseCalmFrame,
  summarizeCalmWindow,
} from '../../e2e/calmDiagnostic';

describe('parseCalmFrame', () => {
  it('relit une image calme, occupée, en mouvement et combinée', () => {
    expect(parseCalmFrame('120')).toEqual({
      ms: 120,
      textures: 0,
      tiles: 0,
      moving: false,
    });
    expect(parseCalmFrame('1315+4tile')).toMatchObject({ tiles: 4 });
    expect(parseCalmFrame('900+2tex~')).toMatchObject({
      textures: 2,
      moving: true,
    });
    expect(parseCalmFrame('2000+3tex+6tile~')).toEqual({
      ms: 2000,
      textures: 3,
      tiles: 6,
      moving: true,
    });
  });

  it('refuse un format inconnu', () => {
    expect(parseCalmFrame('abc')).toBeNull();
    expect(parseCalmFrame('')).toBeNull();
  });
});

describe('summarizeCalmWindow', () => {
  const series = [
    '100',
    '200+1tile',
    '1800~',
    '300',
    '300',
    '300',
    '2000+1tex',
  ];

  it('compte chaque condition séparément, sans les exclure', () => {
    const s = summarizeCalmWindow(['2000+1tex+2tile~'], 1500);
    expect(s).toMatchObject({
      withTextures: 1,
      withTiles: 1,
      withMotion: 1,
      slow: 1,
      bestStreak: 0,
    });
  });

  it('donne médiane, p90, maximum et meilleure série calme', () => {
    const s = summarizeCalmWindow(series, 1500);
    expect(s.frames).toBe(7);
    expect(s.medianMs).toBe(300);
    expect(s.p90Ms).toBe(2000);
    expect(s.maxMs).toBe(2000);
    expect(s.withTiles).toBe(1);
    expect(s.withMotion).toBe(1);
    expect(s.slow).toBe(2);
    // 100 est calme (1), 200+1tile casse, 300 300 300 = 3.
    expect(s.bestStreak).toBe(3);
  });

  it('médiane d’un nombre pair d’images, fenêtre vide', () => {
    expect(summarizeCalmWindow(['100', '300'], 1500).medianMs).toBe(200);
    expect(summarizeCalmWindow([], 1500)).toMatchObject({
      frames: 0,
      medianMs: 0,
      maxMs: 0,
      bestStreak: 0,
    });
  });
});

describe('formatCalmWindow', () => {
  it('produit une ligne avec le temps, la synthèse et un échantillon', () => {
    const line = formatCalmWindow(21_900, ['100', '1700+2tile'], 3000, 6);
    expect(line).toContain('[calm-diag] t=21.9s images=2');
    expect(line).toContain('avec-carreaux=1');
    expect(line).toContain('meilleure-série=1/6');
    expect(line).toContain('échantillon=[100 1700+2tile]');
    expect(line).not.toContain('\n');
  });

  it('abrège un long échantillon', () => {
    const many = Array.from({ length: 40 }, (_, i) => String(100 + i));
    const line = formatCalmWindow(0, many, 1500, 6);
    expect(line).toContain('100 101 102 103 104 105 … 134 135 136 137 138 139');
  });
});

describe('décomposition de data-surface-busy', () => {
  const frame = (ms: number, d: string, tiles: number) =>
    `${ms}${tiles > 0 ? `+${tiles}tile` : ''}{${d}}`;

  it('relit la décomposition portée par une image', () => {
    expect(parseCalmFrame('1384+22tile{b22p3q2h17f0m5a12}')).toMatchObject({
      tiles: 22,
      busy: { busy: 22, pending: 3, queued: 2, held: 17 },
    });
    // La notation d'avant, sans décomposition, reste lisible.
    expect(parseCalmFrame('1384+22tile')?.busy).toBeUndefined();
    expect(parseCalmFrame('1384+22tile{zzz}')).toBeNull();
    expect(parseCalmFrame('900+1tile{b1p1q0h0f0m0a0}~')).toMatchObject({
      moving: true,
      busy: { pending: 1 },
    });
  });

  it('désigne la part dominante et compte les incohérences', () => {
    const series = [
      frame(1400, 'b22p0q0h22f0m5a3', 22),
      frame(1400, 'b20p0q0h20f0m3a9', 20),
      // Somme fausse (parties 5 pour un total 6) : incohérence INTERNE.
      frame(1400, 'b6p1q1h3f0m0a0', 6),
      // Parties cohérentes (9 = 9) mais total différent de `+Ntile` (8) : DÉCALAGE temporel.
      frame(1400, 'b9p9q0h0f0m0a0', 8),
    ];
    const s = summarizeCalmWindow(series, 3000);
    expect(s.withDetail).toBe(4);
    expect(s.dominant).toBe('retenus');
    expect(s.heldAgeMaxS).toBe(9);
    expect(s.internal).toBe(1);
    expect(s.skew).toBe(1);
    expect(s.mean.held).toBe(11.3);
    expect(s.mean.pending).toBe(2.5);
  });

  it('dit « aucune » sans rien d’occupé, et ne parle pas de carreaux sans décomposition', () => {
    const calm = summarizeCalmWindow([frame(100, 'b0p0q0h0f0m0a0', 0)], 3000);
    expect(calm.dominant).toBe('aucune');
    expect(summarizeCalmWindow(['100', '200+1tile'], 3000).withDetail).toBe(0);
    expect(formatCalmWindow(0, ['100', '200+1tile'], 3000, 6)).not.toContain(
      'carreaux['
    );
  });

  it('ajoute à la ligne de fenêtre la répartition en moyenne', () => {
    const line = formatCalmWindow(
      1000,
      [frame(1400, 'b4p1q1h2f0m0a4', 4)],
      3000,
      6
    );
    expect(line).toContain('carreaux[n=1](moyenne) téléchargements=1 file=1');
    expect(line).toContain('retenus=2 fondu=0 dominant=');
    expect(line).toContain(
      'âge-retenus-max=4s incohérences-internes=0 décalage-avec-data-surface-busy=0'
    );
    expect(line).not.toContain(String.fromCharCode(10));
  });
});
