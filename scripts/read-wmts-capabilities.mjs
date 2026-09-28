/* global console, process, fetch */
/**
 * LIRE les capabilities WMTS d'un jeu de tuiles, pour n'avoir jamais à en DEVINER une ligne.
 *
 * POURQUOI. Depuis le lot 9 un jeu de tuiles est une FICHE (`src/registry/products/tilesets/`),
 * et la règle du dépôt est que chaque portail soit LU à ses capabilities. Le reste se paie cher :
 * une matrice mal recopiée ne se voit pas sur une vue d'ensemble, elle se voit à l'approche, et
 * un 404 de Trek ne porte aucun en-tête CORS, donc il ressemble EXACTEMENT à un refus CORS
 * (cf. `core/tileUrl.ts`, qui refuse une ligne ou une colonne hors matrice AVANT d'émettre).
 *
 * LE PIÈGE QUE CE SCRIPT EXISTE POUR ÉVITER, et il est réel : les capabilities de Trek portent
 * des blocs `TileMatrix` EN COMMENTAIRE, décrivant une autre matrice (3 × 2 au niveau zéro là où
 * la matrice active est 2 × 1). Un lecteur naïf les prend pour argent comptant et écrit une fiche
 * fausse qui a l'air juste. Les commentaires sont donc retirés AVANT toute lecture.
 *
 * Usage :
 *   node scripts/read-wmts-capabilities.mjs <url des capabilities>
 *   node scripts/read-wmts-capabilities.mjs --body Mercury --label Mercury_..._166m
 *
 * Il n'écrit aucun fichier : il imprime le bloc « service » de la fiche, à relire puis à poser.
 */

const argv = process.argv.slice(2);
const option = (flag) => {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
};

const body = option('--body');
const label = option('--label');
const url =
  argv.find((a) => a.startsWith('http')) ??
  (body && label
    ? `https://trek.nasa.gov/tiles/${body}/EQ/${label}/1.0.0/WMTSCapabilities.xml`
    : undefined);
if (!url) {
  console.error(
    'usage : read-wmts-capabilities.mjs <url> | --body <Corps> --label <Produit>'
  );
  process.exit(2);
}

const response = await fetch(url);
const text = await response.text();
// Un HTTP 200 ne prouve rien : ce dépôt a déjà payé une page d'erreur servie en 200 (NSSDCA) et
// une réécriture SPA qui rend index.html pour tout chemin inconnu (Firebase). On vérifie donc
// que c'est bien du WMTS, et on le DIT si ce n'en est pas.
if (!response.ok) throw new Error(`${url} : HTTP ${response.status}`);
if (!text.includes('<Capabilities') && !text.includes('WMTS_Capabilities'))
  throw new Error(
    `${url} : HTTP ${response.status} mais la réponse n'est pas des capabilities WMTS ` +
      `(${text.length} octets, commence par « ${text.slice(0, 60).trim()} »)`
  );

/** Les commentaires d'ABORD : c'est là qu'est le piège. */
const xml = text.replace(/<!--[\s\S]*?-->/g, '');

const first = (re) => re.exec(xml)?.[1]?.trim();
const layerId = first(/<Layer>[\s\S]*?<ows:Identifier>([^<]+)</);
const style = first(/<Style[^>]*>[\s\S]*?<ows:Identifier>([^<]+)</);
const format = first(/<Format>([^<]+)</);
const template = first(/<ResourceURL[^>]*template="([^"]+)"/);
const tileMatrixSet = first(/<TileMatrixSetLink>\s*<TileMatrixSet>([^<]+)</);

const matrices = [
  ...xml.matchAll(
    /<TileMatrix>\s*<ows:Identifier>([^<]+)<\/ows:Identifier>[\s\S]*?<TileWidth>([\d.]+)<\/TileWidth>\s*<TileHeight>([\d.]+)<\/TileHeight>\s*<MatrixWidth>([\d.]+)<\/MatrixWidth>\s*<MatrixHeight>([\d.]+)<\/MatrixHeight>/g
  ),
].map((m) => ({
  level: Number(m[1]),
  tileWidth: Number(m[2]),
  tileHeight: Number(m[3]),
  columns: Number(m[4]),
  rows: Number(m[5]),
}));

if (matrices.length === 0)
  throw new Error(`${url} : aucune TileMatrix active (commentaires retirés)`);
matrices.sort((a, b) => a.level - b.level);

// Ce que la fiche suppose, VÉRIFIÉ ici plutôt que supposé là-bas : des tuiles de taille
// constante, des niveaux consécutifs, et un doublement à chaque niveau. Une pyramide qui ne
// double pas casserait `core/tilePyramid.ts` en silence.
const tileSizes = new Set(matrices.flatMap((m) => [m.tileWidth, m.tileHeight]));
if (tileSizes.size !== 1)
  throw new Error(`tailles de tuile mêlées : ${[...tileSizes].join(', ')}`);
for (const [i, m] of matrices.entries()) {
  if (m.level !== matrices[0].level + i)
    throw new Error(`niveaux non consécutifs à ${m.level}`);
  if (i === 0) continue;
  const previous = matrices[i - 1];
  if (m.columns !== previous.columns * 2 || m.rows !== previous.rows * 2)
    throw new Error(
      `le niveau ${m.level} ne double pas le précédent ` +
        `(${previous.columns}x${previous.rows} puis ${m.columns}x${m.rows})`
    );
}

const zero = matrices[0];
const top = matrices[matrices.length - 1];
// La fiche exprime la matrice au niveau ZÉRO ; si les capabilities commencent plus haut, on la
// ramène en divisant, ce qui n'est licite que parce que le doublement vient d'être vérifié.
const factor = 2 ** zero.level;
if (zero.columns % factor !== 0 || zero.rows % factor !== 0)
  throw new Error(
    `le niveau ${zero.level} (${zero.columns}x${zero.rows}) ne se ramène pas au niveau zéro`
  );

console.log(`\n${url}`);
console.log(`couche      : ${layerId}`);
console.log(
  `niveaux     : ${zero.level} à ${top.level} (${matrices.length} matrices actives)`
);
console.log(`tuile       : ${[...tileSizes][0]} px`);
console.log(
  `niveau zéro : ${zero.columns / factor} x ${zero.rows / factor} tuiles`
);
console.log('\nbloc « service » de la fiche :\n');
console.log(
  JSON.stringify(
    {
      template,
      style,
      tileMatrixSet,
      format,
      matrix: {
        columnsAtLevelZero: zero.columns / factor,
        rowsAtLevelZero: zero.rows / factor,
        tileSizePx: [...tileSizes][0],
      },
      maxLevel: top.level,
    },
    null,
    2
  )
);
