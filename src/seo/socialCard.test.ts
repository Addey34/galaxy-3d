import { describe, expect, it } from 'vitest';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  SPHERE_CENTER_X,
  SPHERE_SIZE,
  cardBackgroundSvg,
  cardTextSvg,
  renderSphere,
  type RawImage,
} from './socialCard';

/**
 * Ce module peint l'image qu'un réseau social affiche à la place de la page. Personne ne la
 * regarde pendant le développement — elle n'apparaît que dans une conversation, chez quelqu'un
 * d'autre, une fois déployée. Les tests ci-dessous tiennent donc les propriétés qu'on ne peut
 * pas voir échouer : la sphère est ÉCLAIRÉE (pas un disque plat), elle est DÉTOURÉE (pas un
 * carré), et le SVG reste valide même quand le catalogue contient des chevrons.
 */

const SIZE = 64;
const GREY: [number, number, number] = [200, 200, 200];

/** Pixel `(x, y)` d'un rendu RGBA. */
function pixel(
  buffer: Uint8ClampedArray,
  size: number,
  x: number,
  y: number
): [number, number, number, number] {
  const index = (y * size + x) * 4;
  return [
    buffer[index] ?? 0,
    buffer[index + 1] ?? 0,
    buffer[index + 2] ?? 0,
    buffer[index + 3] ?? 0,
  ];
}

const luminance = (p: readonly number[]): number =>
  (p[0] ?? 0) + (p[1] ?? 0) + (p[2] ?? 0);

/**
 * Contrôle de bonne formation, sans analyseur XML : balises appariées, rien hors des balises
 * qui ressemble à du balisage. Un SVG cassé n'échoue pas à la génération — sharp rend une
 * image vide, et la vignette part en production sans un mot.
 */
function expectWellFormed(svg: string): void {
  const tag = /<(\/?)([a-zA-Z][\w:-]*)(?:[^>"']|"[^"]*"|'[^']*')*?(\/?)>/g;
  const stack: string[] = [];
  let consumed = 0;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(svg)) !== null) {
    expect(svg.slice(consumed, match.index)).not.toMatch(/[<>]/);
    consumed = tag.lastIndex;
    if (match[1]) expect(stack.pop()).toBe(match[2]);
    else if (!match[3]) stack.push(match[2] ?? '');
  }
  expect(svg.slice(consumed)).toBe('');
  expect(stack).toEqual([]);
}

describe('sphère de la vignette', () => {
  it('éclaire un côté et laisse l’autre dans la nuit', () => {
    // LA propriété qui distingue une sphère d'un disque de couleur. Sans elle la vignette
    // ressemble à une pastille, et rien dans le build ne le signalerait.
    const sphere = renderSphere(null, GREY, SIZE, false);
    const lit = pixel(sphere, SIZE, 10, SIZE / 2);
    // Point choisi APRÈS le terminateur, pas simplement « à droite » : sur ce disque la lumière
    // rasante passe sous l'horizon vers x = 57. Un point pris trop tôt reste éclairé, et
    // l'assertion sur la lueur minimale ne mesurerait alors plus rien.
    const night = pixel(sphere, SIZE, SIZE - 4, SIZE / 2);
    expect(lit[3]).toBe(255);
    expect(night[3]).toBe(255);
    expect(luminance(lit)).toBeGreaterThan(luminance(night) * 2);
    // …et la face nuit n'est jamais du noir absolu : la silhouette doit rester lisible sur le
    // fond spatial, sinon la sphère paraît amputée.
    expect(luminance(night)).toBeGreaterThan(0);
  });

  it('rend une étoile SANS terminateur, assombrie du centre vers le bord', () => {
    // Le Soleil n'est pas éclairé de côté : il émet. Le seul dégradé légitime est radial.
    const star = renderSphere(null, GREY, SIZE, true);
    const left = pixel(star, SIZE, 10, SIZE / 2);
    const right = pixel(star, SIZE, SIZE - 11, SIZE / 2);
    expect(luminance(left)).toBe(luminance(right));
    expect(luminance(pixel(star, SIZE, SIZE / 2, SIZE / 2))).toBeGreaterThan(
      luminance(left)
    );
    // Comparaison avec le cas non émissif : lui DOIT être dissymétrique. Sans ce contrôle,
    // un rendu uniformément plat passerait les deux tests précédents.
    const planet = renderSphere(null, GREY, SIZE, false);
    expect(luminance(pixel(planet, SIZE, 10, SIZE / 2))).not.toBe(
      luminance(pixel(planet, SIZE, SIZE - 11, SIZE / 2))
    );
  });

  it('laisse le hors-disque transparent et lisse le bord', () => {
    // La vignette est composée sur un fond étoilé : un carré opaque autour de la sphère se
    // verrait immédiatement, et un bord non lissé fait un escalier visible à l'œil nu.
    const sphere = renderSphere(null, GREY, SIZE, true);
    expect(pixel(sphere, SIZE, 0, 0)[3]).toBe(0);
    expect(pixel(sphere, SIZE, SIZE - 1, SIZE - 1)[3]).toBe(0);
    expect(pixel(sphere, SIZE, SIZE / 2, SIZE / 2)[3]).toBe(255);
    const alphas = new Set<number>();
    for (let x = 0; x < SIZE; x++)
      alphas.add(pixel(sphere, SIZE, x, SIZE / 2)[3]);
    expect([...alphas].some((a) => a > 0 && a < 255)).toBe(true);
  });

  it('utilise la couleur de repli quand le corps n’a pas de texture', () => {
    // Un corps sans carte de surface doit ressortir à SA couleur, pas à un gris générique :
    // c'est le seul indice qu'il reste sur la vignette.
    const rust: [number, number, number] = [194, 90, 63];
    const sphere = renderSphere(null, rust, SIZE, true);
    const centre = pixel(sphere, SIZE, SIZE / 2, SIZE / 2);
    // Au centre d'une sphère émissive l'éclairement vaut 1 : la couleur sort telle quelle.
    for (let channel = 0; channel < 3; channel++)
      expect(
        Math.abs((centre[channel] ?? 0) - (rust[channel] ?? 0)),
        `canal ${channel}`
      ).toBeLessThanOrEqual(1);
    expect(centre[0]).toBeGreaterThan(centre[1]);
    expect(centre[1]).toBeGreaterThan(centre[2]);
  });

  it('projette la carte dans le bon sens, est à droite', () => {
    // Une inversion de longitude ne casse rien et ne se voit que si l'on connaît la planète.
    // Moitié ouest rouge, moitié est bleue : l'ouest doit sortir à GAUCHE du disque, comme sur
    // un globe regardé de l'extérieur, nord en haut.
    const width = 8;
    const height = 4;
    const data = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 3;
        data[index + (x < width / 2 ? 0 : 2)] = 255;
      }
    const texture: RawImage = { data, width, height, channels: 3 };
    const sphere = renderSphere(texture, GREY, SIZE, true);
    const west = pixel(sphere, SIZE, 10, SIZE / 2);
    const east = pixel(sphere, SIZE, SIZE - 11, SIZE / 2);
    expect(west[0]).toBeGreaterThan(west[2]);
    expect(east[2]).toBeGreaterThan(east[0]);
  });
});

describe('fond et texte de la vignette', () => {
  it('produit le MÊME ciel à chaque appel', () => {
    // Le champ d'étoiles est pseudo-aléatoire. S'il variait, chaque build réécrirait les
    // cinquante et une vignettes avec des octets différents pour une image identique — bruit
    // dans le déploiement, et impossible de dire si une vignette a vraiment changé.
    expect(cardBackgroundSvg(false)).toBe(cardBackgroundSvg(false));
    expect(cardBackgroundSvg(true)).not.toBe(cardBackgroundSvg(false));
  });

  it('déclare les dimensions annoncées aux réseaux sociaux', () => {
    expect(cardBackgroundSvg(false)).toContain(
      `width="${CARD_WIDTH}" height="${CARD_HEIGHT}"`
    );
    // La sphère doit tenir dans la carte, à gauche du texte.
    expect(SPHERE_CENTER_X + SPHERE_SIZE / 2).toBeLessThan(CARD_WIDTH);
    expect(SPHERE_SIZE).toBeLessThanOrEqual(CARD_HEIGHT);
  });

  it('échappe ce qui vient du catalogue', () => {
    // Un nom contenant `<` ou `&` casserait le SVG ENTIER : sharp rendrait une image vide et
    // la page partirait avec une vignette blanche, sans erreur nulle part.
    const svg = cardTextSvg('A<b>"&', ['Radius: <script>'], 'x&y.test');
    expect(svg).not.toContain('A<b>');
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('A&lt;b&gt;&quot;&amp;');
    expect(svg).toContain('x&amp;y.test');
    expectWellFormed(svg);
  });

  it('remplace l’espace fine insécable des nombres formatés', () => {
    // `bodyFacts` groupe les milliers avec U+202F. Toutes les polices système n'ont pas ce
    // glyphe — sur le runner de CI comme sur le poste de quelqu'un d'autre, il sortirait en
    // carré vide au milieu du seul chiffre de la vignette.
    const svg = cardTextSvg('Jupiter', ['Radius: 69 911 km'], 'x.test');
    expect(svg).not.toContain(' ');
    expect(svg).toContain('69 911 km');
  });

  it('reste bien formé avec un texte ordinaire', () => {
    expectWellFormed(
      cardTextSvg(
        'Jupiter',
        ['Radius: 69 911 km', 'Mass: 1.90 × 10²⁷ kg'],
        'x.test'
      )
    );
    expectWellFormed(cardBackgroundSvg(true));
  });

  it('n’affiche que les deux premiers faits', () => {
    // Trois lignes déborderaient sur le domaine, en bas de la carte.
    const svg = cardTextSvg('Jupiter', ['un', 'deux', 'trois'], 'x.test');
    expect(svg).toContain('>un<');
    expect(svg).toContain('>deux<');
    expect(svg).not.toContain('>trois<');
  });
});
