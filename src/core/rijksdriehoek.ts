/**
 * RIJKSDRIEHOEKSCOÖRDINATEN VERS WGS84 (EPSG:28992 vers longitude, latitude) : module pur, testé,
 * sans réseau. Les modèles 3DBAG (Pays-Bas) sont servis en mètres RD (stéréographique oblique sur
 * l'ellipsoïde de Bessel, origine à la tour d'Amersfoort), alors que les tuiles de bâtiments
 * rangent des longitudes et latitudes WGS84.
 *
 * Polynômes d'approximation du Kadaster (Schreiber), qui absorbent aussi le changement de datum
 * Bessel vers WGS84 : ils valent sur le territoire néerlandais (x de 0 à 300 000, y de 300 000 à
 * 620 000) et ne servent nulle part ailleurs. Leur précision est celle d'une approximation, pas
 * celle de la transformation complète RDNAPTRANS ; l'écart mesuré contre des empreintes
 * indépendantes est écrit dans le journal du lot, pas ici.
 */

/** Tour d'Amersfoort : l'origine du système, en RD et en WGS84 (la constante des polynômes). */
export const RD_ORIGIN = { x: 155000, y: 463000 } as const;
const PHI0 = 52.1551744;
const LAMBDA0 = 5.38720621;

export function rdToLonLat(x: number, y: number): [number, number] {
  const dx = (x - RD_ORIGIN.x) / 1e5;
  const dy = (y - RD_ORIGIN.y) / 1e5;
  const phiSeconds =
    3235.65389 * dy -
    32.58297 * dx ** 2 -
    0.2475 * dy ** 2 -
    0.84978 * dx ** 2 * dy -
    0.0655 * dy ** 3 -
    0.01709 * dx ** 2 * dy ** 2 -
    0.00738 * dx +
    0.0053 * dx ** 4 -
    0.00039 * dx ** 2 * dy ** 3 +
    0.00033 * dx ** 4 * dy -
    0.00012 * dx * dy;
  const lambdaSeconds =
    5260.52916 * dx +
    105.94684 * dx * dy +
    2.45656 * dx * dy ** 2 -
    0.81885 * dx ** 3 +
    0.05594 * dx * dy ** 3 -
    0.05607 * dx ** 3 * dy +
    0.01199 * dy -
    0.00256 * dx ** 3 * dy ** 2 +
    0.00128 * dx * dy ** 4 +
    0.00022 * dy ** 2 -
    0.00022 * dx ** 2 +
    0.00026 * dx ** 5;
  return [LAMBDA0 + lambdaSeconds / 3600, PHI0 + phiSeconds / 3600];
}
