/**
 * Le MÉRIDIEN ORIGINE d'un corps, à une date, depuis le modèle de rotation IAU (WGCCRE).
 *
 * Le modèle publie, pour un corps, l'ascension droite α0 et la déclinaison δ0 de son pôle nord
 * et l'angle de méridien W (qui croît avec le temps pour une rotation directe). Il définit le
 * repère fixe du corps : l'axe x est le méridien origine, situé à l'angle W, compté vers l'Est,
 * du NŒUD ASCENDANT de l'équateur du corps sur l'équateur ICRF, qui est à l'ascension droite
 * α0 + 90°. C'est la même définition que `Rz(W) · Rx(90° - δ0) · Rz(90° + α0)` appliquée aux
 * vecteurs équatoriaux, mais exprimée en une direction : pas de matrice à composer ni à inverser.
 *
 * Sert à une seule chose : poser la rotation propre d'un corps à partir de la DATE (cf.
 * `OrbitalMechanics.syncDatedSurfaceRotations`), comme la Terre l'est depuis toujours par le
 * temps sidéral. Un corps qui n'intègre que `rotationSpeed · Δt` tourne au bon rythme mais d'une
 * phase arbitraire, héritée de l'instant du chargement : la longitude de ses lieux (et celle de
 * la face tournée vers la Terre) ne vaut alors rien (mesuré sur la Lune et Mars, GAL-IMMERSION-001).
 */
export type Vec3 = { x: number; y: number; z: number };

const DEG = Math.PI / 180;

/**
 * Direction du méridien origine (longitude 0, latitude 0) en coordonnées ÉQUATORIALES J2000,
 * vecteur unité. Valable pour un corps qui tourne en main droite autour de son pôle nord IAU
 * (W croissant) ; pour un corps en main gauche l'appelant ne l'emploie pas.
 */
export function primeMeridianEquatorial(
  poleRightAscensionDeg: number,
  poleDeclinationDeg: number,
  primeMeridianAngleDeg: number
): Vec3 {
  const alpha = poleRightAscensionDeg * DEG;
  const delta = poleDeclinationDeg * DEG;
  const w = primeMeridianAngleDeg * DEG;

  // Pôle nord et nœud ascendant (Q), tous deux dans l'équatorial J2000.
  const north: Vec3 = {
    x: Math.cos(delta) * Math.cos(alpha),
    y: Math.cos(delta) * Math.sin(alpha),
    z: Math.sin(delta),
  };
  const node: Vec3 = { x: -Math.sin(alpha), y: Math.cos(alpha), z: 0 };
  // Troisième axe d'un trièdre direct : pôle × nœud, dans l'équateur du corps, à 90° vers l'Est.
  const east: Vec3 = {
    x: north.y * node.z - north.z * node.y,
    y: north.z * node.x - north.x * node.z,
    z: north.x * node.y - north.y * node.x,
  };
  const c = Math.cos(w);
  const s = Math.sin(w);
  return {
    x: node.x * c + east.x * s,
    y: node.y * c + east.y * s,
    z: node.z * c + east.z * s,
  };
}
