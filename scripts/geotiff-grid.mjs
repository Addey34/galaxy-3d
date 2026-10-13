/* global Buffer */
/**
 * LES BALISES GÉOGRAPHIQUES D'UN GEOTIFF, LUES ET NON SUPPOSÉES (lot 48, relief de la Terre).
 *
 * Le cuiseur de hauteurs ne lisait que des étiquettes PDS3. ETOPO 2022 (NOAA NCEI) est un GeoTIFF :
 * son emprise, sa résolution, son REGISTRE (un échantillon décrit-il une cellule ou un nœud ?) et
 * sa valeur « absente » sont dans des balises TIFF, pas dans un texte. Aucune bibliothèque GeoTIFF
 * n'est installée, et une seule lecture suffit : le premier répertoire d'image (IFD) d'un TIFF
 * classique. Les PIXELS, eux, sont décodés par `sharp` (libtiff), qui gère la compression ; ce
 * module ne dit que OÙ ils sont sur le globe.
 *
 * Le registre compte : à 60″, un demi-échantillon vaut 0,5′, soit 926 m à l'équateur. Un relief
 * décalé d'autant reste parfaitement plausible à l'œil, et c'est exactement le défaut que la règle 2
 * du cuiseur (« la géométrie de la source est vérifiée, pas supposée ») existe pour refuser.
 */

const TYPE_BYTES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8, 16: 8 };

/** Les balises du premier IFD, valeurs décodées (nombres ou texte). */
export function readTiffTags(bytes) {
  const order = bytes.toString('latin1', 0, 2);
  if (order !== 'II' && order !== 'MM')
    throw new Error('pas un TIFF : ni « II » ni « MM » en tête');
  const le = order === 'II';
  const u16 = (o) => (le ? bytes.readUInt16LE(o) : bytes.readUInt16BE(o));
  const u32 = (o) => (le ? bytes.readUInt32LE(o) : bytes.readUInt32BE(o));
  const f64 = (o) => (le ? bytes.readDoubleLE(o) : bytes.readDoubleBE(o));
  if (u16(2) !== 42)
    throw new Error(
      `TIFF de version ${u16(2)} : seul le TIFF classique (42) est lu ici, pas le BigTIFF (43)`
    );
  const ifd = u32(4);
  const count = u16(ifd);
  const tags = new Map();
  for (let i = 0; i < count; i += 1) {
    const at = ifd + 2 + i * 12;
    const tag = u16(at);
    const type = u16(at + 2);
    const n = u32(at + 4);
    const size = (TYPE_BYTES[type] ?? 0) * n;
    const data = size <= 4 ? at + 8 : u32(at + 8);
    if (type === 2) {
      tags.set(
        tag,
        bytes.toString('latin1', data, data + n).replace(/\0+$/, '')
      );
      continue;
    }
    const values = [];
    for (let k = 0; k < n; k += 1) {
      if (type === 3) values.push(u16(data + k * 2));
      else if (type === 4) values.push(u32(data + k * 4));
      else if (type === 12) values.push(f64(data + k * 8));
    }
    tags.set(tag, values);
  }
  return tags;
}

const TAG = {
  width: 256,
  height: 257,
  bitsPerSample: 258,
  samplesPerPixel: 277,
  sampleFormat: 339,
  pixelScale: 33550,
  tiepoint: 33922,
  geoKeys: 34735,
  noData: 42113,
};

/** Clés GeoTIFF employées (spécification OGC GeoTIFF 1.1, § 7.1.1 et 7.1.2). */
const GEO_KEY = { rasterType: 1025, geographicType: 2048 };
const RASTER_PIXEL_IS_AREA = 1;
const RASTER_PIXEL_IS_POINT = 2;
const EPSG_WGS84 = 4326;

/**
 * La grille d'un GeoTIFF géographique global, dans la forme qu'emploie `DemGrid` du cuiseur : coins
 * EXTÉRIEURS des cellules (`westDeg`, `northDeg`, convention « cellule ») et pixels par degré.
 *
 * LE REGISTRE NE DIT QUE CE QUE DÉSIGNE LE POINT D'ATTACHE, et les deux fichiers d'ETOPO 2022 le
 * montrent (mesuré le 2026-10-12) : la surface est en « PixelIsArea », attachée au COIN (−180°, 90°) ;
 * le géoïde est en « PixelIsPoint », attaché au CENTRE de sa première cellule (−179,99167°,
 * 89,99167°). Même largeur (21 600), mêmes centres. En « point », le coin est donc à un
 * demi-échantillon vers l'extérieur ; dans les deux cas l'emprise doit faire exactement le globe.
 */
const GLOBE = { west: -180, east: 180, north: 90, south: -90 };

export function geoTiffGrid(bytes, source, expected = GLOBE) {
  const tags = readTiffTags(bytes);
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
  if (channels !== 1 || bits !== 32 || format !== 3)
    throw new Error(
      `${source} : ${channels} canal(aux) de ${bits} bits au format ${format}, attendu un seul canal flottant 32 bits`
    );
  const [sx, sy] = one(TAG.pixelScale, 'ModelPixelScale');
  const [i, j, , x, y] = one(TAG.tiepoint, 'ModelTiepoint');
  if (i !== 0 || j !== 0)
    throw new Error(
      `${source} : point d'attache en (${i}, ${j}), attendu (0, 0)`
    );
  if (Math.abs(sx - sy) > 1e-12)
    throw new Error(
      `${source} : pas de ${sx}° en longitude et ${sy}° en latitude, attendu égaux`
    );

  const keys = one(TAG.geoKeys, 'GeoKeyDirectory');
  const geoKey = (id) => {
    for (let k = 4; k + 3 < keys.length; k += 4)
      if (keys[k] === id && keys[k + 1] === 0) return keys[k + 3];
    return undefined;
  };
  const rasterType = geoKey(GEO_KEY.rasterType);
  if (
    rasterType !== RASTER_PIXEL_IS_AREA &&
    rasterType !== RASTER_PIXEL_IS_POINT
  )
    throw new Error(
      `${source} : registre (RasterTypeGeoKey) absent ou inconnu (${rasterType})`
    );
  const crs = geoKey(GEO_KEY.geographicType);
  if (crs !== EPSG_WGS84)
    throw new Error(
      `${source} : système géographique ${crs}, attendu EPSG:${EPSG_WGS84}`
    );

  const pointAttached = rasterType === RASTER_PIXEL_IS_POINT;
  const half = pointAttached ? sx / 2 : 0;
  const westDeg = x - half;
  const northDeg = y + half;
  const pixelsPerDegree = 1 / sx;
  const eastDeg = westDeg + width * sx;
  const southDeg = northDeg - height * sx;
  // Règle 2 du cuiseur : une grille couvre EXACTEMENT l'emprise attendue, le globe par défaut (de
  // −180° à 180° et de 90° à −90°), ou celle qu'annonce le nom d'une tuile régionale (ETOPO 15″ :
  // 15° x 15°, coin nord-ouest dans le nom). Une grille à nœuds (une colonne de plus) est refusée :
  // le cuiseur ne sait pas la lire, et elle tomberait ici plutôt que décalée d'un demi-échantillon.
  const off = (a, b) => Math.abs(a - b) > 1e-6;
  if (
    off(westDeg, expected.west) ||
    off(eastDeg, expected.east) ||
    off(northDeg, expected.north) ||
    off(southDeg, expected.south)
  )
    throw new Error(
      `${source} : emprise ${westDeg}…${eastDeg}° x ${southDeg}…${northDeg}° (${width} x ${height} à ${sx}°), ` +
        (expected === GLOBE
          ? 'pas le globe'
          : `attendu ${expected.west}…${expected.east}° x ${expected.south}…${expected.north}°`)
    );
  const noDataText = tags.get(TAG.noData);
  return {
    width,
    height,
    pixelsPerDegree,
    westDeg,
    eastDeg,
    northDeg,
    southDeg,
    attachedTo: pointAttached ? 'centre' : 'corner',
    noData: typeof noDataText === 'string' ? Number(noDataText) : undefined,
  };
}

/** Pour les tests : un tampon TIFF minimal portant les balises géographiques données. */
export function tiffHeaderForTest({
  width,
  height,
  scale,
  tieX,
  tieY,
  rasterType,
  crs = 4326,
}) {
  const entries = [
    [256, 4, [width]],
    [257, 4, [height]],
    [258, 3, [32]],
    [277, 3, [1]],
    [339, 3, [3]],
    [33550, 12, [scale, scale, 0]],
    [33922, 12, [0, 0, 0, tieX, tieY, 0]],
    [34735, 3, [1, 1, 0, 2, 1025, 0, 1, rasterType, 2048, 0, 1, crs]],
  ];
  const extra = [];
  let extraAt = 8 + 2 + entries.length * 12 + 4;
  const ifd = Buffer.alloc(2 + entries.length * 12 + 4);
  ifd.writeUInt16LE(entries.length, 0);
  entries.forEach(([tag, type, values], k) => {
    const at = 2 + k * 12;
    ifd.writeUInt16LE(tag, at);
    ifd.writeUInt16LE(type, at + 2);
    ifd.writeUInt32LE(values.length, at + 4);
    const size = TYPE_BYTES[type] * values.length;
    const data = Buffer.alloc(size);
    values.forEach((v, n) => {
      if (type === 3) data.writeUInt16LE(v, n * 2);
      else if (type === 4) data.writeUInt32LE(v, n * 4);
      else data.writeDoubleLE(v, n * 8);
    });
    if (size <= 4) data.copy(ifd, at + 8);
    else {
      ifd.writeUInt32LE(extraAt, at + 8);
      extra.push(data);
      extraAt += size;
    }
  });
  const head = Buffer.alloc(8);
  head.write('II', 0, 'latin1');
  head.writeUInt16LE(42, 2);
  head.writeUInt32LE(8, 4);
  return Buffer.concat([head, ifd, ...extra]);
}
