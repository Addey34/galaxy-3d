/* global Buffer */
/**
 * DEUX SOURCES DE RELIEF DE PLUS POUR LE CUISEUR (GAL-PLANETARY-RELIEF-001, 2026-11-28).
 *
 * Le cuiseur (`bake-surface-height-tiles.mjs`) lisait des étiquettes PDS3 à image brute en grille
 * équirectangulaire (Lune, Mars, Cérès) et le GeoTIFF GÉOGRAPHIQUE flottant d'ETOPO (Terre). Ce module
 * ajoute, sans toucher à ces chemins :
 *
 *  - **un GeoTIFF PROJETÉ équirectangulaire en mètres, entiers 16 bits mis à l'échelle** (le MNT global de
 *    Mercure de l'USGS, `Mercury_Messenger_USGS_DEM_Global_665m_v2.tif`) : l'emprise se déduit du point
 *    d'attache, du pas en mètres et du rayon de la sphère DÉCLARÉS dans les balises, le méridien central
 *    (`ProjCenterLongGeoKey`) compris. Celui de Mercure vaut 180° : la première colonne est à la longitude 0
 *    et la grille couvre 0 → 360° Est (lu le 2026-11-28, conforme à la fiche de l'USGS). L'échelle et le
 *    décalage viennent des métadonnées GDAL (0,5 m), la valeur absente de `GDAL_NODATA` ;
 *  - **les trames sinusoïdales du GTDR de Magellan** (Vénus, `MGN-V-RDRS-5-GDR-TOPOGRAPHIC-V1.0`, volume
 *    MG_3002) : 4 lignes de 8 trames de 1 024 × 1 024, réassemblées puis REPROJETÉES sur la grille
 *    équirectangulaire de même résolution (22,755556 px/degré, soit 8 192 colonnes : exactement le niveau 4
 *    de la pyramide), par les équations publiées dans `label/dsmap.lbl` :
 *    LINE = SPECLINE − LAT·SCALE + 0,5 et SAMPLE = PROJSAMP + (LON − PROJ_LON)·SCALE·cos(LAT) + 0,5, avec
 *    SCALE = rayon / MAP_SCALE ; un entier désigne le CENTRE d'un pixel, le premier pixel valant 1.
 *
 * LES TROUS SE COMBLENT ET SE DÉCLARENT, ils ne se présentent jamais comme une mesure. Le GTDR n'a pas
 * d'altimétrie sur 2,6 % de la surface (valeur 0), surtout près des pôles. Le comblement (`fillHoles`) est
 * une pyramide « push-pull » : chaque niveau plus grossier moyenne les échantillons MESURÉS, puis les trous
 * reprennent, du plus grossier au plus fin, la valeur interpolée du niveau au-dessus. Aucun détail n'est
 * ajouté : c'est une surface lisse tendue entre les bords mesurés. La part comblée, pondérée par l'aire,
 * est écrite dans le manifeste et affichée dans le bandeau du relief.
 */

const TAG = {
  width: 256,
  height: 257,
  bitsPerSample: 258,
  compression: 259,
  stripOffsets: 273,
  samplesPerPixel: 277,
  rowsPerStrip: 278,
  stripByteCounts: 279,
  sampleFormat: 339,
  pixelScale: 33550,
  tiepoint: 33922,
  geoKeys: 34735,
  geoDoubles: 34736,
  gdalMetadata: 42112,
  noData: 42113,
};
const KEY = {
  rasterType: 1025,
  semiMajor: 2057,
  semiMinor: 2058,
  coordTrans: 3075,
  stdParallel1: 3078,
  centerLong: 3088,
  centerLat: 3089,
};
/** `CT_Equirectangular` (spécification GeoTIFF 1.0, § 6.3.3.3). */
const CT_EQUIRECTANGULAR = 17;
const RASTER_PIXEL_IS_AREA = 1;

/** Une clé GeoTIFF, valeur directe ou lue dans les doubles (`GeoDoubleParamsTag`). */
function geoKey(tags, id) {
  const keys = tags.get(TAG.geoKeys) ?? [];
  const doubles = tags.get(TAG.geoDoubles) ?? [];
  for (let k = 4; k + 3 < keys.length; k += 4) {
    if (keys[k] !== id) continue;
    if (keys[k + 1] === 0) return keys[k + 3];
    if (keys[k + 1] === TAG.geoDoubles) return doubles[keys[k + 3]];
  }
  return undefined;
}

/** Une valeur des métadonnées GDAL (`<Item name="SCALE" …>0.5</Item>`). */
function gdalItem(tags, name) {
  const xml = tags.get(TAG.gdalMetadata);
  if (typeof xml !== 'string') return undefined;
  const match = new RegExp(`<Item name="${name}"[^>]*>([^<]+)</Item>`).exec(
    xml
  );
  return match ? Number(match[1]) : undefined;
}

/**
 * La grille d'un GeoTIFF projeté équirectangulaire global en mètres (entiers signés 16 bits, sans
 * compression), vérifiée et non supposée : emprise EXACTE du globe, registre « cellule », sphère.
 */
export function projectedEquirectangularGrid(tags, source) {
  const one = (tag, name) => {
    const value = tags.get(tag);
    if (!Array.isArray(value) || value.length === 0)
      throw new Error(`${source} : balise ${name} (${tag}) absente`);
    return value;
  };
  const width = one(TAG.width, 'ImageWidth')[0];
  const height = one(TAG.height, 'ImageLength')[0];
  const bits = one(TAG.bitsPerSample, 'BitsPerSample')[0];
  const format = (tags.get(TAG.sampleFormat) ?? [1])[0];
  const channels = (tags.get(TAG.samplesPerPixel) ?? [1])[0];
  const compression = (tags.get(TAG.compression) ?? [1])[0];
  if (channels !== 1 || bits !== 16 || format !== 2 || compression !== 1)
    throw new Error(
      `${source} : ${channels} canal(aux) de ${bits} bits au format ${format}, compression ${compression} ; ` +
        'attendu un seul canal d’entiers signés 16 bits sans compression'
    );
  if (geoKey(tags, KEY.coordTrans) !== CT_EQUIRECTANGULAR)
    throw new Error(`${source} : projection autre qu'équirectangulaire`);
  if (geoKey(tags, KEY.rasterType) !== RASTER_PIXEL_IS_AREA)
    throw new Error(`${source} : registre autre que « cellule » (PixelIsArea)`);
  const a = geoKey(tags, KEY.semiMajor);
  const b = geoKey(tags, KEY.semiMinor);
  if (!(a > 0) || a !== b)
    throw new Error(`${source} : demi-axes ${a} et ${b} m, attendu une sphère`);
  if ((geoKey(tags, KEY.stdParallel1) ?? 0) !== 0)
    throw new Error(`${source} : parallèle standard non nul`);
  if ((geoKey(tags, KEY.centerLat) ?? 0) !== 0)
    throw new Error(`${source} : latitude centrale non nulle`);
  const centerLong = geoKey(tags, KEY.centerLong) ?? 0;
  const [sx, sy] = one(TAG.pixelScale, 'ModelPixelScale');
  const [i, j, , x, y] = one(TAG.tiepoint, 'ModelTiepoint');
  if (i !== 0 || j !== 0 || Math.abs(sx - sy) > 1e-9)
    throw new Error(`${source} : point d'attache ou pas inattendus`);
  const metresPerDegree = (a * Math.PI) / 180;
  const pixelsPerDegree = metresPerDegree / sx;
  const westDeg = centerLong + x / metresPerDegree;
  const northDeg = y / metresPerDegree;
  const eastDeg = westDeg + width / pixelsPerDegree;
  const southDeg = northDeg - height / pixelsPerDegree;
  const off = (u, v) => Math.abs(u - v) > 1e-6;
  if (off(eastDeg - westDeg, 360) || off(northDeg, 90) || off(southDeg, -90))
    throw new Error(
      `${source} : emprise ${westDeg}…${eastDeg}° x ${southDeg}…${northDeg}°, pas le globe`
    );
  const scale = gdalItem(tags, 'SCALE') ?? 1;
  const offset = gdalItem(tags, 'OFFSET') ?? 0;
  if (offset !== 0)
    throw new Error(`${source} : décalage GDAL ${offset}, seul 0 est lu`);
  const noDataText = tags.get(TAG.noData);
  return {
    width,
    height,
    pixelsPerDegree,
    westDeg,
    eastDeg,
    northDeg,
    southDeg,
    radiusKm: a / 1000,
    quantumMetres: scale,
    noData: typeof noDataText === 'string' ? Number(noDataText) : undefined,
    stripOffsets: one(TAG.stripOffsets, 'StripOffsets'),
    stripByteCounts: one(TAG.stripByteCounts, 'StripByteCounts'),
    rowsPerStrip: (tags.get(TAG.rowsPerStrip) ?? [height])[0],
    centerLongDeg: centerLong,
  };
}

/** Les entiers d'un GeoTIFF projeté, bande par bande (aucune bande n'est supposée contiguë). */
export function readInt16Strips(bytes, grid, source) {
  const out = new Int16Array(grid.width * grid.height);
  const perStrip = grid.rowsPerStrip * grid.width;
  grid.stripOffsets.forEach((at, k) => {
    const count = Math.min(perStrip, out.length - k * perStrip);
    if (grid.stripByteCounts[k] !== count * 2)
      throw new Error(
        `${source} : bande ${k} de ${grid.stripByteCounts[k]} octets`
      );
    for (let n = 0; n < count; n += 1)
      out[k * perStrip + n] = bytes.readInt16LE(at + n * 2);
  });
  return out;
}

// ── Le GTDR de Magellan ──────────────────────────────────────────────────────────────────────

/** Les champs d'une étiquette de trame GTDR dont la reprojection a besoin, vérifiés. */
export function parseGtdrLabel(text, source) {
  const field = (name) => {
    const m = new RegExp(
      `^\\s*${name.replace(/\^/g, '\\^')}\\s*=\\s*([^\\r\\n]+)`,
      'm'
    ).exec(text);
    if (!m) throw new Error(`${source} : champ ${name} absent`);
    return m[1]
      .replace(/<[^>]*>/g, '')
      .replace(/['"]/g, '')
      .trim();
  };
  const num = (name) => {
    const v = Number.parseFloat(field(name));
    if (!Number.isFinite(v)) throw new Error(`${source} : ${name} illisible`);
    return v;
  };
  const label = {
    dataSetId: field('DATA_SET_ID'),
    recordBytes: num('RECORD_BYTES'),
    imageRecord: Number.parseInt(
      /\(\s*"?[^",]+"?\s*,\s*(\d+)\s*\)/.exec(field('^IMAGE'))?.[1] ?? 'NaN',
      10
    ),
    lines: num('LINES'),
    lineSamples: num('LINE_SAMPLES'),
    sampleType: field('SAMPLE_TYPE'),
    sampleBits: num('SAMPLE_BITS'),
    scalingMetres: num('SCALING_FACTOR'),
    offsetMetres: num('OFFSET'),
    missing: num('MISSING'),
    projection: field('MAP_PROJECTION_TYPE'),
    pixelsPerDegree: num('MAP_RESOLUTION'),
    metresPerPixel: num('MAP_SCALE'),
    specline: num('X_AXIS_PROJECTION_OFFSET'),
    projsamp: num('Y_AXIS_PROJECTION_OFFSET'),
    radiusKm: num('A_AXIS_RADIUS'),
    bRadiusKm: num('B_AXIS_RADIUS'),
    cRadiusKm: num('C_AXIS_RADIUS'),
    centerLongitudeDeg: num('CENTER_LONGITUDE'),
    eastPositive: field('POSITIVE_LONGITUDE_DIRECTION') === 'EAST',
  };
  if (label.projection !== 'SINUSOIDAL')
    throw new Error(
      `${source} : projection ${label.projection}, attendu SINUSOIDAL`
    );
  if (label.sampleType !== 'LSB_UNSIGNED_INTEGER' || label.sampleBits !== 16)
    throw new Error(
      `${source} : échantillons ${label.sampleType} ${label.sampleBits} bits`
    );
  if (label.radiusKm !== label.bRadiusKm || label.radiusKm !== label.cRadiusKm)
    throw new Error(`${source} : demi-axes différents, attendu une sphère`);
  if (!label.eastPositive)
    throw new Error(`${source} : longitudes non croissantes vers l'Est`);
  if (!Number.isInteger(label.imageRecord))
    throw new Error(`${source} : enregistrement de l'image illisible`);
  // SCALE de `dsmap.lbl` (pixels par radian) et MAP_RESOLUTION (pixels par degré) disent la même chose.
  const scale = (label.radiusKm * 1000) / label.metresPerPixel;
  if (Math.abs((scale * Math.PI) / 180 - label.pixelsPerDegree) > 1e-4)
    throw new Error(`${source} : MAP_SCALE et MAP_RESOLUTION incohérents`);
  return { ...label, scalePerRadian: scale };
}

/**
 * Réassemble les trames (lignes de `columns` trames, numérotées de gauche à droite puis de haut en bas) et
 * reprojette en équirectangulaire, ouest à −180°. Rend les altitudes en mètres au-dessus de `datumKm` et le
 * masque des cellules SANS mesure.
 */
export function reprojectGtdrSinusoidal(framelets, { columns, datumKm }) {
  const first = framelets[0].label;
  const rows = framelets.length / columns;
  if (!Number.isInteger(rows))
    throw new Error('GTDR : nombre de trames incomplet');
  const fw = first.lineSamples;
  const fh = first.lines;
  framelets.forEach(({ label }, k) => {
    const r = Math.floor(k / columns);
    const c = k % columns;
    // Chaque trame porte les paramètres de SA position : ils doivent suivre ceux de la première.
    if (
      label.specline !== first.specline - fh * r ||
      label.projsamp !== first.projsamp - fw * c ||
      label.scalePerRadian !== first.scalePerRadian ||
      label.centerLongitudeDeg !== first.centerLongitudeDeg ||
      label.offsetMetres !== first.offsetMetres ||
      label.scalingMetres !== first.scalingMetres
    )
      throw new Error(`GTDR : trame ${k + 1} hors de la mosaïque attendue`);
  });
  const W = fw * columns;
  const H = fh * rows;
  const full = new Uint16Array(W * H);
  framelets.forEach(({ samples }, k) => {
    const r = Math.floor(k / columns);
    const c = k % columns;
    for (let y = 0; y < fh; y += 1)
      full.set(
        samples.subarray(y * fw, (y + 1) * fw),
        (r * fh + y) * W + c * fw
      );
  });

  const ppd = first.pixelsPerDegree;
  const outW = Math.round(360 * ppd);
  const outH = Math.round(180 * ppd);
  const values = new Float32Array(outW * outH);
  const missing = new Uint8Array(outW * outH);
  const scale = first.scalePerRadian;
  const lon0 = (first.centerLongitudeDeg * Math.PI) / 180;
  const datumOffset = first.offsetMetres - datumKm * 1000;
  for (let row = 0; row < outH; row += 1) {
    const lat = ((90 - (row + 0.5) / ppd) * Math.PI) / 180;
    const cos = Math.cos(lat);
    // Indice 0 de la ligne : LINE − 1, LINE entier au centre du pixel.
    const li = first.specline - lat * scale + 0.5 - 1;
    const l0 = Math.floor(li);
    const fl = li - l0;
    for (let col = 0; col < outW; col += 1) {
      const lon = ((-180 + (col + 0.5) / ppd) * Math.PI) / 180;
      const si = first.projsamp + (lon - lon0) * scale * cos + 0.5 - 1;
      const s0 = Math.floor(si);
      const fs = si - s0;
      let num = 0;
      let den = 0;
      for (const [dl, ds, w] of [
        [0, 0, (1 - fs) * (1 - fl)],
        [0, 1, fs * (1 - fl)],
        [1, 0, (1 - fs) * fl],
        [1, 1, fs * fl],
      ]) {
        const l = Math.min(H - 1, Math.max(0, l0 + dl));
        const s = Math.min(W - 1, Math.max(0, s0 + ds));
        const dn = full[l * W + s];
        if (dn === first.missing) continue;
        num += w * (dn * first.scalingMetres + datumOffset);
        den += w;
      }
      const cell = row * outW + col;
      // Moins de la moitié du poids bilinéaire mesurée : la cellule est un trou, elle sera comblée.
      if (den < 0.5) missing[cell] = 1;
      else values[cell] = num / den;
    }
  }
  return { width: outW, height: outH, pixelsPerDegree: ppd, values, missing };
}

/**
 * Comble les trous d'une grille équirectangulaire globale (longitudes enroulées) par une pyramide
 * push-pull, et rend la part comblée PONDÉRÉE PAR L'AIRE (cos de la latitude). Aucun détail ajouté.
 */
export function fillHoles(values, missing, width, height) {
  let holes = 0;
  let area = 0;
  let filledArea = 0;
  for (let row = 0; row < height; row += 1) {
    const w = Math.cos(((90 - (row + 0.5) * (180 / height)) * Math.PI) / 180);
    for (let col = 0; col < width; col += 1) {
      area += w;
      if (missing[row * width + col]) {
        holes += 1;
        filledArea += w;
      }
    }
  }
  if (holes === 0) return { holes: 0, filledFraction: 0 };
  // Pousser : moyennes des échantillons MESURÉS, niveau par niveau (2 x 2 → 1).
  const levels = [
    {
      w: width,
      h: height,
      v: Float32Array.from(values),
      m: Float32Array.from(missing, (x) => (x ? 0 : 1)),
    },
  ];
  while (levels.at(-1).w > 1 && levels.at(-1).h > 1) {
    const p = levels.at(-1);
    const w = Math.ceil(p.w / 2);
    const h = Math.ceil(p.h / 2);
    const v = new Float32Array(w * h);
    const m = new Float32Array(w * h);
    for (let y = 0; y < h; y += 1)
      for (let x = 0; x < w; x += 1) {
        let s = 0;
        let n = 0;
        for (let dy = 0; dy < 2; dy += 1)
          for (let dx = 0; dx < 2; dx += 1) {
            const yy = Math.min(p.h - 1, 2 * y + dy);
            const xx = (2 * x + dx) % p.w;
            const k = yy * p.w + xx;
            s += p.v[k] * p.m[k];
            n += p.m[k];
          }
        v[y * w + x] = n > 0 ? s / n : 0;
        m[y * w + x] = n > 0 ? 1 : 0;
      }
    levels.push({ w, h, v, m });
  }
  // Tirer : du plus grossier au plus fin, un trou prend la valeur bilinéaire du niveau au-dessus.
  for (let i = levels.length - 2; i >= 0; i -= 1) {
    const fine = levels[i];
    const coarse = levels[i + 1];
    for (let y = 0; y < fine.h; y += 1)
      for (let x = 0; x < fine.w; x += 1) {
        const k = y * fine.w + x;
        if (fine.m[k] > 0) continue;
        const cx = (x + 0.5) / 2 - 0.5;
        const cy = Math.min(coarse.h - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
        const x0 = Math.floor(cx);
        const y0 = Math.floor(cy);
        const fx = cx - x0;
        const fy = cy - y0;
        const at = (xx, yy) =>
          coarse.v[
            Math.min(coarse.h - 1, yy) * coarse.w +
              (((xx % coarse.w) + coarse.w) % coarse.w)
          ];
        fine.v[k] =
          (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) +
          (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
        fine.m[k] = 1;
      }
  }
  for (let k = 0; k < values.length; k += 1)
    if (missing[k]) values[k] = levels[0].v[k];
  return { holes, filledFraction: filledArea / area };
}

/** Pour les tests : un tampon d'entiers 16 bits petit-boutistes. */
export function int16BufferForTest(values) {
  const b = Buffer.alloc(values.length * 2);
  values.forEach((v, k) => b.writeInt16LE(v, k * 2));
  return b;
}
