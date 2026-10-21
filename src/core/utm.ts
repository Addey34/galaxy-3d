/**
 * PROJECTION UTM INVERSE (ETRS89 / UTM, lot 63, étape C.7) — module pur, testé, sans réseau.
 *
 * Les modèles de villes allemands (Berlin LoD2) sont servis en mètres UTM (EPSG:25833, zone 33
 * nord), alors que les tuiles de bâtiments rangent des longitudes et latitudes. Série de Krüger
 * (Karney 2011), ellipsoïde GRS80 : l'ETRS89 et le WGS84 diffèrent de quelques centimètres en
 * Europe, très en dessous de la précision d'un cadastre (voir la mesure dans le journal du lot).
 *
 * Seule la projection INVERSE vit ici : c'est la seule dont le cuiseur ait besoin. La directe est
 * écrite dans le test, indépendamment, pour que l'aller-retour prouve quelque chose.
 */

const A = 6378137;
const F = 1 / 298.257222101;
const K0 = 0.9996;
const FALSE_EASTING = 500000;

const N = F / (2 - F);
const N2 = N * N;
const N3 = N2 * N;
const N4 = N3 * N;
/** Rayon rectifiant de l'ellipsoïde. */
const RECTIFYING = (A / (1 + N)) * (1 + N2 / 4 + N4 / 64);

const BETA = [
  N / 2 - (2 * N2) / 3 + (37 * N3) / 96 - N4 / 360,
  N2 / 48 + N3 / 15 - (437 * N4) / 1440,
  (17 * N3) / 480 - (37 * N4) / 840,
  (4397 * N4) / 161280,
];
const DELTA = [
  2 * N - (2 * N2) / 3 - 2 * N3,
  (7 * N2) / 3 - (8 * N3) / 5,
  (56 * N3) / 15,
];

/** Méridien central d'une zone UTM, en degrés. */
export function utmCentralMeridian(zone: number): number {
  return zone * 6 - 183;
}

/**
 * Mètres UTM (hémisphère nord) vers `[longitude, latitude]` en degrés. `easting` porte la fausse
 * origine de 500 km, `northing` part de l'équateur.
 */
export function utmToLonLat(
  zone: number,
  easting: number,
  northing: number
): [number, number] {
  const xi = northing / (K0 * RECTIFYING);
  const eta = (easting - FALSE_EASTING) / (K0 * RECTIFYING);
  let xiPrime = xi;
  let etaPrime = eta;
  for (let j = 1; j <= BETA.length; j++) {
    xiPrime -= BETA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    etaPrime -= BETA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xiPrime) / Math.cosh(etaPrime));
  let phi = chi;
  for (let j = 1; j <= DELTA.length; j++)
    phi += DELTA[j - 1] * Math.sin(2 * j * chi);
  const lambda = Math.atan2(Math.sinh(etaPrime), Math.cos(xiPrime));
  return [
    utmCentralMeridian(zone) + (lambda * 180) / Math.PI,
    (phi * 180) / Math.PI,
  ];
}
