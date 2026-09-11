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
 * Largeur occupée par un corps À ANNEAUX, bord externe à bord externe.
 *
 * Plus large que `SPHERE_SIZE` parce que l'anneau de Saturne s'étend à 2,2 rayons : à taille de
 * globe égale il déborderait sur le texte. C'est donc le GLOBE qui rétrécit — 123 px de rayon au
 * lieu de 220. Contre-intuitif à écrire, évident à l'écran : un lecteur reconnaît Saturne à ses
 * anneaux, pas à la taille de son disque, et l'ensemble reste plus large que n'importe quelle
 * autre vignette. Borné par le texte, qui commence à x = 620 : 330 + 270 = 600.
 */
export const RINGED_SPAN = 540;

/**
 * Inclinaison de la vue pour un corps à anneaux, en degrés.
 *
 * CHOIX DE COMPOSITION, pas une donnée physique — ne pas le lire comme l'ouverture réelle des
 * anneaux de Saturne à une date donnée (elle varie de 0° à 27° au fil de son année de 29 ans).
 * Sans inclinaison la carte équirectangulaire est projetée sans basculement, donc le plan
 * équatorial est vu par la tranche et l'anneau sort en trait. À 20° il s'ouvre franchement, le
 * pôle nord penche vers l'observateur, et l'arc proche passe devant le bas du globe — l'image
 * que tout le monde a en tête.
 */
export const RING_TILT_DEG = 20;

/**
 * Bord gauche de la colonne de texte. Exporté parce que c'est LA contrainte qui borne la largeur
 * d'un corps à anneaux : écrit deux fois, en dur dans le SVG et dans la tête de qui choisit
 * `RINGED_SPAN`, il finit par diverger sans que rien ne le dise.
 */
export const TEXT_LEFT = 620;

/**
 * Anneau à peindre autour du corps. Les rayons viennent du CATALOGUE (`config.ring`), jamais
 * d'une valeur écrite ici : c'est la même représentation que la scène 3D, pas une deuxième.
 */
export interface RingRender {
  /** Profil radial : image large et courte, bord interne à gauche, externe à droite. */
  texture: RawImage;
  /** Rayon interne, en rayons du corps. */
  innerRadius: number;
  /** Rayon externe, en rayons du corps. */
  outerRadius: number;
  /** Opacité globale — 0,9 dans la scène 3D (`createRingMaterial`). */
  opacity: number;
}

/**
 * Poids de l'éclairage de l'anneau, repris de la scène 3D.
 *
 * Un disque plat éclairé par une lumière rasante reçoit un diffus proche de zéro : rendu
 * naïvement, l'anneau serait quasi invisible alors que les particules de glace réelles diffusent
 * vivement. `CelestialObject._loadRingTexture` corrige ça avec un terme émissif
 * (`emissiveIntensity = 0.6`) piloté par la texture elle-même ; on reprend le même partage ici,
 * sans quoi la vignette ne ressemblerait pas à ce que l'application montre.
 */
const RING_EMISSIVE = 0.6;
const RING_DIFFUSE = 0.55;

/** Résidu de lumière dans l'ombre portée — mêmes valeurs que le shader de l'anneau. */
const RING_SHADOW_DIFFUSE = 0.08;
const RING_SHADOW_EMISSIVE = 0.15;

/**
 * Lumière venue d'en haut à gauche, très majoritairement de face : le terminateur tombe sur la
 * droite du disque, du côté du texte, ce qui équilibre la composition.
 *
 * L'angle de phase (21°) est le seul réglage qui compte ici, et il a été MESURÉ plutôt que
 * choisi à l'œil. À 39°, la valeur d'origine, seuls 74 % du disque terrestre passaient
 * au-dessus du plancher de lisibilité et 82 % de celui de Bennu : la géométrie n'en laissait
 * pourtant que 11 % dans l'ombre, mais l'atténuation de Lambert noie une large bande bien avant
 * le terminateur, d'autant plus visible que le corps est sombre. À 21° on monte à 80 % et 92 %.
 *
 * Ne pas aller beaucoup plus bas : le gain s'aplatit (16° ne rend que deux points de plus) et
 * une lumière frontale supprime le modelé — la sphère redevient la pastille que ce rendu existe
 * précisément pour éviter.
 */
const LIGHT: [number, number, number] = (() => {
  const raw: [number, number, number] = [-0.32, 0.17, 0.93];
  const norm = Math.hypot(...raw);
  return [raw[0] / norm, raw[1] / norm, raw[2] / norm];
})();

/**
 * Direction de la lumière, normalisée. Exportée pour les tests : sans elle, une assertion sur
 * l'ombre portée doit coder en dur des coordonnées calculées à la main pour une valeur donnée
 * de `LIGHT` — et tombe dès qu'on règle l'éclairage, en signalant un défaut qui n'existe pas.
 * Un test doit suivre la propriété, pas le chiffre.
 */
export const LIGHT_DIRECTION: readonly [number, number, number] = LIGHT;

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
  emissive: boolean,
  ring?: RingRender | null
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const center = size / 2;
  // Sans anneau, le globe remplit la case. Avec, c'est le SYSTÈME qui la remplit : le globe
  // rétrécit d'autant que l'anneau est large, sinon l'anneau sortirait du cadre.
  const radius = ring ? (size / 2 - 1) / ring.outerRadius : size / 2 - 1;
  // Inclinaison nulle sans anneau — la sphère est alors rendue exactement comme avant, au bit
  // près, ce qui garde les cinquante autres vignettes inchangées.
  const tilt = ring ? (RING_TILT_DEG * Math.PI) / 180 : 0;
  const cosTilt = Math.cos(tilt);
  const sinTilt = Math.sin(tilt);
  const ringSpan = ring ? ring.outerRadius - ring.innerRadius : 0;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const dx = px + 0.5 - center;
      const dy = py + 0.5 - center;
      const distance = Math.hypot(dx, dy);
      // Bord lissé sur un pixel : sans lui la silhouette crénelée se voit à l'oeil nu.
      const coverage = Math.min(Math.max(radius + 0.5 - distance, 0), 1);

      // --- le globe -------------------------------------------------------------------
      let sphere: [number, number, number] | null = null;
      let sphereZ = 0;
      if (coverage > 0) {
        const nx = Math.min(Math.max(dx / radius, -1), 1);
        const ny = Math.min(Math.max(-dy / radius, -1), 1);
        const nz = Math.sqrt(Math.max(1 - nx * nx - ny * ny, 0));
        sphereZ = nz;
        // Retour au repère du CORPS : la vue est inclinée, la carte ne l'est pas. Le même
        // angle sert à l'anneau juste en dessous, sinon les deux ne décriraient pas le même
        // plan équatorial et l'anneau flotterait de travers.
        const bodyY = ny * cosTilt + nz * sinTilt;
        const bodyZ = -ny * sinTilt + nz * cosTilt;

        const latitude = Math.asin(Math.min(Math.max(bodyY, -1), 1));
        const longitude = Math.atan2(nx, bodyZ);
        const rgb = texture
          ? sampleBilinear(
              texture,
              longitude / (2 * Math.PI) + 0.5,
              0.5 - latitude / Math.PI
            )
          : fallback;

        const light = emissive
          ? 1 - 0.6 * (1 - nz)
          : AMBIENT +
            Math.max(nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2], 0);
        sphere = [
          toLinear(rgb[0]) * light,
          toLinear(rgb[1]) * light,
          toLinear(rgb[2]) * light,
        ];
      }

      // --- l'anneau -------------------------------------------------------------------
      let ringColor: [number, number, number] | null = null;
      let ringAlpha = 0;
      let ringInFront = false;
      if (ring) {
        const x = dx / radius;
        const y = -dy / radius;
        // Plan équatorial incliné, passant par le centre : normale (0, cos, sin). La caméra
        // est orthographique en +Z, donc le rayon est vertical en (x, y) et on résout en z.
        const z = (-y * cosTilt) / sinTilt;
        const r = Math.hypot(x, y, z);
        if (r >= ring.innerRadius && r <= ring.outerRadius) {
          const rgb = sampleBilinear(
            ring.texture,
            (r - ring.innerRadius) / ringSpan,
            0.5
          );
          // L'app utilise la texture comme `alphaMap` : le noir de la division de Cassini est
          // un TROU, pas un gris. Sans ça l'anneau serait une assiette opaque.
          ringAlpha = (rgb[1] / 255) * ring.opacity;
          if (ringAlpha > 0) {
            const normalDotLight = Math.abs(
              cosTilt * LIGHT[1] + sinTilt * LIGHT[2]
            );
            // Ombre CYLINDRIQUE du globe sur l'anneau, même critère que le shader de la
            // scène : côté nuit, et à moins d'un rayon de l'axe Soleil.
            const alongSun = x * LIGHT[0] + y * LIGHT[1] + z * LIGHT[2];
            const perpDist = Math.hypot(
              x - alongSun * LIGHT[0],
              y - alongSun * LIGHT[1],
              z - alongSun * LIGHT[2]
            );
            const shadow =
              alongSun < 0 ? 1 - smoothstep(0.85, 1.05, perpDist) : 0;
            const lit =
              RING_DIFFUSE *
                normalDotLight *
                (1 - shadow * (1 - RING_SHADOW_DIFFUSE)) +
              RING_EMISSIVE * (1 - shadow * (1 - RING_SHADOW_EMISSIVE));
            ringColor = [
              toLinear(rgb[0]) * lit,
              toLinear(rgb[1]) * lit,
              toLinear(rgb[2]) * lit,
            ];
            // Caméra en +Z : le z le plus grand est le plus proche. C'est ce test, et lui
            // seul, qui fait passer l'arc proche DEVANT le globe et cache l'arc lointain.
            ringInFront = z > sphereZ || coverage <= 0;
          }
        }
      }

      if (!sphere && !ringColor) continue;

      // Composition arrière vers avant : « source over » classique, en linéaire.
      const back = ringInFront ? sphere : ringColor;
      const backAlpha = ringInFront ? coverage : ringAlpha;
      const front = ringInFront ? ringColor : sphere;
      const frontAlpha = ringInFront ? ringAlpha : coverage;
      const index = (py * size + px) * 4;
      if (!back || backAlpha <= 0) {
        // Un seul calque : on écrit sa couleur telle quelle. Passer quand même par la
        // division du mélange ferait un `x * a / a` qui n'est pas l'identité en virgule
        // flottante — assez pour décaler d'un bit les pixels de bord des cinquante autres
        // vignettes, qui doivent rester identiques à l'octet près.
        for (let c = 0; c < 3; c++) out[index + c] = toSrgb(front?.[c] ?? 0);
        out[index + 3] = Math.round(frontAlpha * 255);
        continue;
      }
      const alpha = frontAlpha + backAlpha * (1 - frontAlpha);
      for (let c = 0; c < 3; c++) {
        const premultiplied =
          (front?.[c] ?? 0) * frontAlpha +
          (back[c] ?? 0) * backAlpha * (1 - frontAlpha);
        out[index + c] = toSrgb(alpha > 0 ? premultiplied / alpha : 0);
      }
      out[index + 3] = Math.round(alpha * 255);
    }
  }
  return out;
}

/** Interpolation lissée entre deux bornes — même courbe que `smoothstep` en GLSL. */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
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
        `<text x="${TEXT_LEFT}" y="${418 + index * 40}" font-size="25" fill="#9aabc2">${clean(fact)}</text>`
    )
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" font-family="${font}">` +
    `<text x="${TEXT_LEFT}" y="205" font-size="22" letter-spacing="5" fill="#7fa7d9">SOLAR SYSTEM 3D</text>` +
    `<text x="${TEXT_LEFT}" y="298" font-size="84" font-weight="700" fill="#ffffff">${clean(displayName)}</text>` +
    `<text x="${TEXT_LEFT}" y="352" font-size="30" fill="#c6d2e3">Live position and orbit, in 3D</text>` +
    lines +
    `<text x="${TEXT_LEFT}" y="568" font-size="22" fill="#6fb3ff">${clean(domain)}</text>` +
    '</svg>'
  );
}

/**
 * Maillage de forme, tel que le greffon de build le lit depuis un fichier glTF binaire.
 * Coordonnées dans l'unité du fichier — `renderShape` les recentre et les met à l'échelle
 * lui-même, parce qu'un modèle publié n'a aucune raison d'arriver normalisé.
 */
export interface ShapeMesh {
  /** Positions XYZ mises bout à bout, trois nombres par sommet. */
  positions: Float32Array;
  /** Indices de sommets, trois par triangle. */
  indices: Uint32Array;
}

/**
 * RENDU D'UN CORPS À PARTIR DE SA FORME RÉELLE, et non d'une sphère.
 *
 * Pourquoi ce second chemin existe. Un petit corps n'a pas de mosaïque équirectangulaire
 * publiée — il n'y en a pas pour Bennu — donc `renderSphere` n'avait que la teinte de repli à
 * étaler : sa vignette était une bille grise, qui ne disait rien de lui. Or ce qui identifie
 * Bennu, ce n'est pas sa couleur, c'est sa SILHOUETTE : la toupie à bourrelet équatorial. Le
 * modèle de forme est déjà dans le dépôt, vérifié conforme aux statistiques publiées
 * (cf. `scripts/decimate-shape-model.mjs`) ; il ne manquait qu'un rendu capable de le lire.
 *
 * Projection ORTHOGRAPHIQUE et tampon de profondeur, comme `renderSphere` : les deux vignettes
 * décrivent ainsi la même vue. Éclairage plat par triangle, avec la MÊME direction de lumière
 * et le même ambiant que la sphère — une vignette qui s'éclairerait autrement se verrait
 * immédiatement dans une galerie de partages.
 *
 * Le maillage est recentré sur son centre de gravité géométrique et mis à l'échelle sur son
 * rayon maximal. Pas sur la boîte englobante : le piège déjà payé une fois sur ce modèle
 * (`THREE.Box3.getBoundingSphere` circonscrit la BOÎTE, donc rend √3 de trop pour un corps
 * rond — le modèle était sorti 42 % trop petit).
 */
export function renderShape(
  mesh: ShapeMesh,
  fallback: [number, number, number],
  size: number
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const { positions, indices } = mesh;
  const vertexCount = positions.length / 3;
  if (vertexCount === 0 || indices.length < 3) return out;

  // --- recentrage et échelle ---------------------------------------------------------
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < vertexCount; i++) {
    cx += positions[i * 3]!;
    cy += positions[i * 3 + 1]!;
    cz += positions[i * 3 + 2]!;
  }
  cx /= vertexCount;
  cy /= vertexCount;
  cz /= vertexCount;

  let maxRadius = 0;
  for (let i = 0; i < vertexCount; i++) {
    const dx = positions[i * 3]! - cx;
    const dy = positions[i * 3 + 1]! - cy;
    const dz = positions[i * 3 + 2]! - cz;
    const r = Math.hypot(dx, dy, dz);
    if (r > maxRadius) maxRadius = r;
  }
  if (maxRadius <= 0) return out;

  const center = size / 2;
  const scale = (size / 2 - 1) / maxRadius;
  // Sommets projetés une seule fois : les triangles partagent leurs sommets, les reprojeter
  // par triangle referait le même calcul six fois en moyenne.
  const sx = new Float32Array(vertexCount);
  const sy = new Float32Array(vertexCount);
  const sz = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    sx[i] = center + (positions[i * 3]! - cx) * scale;
    // Y écran vers le bas, Y modèle vers le haut.
    sy[i] = center - (positions[i * 3 + 1]! - cy) * scale;
    sz[i] = (positions[i * 3 + 2]! - cz) * scale;
  }

  // --- rastérisation avec tampon de profondeur ---------------------------------------
  const depth = new Float32Array(size * size).fill(-Infinity);
  const shade = new Float32Array(size * size);
  const covered = new Uint8Array(size * size);

  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = indices[t]!;
    const b = indices[t + 1]!;
    const c = indices[t + 2]!;
    const ax = sx[a]!;
    const ay = sy[a]!;
    const bx = sx[b]!;
    const by = sy[b]!;
    const cxs = sx[c]!;
    const cys = sy[c]!;

    const area = (bx - ax) * (cys - ay) - (by - ay) * (cxs - ax);
    if (area === 0) continue;

    // Normale de la face, dans le repère du modèle recentré (l'échelle est uniforme, donc
    // elle ne change pas les directions).
    const ux = positions[b * 3]! - positions[a * 3]!;
    const uy = positions[b * 3 + 1]! - positions[a * 3 + 1]!;
    const uz = positions[b * 3 + 2]! - positions[a * 3 + 2]!;
    const vx = positions[c * 3]! - positions[a * 3]!;
    const vy = positions[c * 3 + 1]! - positions[a * 3 + 1]!;
    const vz = positions[c * 3 + 2]! - positions[a * 3 + 2]!;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const nLength = Math.hypot(nx, ny, nz);
    if (nLength === 0) continue;
    nx /= nLength;
    ny /= nLength;
    nz /= nLength;
    // Faces arrière écartées sur la NORMALE DU MODÈLE, pas sur le sens de parcours à l'écran.
    // La projection retourne l'axe Y (Y écran vers le bas), ce qui inverse le signe de l'aire :
    // trier sur ce signe gardait exactement les faces qui tournent le dos, dont la normale
    // pointe à l'opposé de la lumière — toute la forme sortait à l'ambiant seul, un aplat
    // presque noir. La caméra regarde selon −Z, donc une face visible a `nz > 0`, et cet
    // énoncé-là ne dépend d'aucune convention d'orientation d'écran.
    if (nz <= 0) continue;
    const light =
      AMBIENT + Math.max(nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2], 0);

    const minX = Math.max(0, Math.floor(Math.min(ax, bx, cxs)));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(ax, bx, cxs)));
    const minY = Math.max(0, Math.floor(Math.min(ay, by, cys)));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(ay, by, cys)));

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const qx = px + 0.5;
        const qy = py + 0.5;
        // Coordonnées barycentriques par aires signées — le test d'appartenance et
        // l'interpolation de profondeur en un seul calcul.
        // Normalisées par le signe de l'aire : le sens de parcours à l'écran dépend de
        // l'orientation du maillage source, dont ce rendu n'a pas à connaître la convention.
        const w0 = ((bx - ax) * (qy - ay) - (by - ay) * (qx - ax)) / area;
        const w1 = ((cxs - bx) * (qy - by) - (cys - by) * (qx - bx)) / area;
        const w2 = ((ax - cxs) * (qy - cys) - (ay - cys) * (qx - cxs)) / area;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w1 * sz[a]! + w2 * sz[b]! + w0 * sz[c]!;
        const index = py * size + px;
        if (z <= depth[index]!) continue;
        depth[index] = z;
        shade[index] = light;
        covered[index] = 1;
      }
    }
  }

  // --- report en pixels ---------------------------------------------------------------
  const linear: [number, number, number] = [
    toLinear(fallback[0]),
    toLinear(fallback[1]),
    toLinear(fallback[2]),
  ];
  for (let i = 0; i < size * size; i++) {
    if (!covered[i]) continue;
    const light = shade[i]!;
    const offset = i * 4;
    out[offset] = toSrgb(linear[0] * light);
    out[offset + 1] = toSrgb(linear[1] * light);
    out[offset + 2] = toSrgb(linear[2] * light);
    out[offset + 3] = 255;
  }
  return out;
}
