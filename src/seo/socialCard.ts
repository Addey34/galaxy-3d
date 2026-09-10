/**
 * VIGNETTES DE PARTAGE PAR CORPS — ce qu'affiche un lien vers `/jupiter/` quand on le colle
 * dans une messagerie ou un réseau social.
 *
 * Avant ce module, les cinquante et une pages de corps partageaient la même vignette : une
 * capture générique de la vue d'ensemble. Un lien vers Titan montrait donc le Soleil. Pour un
 * site qui vit du partage, c'est l'endroit où la page se vend — et elle vendait autre chose.
 *
 * La sphère est un VRAI rendu, pas une texture découpée dans un cercle : projection
 * orthographique de la carte équirectangulaire du corps, éclairage lambertien, bord lissé.
 * Calculée en JavaScript pur, sans GPU ni navigateur, donc DÉTERMINISTE — même entrée, même
 * image, en local comme sur le runner de CI. Les vignettes sont générées au build dans `dist/`,
 * jamais committées : elles dérivent des textures déjà versionnées.
 *
 * Module PUR (pixels et chaînes). Le décodage/encodage d'image vit dans le plugin Vite.
 */

/** Image brute non compressée — ce que produit `sharp(...).raw()`. */
export interface RawImage {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  channels: number;
}

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
export const SPHERE_SIZE = 440;
export const SPHERE_CENTER_X = 330;

/**
 * Lumière venue d'en haut à gauche, légèrement de face : le terminateur tombe sur la droite
 * du disque, du côté du texte, ce qui équilibre la composition.
 */
const LIGHT: [number, number, number] = (() => {
  const raw: [number, number, number] = [-0.55, 0.3, 0.78];
  const norm = Math.hypot(...raw);
  return [raw[0] / norm, raw[1] / norm, raw[2] / norm];
})();

/** Lueur minimale de la face nuit : noire pure, la sphère disparaîtrait dans le fond. */
const AMBIENT = 0.035;

const toLinear = (c: number): number => (c / 255) ** 2.2;
const toSrgb = (c: number): number =>
  Math.round(Math.min(Math.max(c, 0), 1) ** (1 / 2.2) * 255);

/** Échantillonnage bilinéaire, longitude périodique, latitude bornée. */
function sampleBilinear(
  texture: RawImage,
  u: number,
  v: number
): [number, number, number] {
  const x = (((u % 1) + 1) % 1) * texture.width - 0.5;
  const y = Math.min(Math.max(v, 0), 1) * texture.height - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.min(Math.max(Math.floor(y), 0), texture.height - 1);
  const y1 = Math.min(y0 + 1, texture.height - 1);
  const fx = x - x0;
  const fy = Math.min(Math.max(y - y0, 0), 1);
  const wrap = (xx: number): number =>
    ((xx % texture.width) + texture.width) % texture.width;
  const at = (xx: number, yy: number, c: number): number =>
    texture.data[(yy * texture.width + wrap(xx)) * texture.channels + c] ?? 0;
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const top = at(x0, y0, c) * (1 - fx) + at(x0 + 1, y0, c) * fx;
    const bottom = at(x0, y1, c) * (1 - fx) + at(x0 + 1, y1, c) * fx;
    out[c] = top * (1 - fy) + bottom * fy;
  }
  return out;
}

/**
 * Rend une sphère `size × size` en RGBA.
 *
 * - `texture` : carte équirectangulaire du corps, ou `null` pour une teinte unie (corps sans
 *   texture de surface — une vignette vide serait pire qu'une sphère de la bonne couleur).
 * - `emissive` : une ÉTOILE n'a pas de terminateur, elle émet. On lui applique à la place
 *   l'assombrissement centre-bord réel d'une photosphère (`1 − 0,6·(1 − μ)`, loi linéaire
 *   classique), sans quoi le Soleil ressemblerait à un disque plat.
 */
export function renderSphere(
  texture: RawImage | null,
  fallback: [number, number, number],
  size: number,
  emissive: boolean
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const radius = size / 2 - 1;
  const center = size / 2;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const dx = px + 0.5 - center;
      const dy = py + 0.5 - center;
      const distance = Math.hypot(dx, dy);
      // Bord lissé sur un pixel : sans lui la silhouette crénelée se voit à l'oeil nu.
      const coverage = Math.min(Math.max(radius + 0.5 - distance, 0), 1);
      if (coverage <= 0) continue;
      const nx = Math.min(Math.max(dx / radius, -1), 1);
      const ny = Math.min(Math.max(-dy / radius, -1), 1);
      const nz = Math.sqrt(Math.max(1 - nx * nx - ny * ny, 0));

      const latitude = Math.asin(ny);
      const longitude = Math.atan2(nx, nz);
      const rgb = texture
        ? sampleBilinear(
            texture,
            longitude / (2 * Math.PI) + 0.5,
            0.5 - latitude / Math.PI
          )
        : fallback;

      const light = emissive
        ? 1 - 0.6 * (1 - nz)
        : AMBIENT + Math.max(nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2], 0);
      const index = (py * size + px) * 4;
      out[index] = toSrgb(toLinear(rgb[0]) * light);
      out[index + 1] = toSrgb(toLinear(rgb[1]) * light);
      out[index + 2] = toSrgb(toLinear(rgb[2]) * light);
      out[index + 3] = Math.round(coverage * 255);
    }
  }
  return out;
}

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Générateur pseudo-aléatoire déterministe (mulberry32) : même ciel à chaque build. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fond : dégradé sombre, champ d'étoiles fixe, halo derrière la sphère. */
export function cardBackgroundSvg(emissive: boolean): string {
  const random = seeded(20260910);
  const stars: string[] = [];
  for (let i = 0; i < 160; i++) {
    const x = (random() * CARD_WIDTH).toFixed(1);
    const y = (random() * CARD_HEIGHT).toFixed(1);
    const r = (0.4 + random() * 1.1).toFixed(2);
    const o = (0.25 + random() * 0.6).toFixed(2);
    stars.push(
      `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="${o}"/>`
    );
  }
  const glow = emissive ? '#ffb347' : '#3d6fb8';
  const glowOpacity = emissive ? 0.55 : 0.22;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}">` +
    '<defs>' +
    '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#070b16"/><stop offset="1" stop-color="#02040a"/>' +
    '</linearGradient>' +
    `<radialGradient id="glow"><stop offset="0" stop-color="${glow}" stop-opacity="${glowOpacity}"/>` +
    `<stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient>` +
    '</defs>' +
    `<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#bg)"/>` +
    stars.join('') +
    `<circle cx="${SPHERE_CENTER_X}" cy="${CARD_HEIGHT / 2}" r="${SPHERE_SIZE * 0.78}" fill="url(#glow)"/>` +
    '</svg>'
  );
}

/**
 * Texte de la vignette. Tout ce qui vient du catalogue est échappé : un nom contenant `<` ou
 * `&` casserait sinon le SVG entier — et donc le build au mieux, une vignette vide au pire.
 */
export function cardTextSvg(
  displayName: string,
  facts: string[],
  domain: string
): string {
  const font = 'Segoe UI, Helvetica, Arial, DejaVu Sans, sans-serif';
  // Espaces fines insécables → espaces simples : toutes les polices système n'ont pas le
  // glyphe U+202F, et un carré vide dans une vignette de partage se voit tout de suite.
  const clean = (value: string): string =>
    escapeXml(value.replace(/\u202f/g, ' '));
  const lines = facts
    .slice(0, 2)
    .map(
      (fact, index) =>
        `<text x="620" y="${418 + index * 40}" font-size="25" fill="#9aabc2">${clean(fact)}</text>`
    )
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" font-family="${font}">` +
    '<text x="620" y="205" font-size="22" letter-spacing="5" fill="#7fa7d9">SOLAR SYSTEM 3D</text>' +
    `<text x="620" y="298" font-size="84" font-weight="700" fill="#ffffff">${clean(displayName)}</text>` +
    '<text x="620" y="352" font-size="30" fill="#c6d2e3">Live position and orbit, in 3D</text>' +
    lines +
    `<text x="620" y="568" font-size="22" fill="#6fb3ff">${clean(domain)}</text>` +
    '</svg>'
  );
}
