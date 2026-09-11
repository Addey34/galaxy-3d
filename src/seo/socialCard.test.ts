import { describe, expect, it } from 'vitest';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  SPHERE_CENTER_X,
  SPHERE_SIZE,
  LIGHT_DIRECTION,
  RING_TILT_DEG,
  cardBackgroundSvg,
  cardTextSvg,
  renderSphere,
  renderShape,
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

/**
 * L'ANNEAU. Saturne est le seul corps que tout le monde reconnaît à autre chose qu'à sa
 * couleur ; sans anneaux sa vignette est une boule beige de plus. Ce qui suit tient les trois
 * propriétés qui font qu'on y croit — l'anneau dépasse du globe, l'arc proche passe DEVANT et
 * l'arc lointain DERRIÈRE, et le globe porte son ombre sur l'anneau — plus celle qui protège
 * les cinquante autres vignettes : sans anneau, rien ne change.
 */
describe('anneau de la vignette', () => {
  const RING_SIZE = 200;
  const INNER = 1.5;
  const OUTER = 2.2;
  /** Rayon du globe en pixels, tel que le calcule `renderSphere`. */
  const BODY = (RING_SIZE / 2 - 1) / OUTER;
  const MID = RING_SIZE / 2;

  /** Profil uniforme : toute variation observée vient donc de la géométrie ou de la lumière. */
  const strip = (level: number): RawImage => {
    const width = 64;
    const height = 4;
    const data = new Uint8Array(width * height * 3).fill(level);
    return { data, width, height, channels: 3 };
  };

  const ring = {
    texture: strip(255),
    innerRadius: INNER,
    outerRadius: OUTER,
    opacity: 0.9,
  };
  /** Même géométrie, anneau totalement transparent : isole la contribution de l'anneau. */
  const invisibleRing = { ...ring, texture: strip(0) };

  const withRing = renderSphere(null, GREY, RING_SIZE, false, ring);
  const withoutRing = renderSphere(null, GREY, RING_SIZE, false, invisibleRing);

  /** Pixel correspondant à une position (x, y) exprimée en rayons du corps. */
  const at = (
    buffer: Uint8ClampedArray,
    x: number,
    y: number
  ): [number, number, number, number] =>
    pixel(
      buffer,
      RING_SIZE,
      Math.round(MID + x * BODY),
      Math.round(MID - y * BODY)
    );

  it('dépasse du globe, et laisse le vide entre les deux', () => {
    // L'anse de l'anneau, bien au-delà du disque.
    expect(at(withRing, -1.9, 0)[3]).toBeGreaterThan(200);
    // Et l'espace entre la surface et le bord interne reste du ciel : c'est `innerRadius` qui
    // le decide, pris dans le catalogue. Un anneau collé au globe serait une soucoupe.
    expect(at(withRing, 1.25, 0)[3]).toBe(0);
    // Le globe, lui, a retreci : à 1,2 rayon on est hors surface.
    expect(at(withRing, 0, 0)[3]).toBe(255);
  });

  it('passe DEVANT le globe en bas et DERRIÈRE en haut', () => {
    // C'est cette seule asymétrie qui fait lire l'image en 3D. Le plan de l'anneau est incliné
    // vers l'observateur : sous le centre il est plus proche que la surface, au-dessus il est
    // derrière. Comparé à un anneau invisible de MÊME géométrie, donc à globe identique.
    const frontLit = luminance(at(withRing, 0, -0.6));
    const frontBare = luminance(at(withoutRing, 0, -0.6));
    expect(frontLit).not.toBe(frontBare);

    const behind = at(withRing, 0, 0.6);
    const behindBare = at(withoutRing, 0, 0.6);
    expect([...behind]).toEqual([...behindBare]);
  });

  it('reçoit l’ombre portée du globe, du côté opposé au Soleil', () => {
    // Sans elle, l'anneau brille au travers du corps qui le masque — le genre de faute qu'on
    // ne voit pas si on ne la cherche pas.
    //
    // DEUX versions précédentes de ce test étaient fausses, chacune à sa manière, et les deux
    // ont failli faire conclure n'importe quoi :
    //   1. deux coordonnées écrites en dur, calculées à la main pour la lumière d'alors. Régler
    //      l'éclairage l'a fait tomber en signalant un défaut inexistant ;
    //   2. un point DÉDUIT de la lumière, mais pris à mi-rayon — il tombait derrière le globe,
    //      donc invisible, et le test comparait deux pixels de planète. Il passait même en
    //      supprimant complètement l'ombre.
    // D'où ce balayage : on ne vise aucun point, on cherche la propriété partout.
    //
    // Chaque pixel d'anneau visible est comparé à son symétrique par rapport au centre — même
    // rayon, même texture, même incidence : seule l'ombre les distingue.
    const bodyRadius = (RING_SIZE / 2 - 1) / OUTER;
    let darkened = 0;
    let strongest = 1;
    let strongestOnShadowSide = true;

    // Direction de la lumière projetée dans le plan de l'anneau : l'ombre part à l'opposé.
    const tilt = (RING_TILT_DEG * Math.PI) / 180;
    const normal = [0, Math.cos(tilt), Math.sin(tilt)] as const;
    const alongNormal =
      LIGHT_DIRECTION[0] * normal[0] +
      LIGHT_DIRECTION[1] * normal[1] +
      LIGHT_DIRECTION[2] * normal[2];
    const inPlaneX = LIGHT_DIRECTION[0] - alongNormal * normal[0];
    const inPlaneY = LIGHT_DIRECTION[1] - alongNormal * normal[1];

    for (let py = 0; py < RING_SIZE; py++)
      for (let px = 0; px < RING_SIZE; px++) {
        const x = (px + 0.5 - MID) / bodyRadius;
        const y = -(py + 0.5 - MID) / bodyRadius;
        // Hors de la silhouette du globe : on est sûr de regarder l'anneau seul.
        if (Math.hypot(x, y) <= 1.05) continue;
        const here = pixel(withRing, RING_SIZE, px, py);
        if (here[3] < 200) continue;
        const mirror = at(withRing, -x, -y);
        if (mirror[3] < 200) continue;
        const ratio = luminance(here) / Math.max(luminance(mirror), 1);
        if (ratio < 0.75) {
          darkened++;
          if (ratio < strongest) {
            strongest = ratio;
            // Le plus assombri doit être du côté OPPOSÉ à la lumière.
            strongestOnShadowSide = x * inPlaneX + y * inPlaneY < 0;
          }
        }
      }

    // Mesuré : 57 pixels à cette résolution. Le seuil est bas exprès — supprimer l'ombre en
    // donne exactement ZÉRO (les symétriques deviennent identiques), donc 20 sépare déjà
    // franchement les deux mondes sans se casser au moindre reglage d'éclairage.
    expect(
      darkened,
      'aucun pixel d’anneau assombri par le globe'
    ).toBeGreaterThan(20);
    expect(strongest).toBeLessThan(0.6);
    expect(
      strongestOnShadowSide,
      'la zone la plus sombre n’est pas du côté opposé au Soleil'
    ).toBe(true);
  });

  it('incline AUSSI le globe, du même angle que l’anneau', () => {
    // Le piège de tout l'exercice : incliner le plan de l'anneau sans incliner la projection
    // de la carte donnerait un anneau qui traverse un globe vu de face — la planète et son
    // anneau ne décriraient plus le même équateur. Rien ne planterait, ça aurait juste l'air
    // faux sans qu'on sache dire pourquoi.
    // Carte nord rouge / sud bleue : à 20° d'inclinaison l'équateur descend sous le centre, un
    // point légèrement sous le centre reste donc dans l'hémisphère NORD.
    const width = 8;
    const height = 8;
    const data = new Uint8Array(width * height * 3);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        data[(y * width + x) * 3 + (y < height / 2 ? 0 : 2)] = 255;
    const map: RawImage = { data, width, height, channels: 3 };

    const tilted = renderSphere(map, GREY, RING_SIZE, false, invisibleRing);
    const flat = renderSphere(map, GREY, RING_SIZE, false);
    const belowCentre = at(tilted, 0, -0.2);
    expect(belowCentre[0]).toBeGreaterThan(belowCentre[2]);
    const flatBelowCentre = pixel(
      flat,
      RING_SIZE,
      MID,
      Math.round(MID + 0.2 * (RING_SIZE / 2 - 1))
    );
    expect(flatBelowCentre[2]).toBeGreaterThan(flatBelowCentre[0]);
  });

  it('n’allume pas l’anneau là où la texture est noire', () => {
    // La texture sert d'`alphaMap`, comme dans la scène 3D : le noir est un TROU. Sans ça la
    // division de Cassini serait un trait gris et l'anneau une assiette opaque.
    expect(at(withoutRing, -1.9, 0)[3]).toBe(0);
  });

  it('ne change RIEN quand le corps n’a pas d’anneau', () => {
    // Cinquante vignettes déjà livrées dependent de cette égalité — vérifiée aussi au build,
    // par comparaison d'empreintes, mais autant la tenir ici où elle coûte une milliseconde.
    const plain = renderSphere(null, GREY, 64, false);
    const explicitlyNone = renderSphere(null, GREY, 64, false, null);
    expect([...explicitlyNone]).toEqual([...plain]);
  });
});

/**
 * Icosaèdre subdivisé : une forme fermée, convexe, dont on connaît le rayon exact. Sert de
 * corps de forme « connue » pour éprouver `renderShape` sans dépendre d'un fichier.
 */
function unitBall(subdivisions: number): {
  positions: Float32Array;
  indices: Uint32Array;
} {
  const phi = (1 + Math.sqrt(5)) / 2;
  let verts: [number, number, number][] = [
    [-1, phi, 0],
    [1, phi, 0],
    [-1, -phi, 0],
    [1, -phi, 0],
    [0, -1, phi],
    [0, 1, phi],
    [0, -1, -phi],
    [0, 1, -phi],
    [phi, 0, -1],
    [phi, 0, 1],
    [-phi, 0, -1],
    [-phi, 0, 1],
  ];
  let faces: [number, number, number][] = [
    [0, 11, 5],
    [0, 5, 1],
    [0, 1, 7],
    [0, 7, 10],
    [0, 10, 11],
    [1, 5, 9],
    [5, 11, 4],
    [11, 10, 2],
    [10, 7, 6],
    [7, 1, 8],
    [3, 9, 4],
    [3, 4, 2],
    [3, 2, 6],
    [3, 6, 8],
    [3, 8, 9],
    [4, 9, 5],
    [2, 4, 11],
    [6, 2, 10],
    [8, 6, 7],
    [9, 8, 1],
  ];
  for (let s = 0; s < subdivisions; s++) {
    const next: [number, number, number][] = [];
    const middle = new Map<string, number>();
    const midpoint = (i: number, j: number): number => {
      const key = i < j ? `${i}_${j}` : `${j}_${i}`;
      const found = middle.get(key);
      if (found !== undefined) return found;
      const a = verts[i]!;
      const b = verts[j]!;
      verts.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
      const index = verts.length - 1;
      middle.set(key, index);
      return index;
    };
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  verts = verts.map(([x, y, z]) => {
    const n = Math.hypot(x, y, z);
    return [x / n, y / n, z / n];
  });
  return {
    positions: Float32Array.from(verts.flat()),
    indices: Uint32Array.from(faces.flat()),
  };
}

describe('forme réelle de la vignette', () => {
  const ball = unitBall(3);

  it('éclaire un côté et laisse l’autre dans la nuit', () => {
    // La même propriété que pour la sphère, et pour la même raison : sans elle la vignette
    // est une pastille. C'est ici qu'elle a réellement manqué — le sens de parcours des
    // triangles à l'écran est inversé par le retournement de l'axe Y, si bien qu'un tri sur
    // ce sens gardait EXACTEMENT les faces arrière. Tout le corps sortait à l'ambiant seul :
    // un aplat presque noir, de la bonne silhouette, que rien n'aurait signalé.
    const shape = renderShape(ball, GREY, SIZE);
    const centre = pixel(shape, SIZE, SIZE / 2, SIZE / 2);
    expect(centre[3]).toBe(255);
    expect(luminance(centre)).toBeGreaterThan(120);

    // Et le côté opposé à la lumière est nettement plus sombre que le côté éclairé.
    const towardsLight = LIGHT_DIRECTION[0] < 0 ? 0.25 : 0.75;
    const lit = pixel(shape, SIZE, Math.round(SIZE * towardsLight), SIZE / 2);
    const dark = pixel(
      shape,
      SIZE,
      Math.round(SIZE * (1 - towardsLight)),
      SIZE / 2
    );
    // Seuil exprimé en 8 BITS, c'est-à-dire après encodage sRGB, parce que c'est là que la
    // propriété doit tenir. En linéaire l'écart vaut 1,47 ; la puissance 1/2,2 le ramène à
    // 1,26, et un seuil posé sur la valeur linéaire échouerait sur un rendu pourtant correct.
    // Avec les faces arrière les deux côtés tombaient à l'ambiant seul, donc à un rapport de
    // 1,0 : c'est bien ce défaut-là que cette borne sépare.
    expect(luminance(lit)).toBeGreaterThan(luminance(dark) * 1.15);
  });

  it('détoure le corps au lieu de remplir la case', () => {
    const shape = renderShape(ball, GREY, SIZE);
    for (const [x, y] of [
      [1, 1],
      [SIZE - 2, 1],
      [1, SIZE - 2],
      [SIZE - 2, SIZE - 2],
    ])
      expect(pixel(shape, SIZE, x!, y!)[3]).toBe(0);
  });

  it('remplit le cadre sans le déborder, quelle que soit l’échelle du modèle', () => {
    // Un modèle publié n'arrive pas normalisé : celui de Bennu est en kilomètres, un autre
    // pourrait être en mètres. La mise à l'échelle doit venir du modèle lui-même.
    const big = {
      positions: ball.positions.map((v) => v * 4200),
      indices: ball.indices,
    };
    const small = {
      positions: ball.positions.map((v) => v * 0.003),
      indices: ball.indices,
    };
    const a = renderShape(big, GREY, SIZE);
    const b = renderShape(small, GREY, SIZE);
    expect(Array.from(a)).toEqual(Array.from(b));
    // Et la boule touche bien les deux bords horizontaux à mi-hauteur.
    expect(pixel(a, SIZE, 1, SIZE / 2)[3]).toBe(255);
    expect(pixel(a, SIZE, SIZE - 2, SIZE / 2)[3]).toBe(255);
  });

  it('recentre le modèle sur lui-même', () => {
    // Un modèle dont le centre n'est pas à l'origine sortirait décadré, voire hors champ.
    const shifted = {
      positions: ball.positions.map((v, i) => v + (i % 3 === 0 ? 17 : 0)),
      indices: ball.indices,
    };
    expect(Array.from(renderShape(shifted, GREY, SIZE))).toEqual(
      Array.from(renderShape(ball, GREY, SIZE))
    );
  });

  it('montre la face AVANT, pas la face arrière', () => {
    // Le défaut corrigé, énoncé sur la géométrie plutôt que sur la couleur : sur une boule
    // convexe, le point le plus proche de la caméra est au centre de l'image. Si le tampon de
    // profondeur gardait les faces arrière, la profondeur y serait négative — et l'image
    // rendrait la silhouette correcte avec l'éclairage de l'autre côté du corps.
    const shape = renderShape(ball, GREY, SIZE);
    const centre = pixel(shape, SIZE, SIZE / 2, SIZE / 2);
    // Face avant au centre : normale ≈ +Z, donc presque alignée avec la lumière, donc le
    // pixel le plus clair de toute l'image se trouve du côté éclairé et non à l'opposé.
    let brightestX = 0;
    let best = -1;
    for (let x = 0; x < SIZE; x++) {
      const value = luminance(pixel(shape, SIZE, x, SIZE / 2));
      if (value > best) {
        best = value;
        brightestX = x;
      }
    }
    expect(best).toBeGreaterThan(luminance(centre) * 0.9);
    // La lumière vient de la gauche (LIGHT_DIRECTION[0] < 0) : le maximum est donc dans la
    // moitié gauche. Avec les faces arrière il basculait à droite.
    expect(brightestX).toBeLessThan(SIZE / 2);
  });

  it('ne rend rien plutôt que de planter sur un maillage vide', () => {
    const empty = renderShape(
      { positions: new Float32Array(), indices: new Uint32Array() },
      GREY,
      SIZE
    );
    expect(empty.length).toBe(SIZE * SIZE * 4);
    expect(Array.from(empty).every((v) => v === 0)).toBe(true);
  });
});
