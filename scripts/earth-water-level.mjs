/**
 * LE NIVEAU DE L'EAU SUR LE RELIEF DE LA TERRE — module pur, testé (lot 48).
 *
 * ETOPO 2022 publie la surface de la Terre, et SOUS L'EAU il publie le FOND : la bathymétrie des
 * océans, et celle de quelques grands lacs. L'imagerie, elle, montre la surface de l'eau. Posée
 * telle quelle, une image d'océan s'enfoncerait de quatre kilomètres, et le lac Supérieur
 * deviendrait une fosse de 400 m sous une image plate. Ce module ramène chaque étendue d'eau à son
 * NIVEAU, et ne touche à rien d'autre.
 *
 * Mesuré sur ETOPO 2022 à 60″ et le masque d'eau MODIS/SRTM de NASA GIBS (2026-10-12), étendue par
 * étendue :
 *
 *  - ETOPO donne la SURFACE de la plupart des lacs, plate au mètre (mer Morte −427 m, Victoria
 *    1 133, Tanganyika 770, Titicaca 3 809, 82 à 98 % des cellules au mode) : rien à faire ;
 *  - il donne le FOND de quelques-uns, qui ne sont donc PAS plats (1 à 12 % au mode) : la
 *    Caspienne, la mer Noire, le Baïkal, les Grands Lacs, et des fjords que le masque, à 1,85 km
 *    la cellule, a coupés de l'océan ;
 *  - un niveau tiré de la rive ne vaut pas partout : la rive escarpée d'un fjord donne 140 m de
 *    médiane pour une eau au niveau de la mer, et des taches « d'eau » du masque sur les volcans du
 *    Kamtchatka (1 000 à 2 300 m) seraient comblées en terrasses. D'où les DEUX classes ci-dessous,
 *    et rien hors d'elles.
 *
 * Les seuils sont des choix MESURÉS sur ces étendues, écrits ici une fois ; la cuisson les publie
 * avec la liste de ce qu'elle a comblé, pour qu'un lecteur voie ce qui a été modifié et de combien.
 */

/** Seuils de la règle, publiés dans le manifeste avec elle. */
export const WATER_RULE = {
  /** Une étendue plus petite n'est jamais modifiée : rivières, étangs, bruit du masque. */
  minimumCells: 50,
  /** Part des cellules à un mètre du mode au-delà de laquelle ETOPO donne déjà la surface. */
  flatShare: 0.5,
  /** Un bras de mer a sa rive au niveau de la mer ET un fond profond (le Danakil, −125 m, non). */
  seaArmFloorMetres: -150,
  /** Un grand lac a ses fonds publiés par ETOPO ; un petit est laissé tel quel (réservoirs, névés). */
  greatLakeCells: 5000,
  /**
   * Une cellule que le masque dit « terre » mais plus basse qu'une eau voisine nivelée est sous
   * cette eau : le masque, à 1,85 km la cellule, déborde ou manque la rive d'une à deux cellules,
   * et ETOPO y donne encore le fond. Mesuré sur la tuile du lac Supérieur : un anneau à 52 m sous
   * l'ellipsoïde autour d'eaux nivelées à 182 et 194 m. L'inondation s'arrête à cette distance :
   * au-delà, une terre plus basse que la mer (un polder) reste une terre.
   */
  shoreCells: 3,
  /**
   * Et ce fond est BIEN sous la rive : l'Ob, la Petchora et l'Aral, peu profonds sous leur rive
   * (8 à 15 m), sont des rivières et un lac dont ETOPO donne déjà la surface ; le lac Érié, le
   * moins profond des Grands Lacs ici, l'est de 65 m.
   */
  submergedMetres: 50,
};

const NEIGHBOURS = (width, height, cell, out) => {
  const y = (cell / width) | 0;
  const x = cell - y * width;
  out[0] = y > 0 ? cell - width : -1;
  out[1] = y < height - 1 ? cell + width : -1;
  // La longitude s'enroule : l'antiméridien n'est pas un rivage.
  out[2] = x > 0 ? cell - 1 : cell + width - 1;
  out[3] = x < width - 1 ? cell + 1 : cell - width + 1;
  return out;
};

/** Étendues d'eau 4-connexes : étiquette par cellule, et pour chacune sa taille et son fond. */
function components(elevation, water, width, height) {
  const count = width * height;
  const label = new Int32Array(count);
  const stack = new Int32Array(count);
  const around = [0, 0, 0, 0];
  const bodies = [];
  let next = 1;
  for (let start = 0; start < count; start += 1) {
    if (!water[start] || label[start]) continue;
    const id = next;
    next += 1;
    let top = 0;
    stack[top++] = start;
    label[start] = id;
    let cells = 0;
    let sumX = 0;
    let sumY = 0;
    let deepest = Number.POSITIVE_INFINITY;
    while (top > 0) {
      const cell = stack[--top];
      cells += 1;
      const y = (cell / width) | 0;
      sumX += cell - y * width;
      sumY += y;
      if (elevation[cell] < deepest) deepest = elevation[cell];
      for (const n of NEIGHBOURS(width, height, cell, around))
        if (n >= 0 && water[n] && !label[n]) {
          label[n] = id;
          stack[top++] = n;
        }
    }
    bodies.push({ id, cells, start, sumX, sumY, deepest });
  }
  bodies.sort((a, b) => b.cells - a.cells);
  return { label, bodies };
}

/**
 * Ramène l'eau à son niveau, en place. `elevation` : altitudes ETOPO (m), `water` : 1 pour une
 * cellule d'eau. Rend la borne de la terre sèche et la liste des étendues modifiées, la plus
 * grande (l'océan) en tête.
 *
 * LE MASQUE A DES TROUS, et ETOPO les révèle : des fjords du Groenland classés en terre, une
 * cellule « terre » à −5 899 m en plein océan Indien (mesuré le 2026-10-12). Aucune terre émergée
 * ne peut être plus basse que la plus basse surface d'eau PLATE que publie ETOPO (c'est la mer
 * Morte, −427 m) : une première passe la mesure, et toute cellule de « terre » sous elle est de
 * l'eau que le masque a manquée. La borne est dérivée des données, pas écrite.
 */
export function levelWater(elevation, water, width, height, rule = WATER_RULE) {
  const count = width * height;
  const first = components(elevation, water, width, height);
  let lowestFlat = Number.POSITIVE_INFINITY;
  let lowestFlatAt = null;
  for (const body of first.bodies.slice(1)) {
    if (body.cells < rule.minimumCells) continue;
    const { mode, flat } = statistics(
      elevation,
      water,
      first.label,
      body,
      width,
      height
    );
    if (flat >= rule.flatShare && mode < lowestFlat) {
      lowestFlat = mode;
      lowestFlatAt = centreOf(body, width, height);
    }
  }
  let added = 0;
  if (Number.isFinite(lowestFlat))
    for (let cell = 0; cell < count; cell += 1)
      if (!water[cell] && elevation[cell] < lowestFlat) {
        water[cell] = 1;
        added += 1;
      }
  const { label, bodies } = components(elevation, water, width, height);
  const dryLand = {
    lowestFlatWaterMetres: lowestFlat,
    at: lowestFlatAt,
    cellsTurnedToWater: added,
  };
  if (bodies.length === 0) return { dryLand, bodies: [] };
  const levels = new Map();
  const changed = [];
  const centre = (body) => centreOf(body, width, height);

  // L'OCÉAN : la plus grande étendue. Le zéro d'ETOPO est le géoïde EGM2008, c'est-à-dire le
  // niveau moyen de la mer : ce n'est pas une valeur choisie, c'est la définition de son datum.
  const ocean = bodies[0];
  levels.set(ocean.id, 0);
  changed.push({
    kind: 'ocean',
    ...centre(ocean),
    cells: ocean.cells,
    levelMetres: 0,
    deepestMetres: Math.round(ocean.deepest),
  });

  for (const body of bodies.slice(1)) {
    if (body.cells < rule.minimumCells) continue;
    const { mode, flat, ringMedian, ringP10 } = statistics(
      elevation,
      water,
      label,
      body,
      width,
      height
    );
    if (flat >= rule.flatShare) continue;
    let level;
    let kind;
    if (ringP10 <= 0 && body.deepest <= rule.seaArmFloorMetres) {
      kind = 'sea-arm';
      level = Math.min(0, ringMedian);
    } else if (
      ringP10 > 0 &&
      body.cells >= rule.greatLakeCells &&
      ringMedian - body.deepest > rule.submergedMetres
    ) {
      kind = 'great-lake';
      level = ringMedian;
    } else continue;
    level = Math.round(level);
    levels.set(body.id, level);
    changed.push({
      kind,
      ...centre(body),
      cells: body.cells,
      levelMetres: level,
      deepestMetres: Math.round(body.deepest),
      modeMetres: mode,
    });
  }
  // On RELÈVE seulement : une cellule plus haute que le niveau (rive mal recalée, rivière) garde
  // son altitude, parce que rien ne dit qu'elle est sous l'eau.
  const reached = new Float32Array(count).fill(Number.NaN);
  const around = [0, 0, 0, 0];
  // Le front de départ ne garde que les cellules d'eau qui touchent une terre : l'océan seul en
  // compte 155 millions, bien au-delà de ce qu'un tableau JavaScript accepte.
  let front = [];
  for (let cell = 0; cell < count; cell += 1) {
    const level = levels.get(label[cell]);
    if (level === undefined) continue;
    reached[cell] = level;
    if (elevation[cell] < level) elevation[cell] = level;
    for (const n of NEIGHBOURS(width, height, cell, around))
      if (n >= 0 && !water[n]) {
        front.push(cell);
        break;
      }
  }
  // La rive : au plus `shoreCells` cellules de « terre » plus basses que l'eau qu'elles touchent.
  let flooded = 0;
  for (let step = 0; step < rule.shoreCells && front.length > 0; step += 1) {
    const next = [];
    for (const cell of front) {
      const level = reached[cell];
      for (const n of NEIGHBOURS(width, height, cell, around)) {
        if (n < 0 || water[n] || !Number.isNaN(reached[n])) continue;
        if (elevation[n] >= level) continue;
        reached[n] = level;
        elevation[n] = level;
        flooded += 1;
        next.push(n);
      }
    }
    front = next;
  }
  dryLand.shoreCellsFlooded = flooded;
  return { dryLand, bodies: changed };
}

function centreOf(body, width, height) {
  return {
    latitudeDeg: 90 - ((body.sumY / body.cells + 0.5) * 180) / height,
    longitudeDeg: -180 + ((body.sumX / body.cells + 0.5) * 360) / width,
  };
}

/** Mode, part plate, et rive (médiane et 10ᵉ centile des cellules de terre adjacentes). */
function statistics(elevation, water, label, body, width, height) {
  const histogram = new Map();
  const ring = [];
  const stack = [body.start];
  const seen = new Set([body.start]);
  const around = [0, 0, 0, 0];
  while (stack.length > 0) {
    const cell = stack.pop();
    const rounded = Math.round(elevation[cell]);
    histogram.set(rounded, (histogram.get(rounded) ?? 0) + 1);
    for (const n of NEIGHBOURS(width, height, cell, around)) {
      if (n < 0) continue;
      if (!water[n]) ring.push(elevation[n]);
      else if (label[n] === body.id && !seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  let mode = 0;
  let best = -1;
  for (const [value, n] of histogram)
    if (n > best) {
      best = n;
      mode = value;
    }
  let flat = 0;
  for (const [value, n] of histogram)
    if (Math.abs(value - mode) <= 1) flat += n;
  ring.sort((a, b) => a - b);
  const at = (q) => (ring.length ? ring[Math.floor(q * (ring.length - 1))] : 0);
  return {
    mode,
    flat: flat / body.cells,
    ringMedian: at(0.5),
    ringP10: at(0.1),
  };
}
