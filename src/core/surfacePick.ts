/**
 * Un RAYON (clic, toucher) → le point GÉOGRAPHIQUE de la surface qu'il touche (GAL-METEO-INSPECT-003).
 *
 * Aucun second système de raycasting : le rayon vient de la caméra comme pour le picker de corps,
 * et la conversion en latitude / longitude passe par les deux méthodes que `CelestialObject`
 * possède déjà (`surfacePointToWorld` et sa réciproque `worldPointToGeographic`), c'est-à-dire par
 * la chaîne EXACTE qui oriente la surface : translation du corps, vrai pôle IAU, phase de rotation
 * recalée sur la date à chaque image. Reconstruire cette orientation ici donnerait une longitude
 * indépendante de celle qui est RENDUE : le point choisi tomberait à côté des continents sans que
 * rien ne se voie sur une capture isolée.
 *
 * Le rayon est coupé avec l'ELLIPSOÏDE de la surface, pas avec les meshes : les couches (nuages,
 * atmosphère) ont un rayon supérieur, et un mesh de nuages touché décalerait le point par parallaxe.
 * Les demi-axes se lisent par `surfacePointToWorld` (équateur à 0° et 90°, pôle), donc
 * l'aplatissement du corps est pris en compte exactement, sans itération.
 */
import * as THREE from 'three';

/** Ce que l'inspection demande à un corps : la moitié de l'API de `CelestialObject`. */
export interface SurfaceBody {
  surfacePointToWorld(
    latitudeDeg: number,
    longitudeDeg: number,
    out?: THREE.Vector3
  ): THREE.Vector3;
  worldPointToGeographic(worldPoint: THREE.Vector3): {
    latitudeDeg: number;
    longitudeDeg: number;
  };
}

export interface GeographicPoint {
  latitudeDeg: number;
  longitudeDeg: number;
}

/**
 * Premier point où le rayon entre dans la sphère, ou `null` (rayon qui la manque, ou sphère
 * derrière l'origine). Fonction pure : seuls des nombres entrent et sortent.
 */
export function raySphereHit(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  center: THREE.Vector3,
  radius: number
): THREE.Vector3 | null {
  const oc = origin.clone().sub(center);
  const b = oc.dot(direction);
  const c = oc.lengthSq() - radius * radius;
  const discriminant = b * b - c;
  if (discriminant < 0) return null;
  const distance = -b - Math.sqrt(discriminant);
  if (distance < 0) return null;
  return origin.clone().addScaledVector(direction, distance);
}

/** Centre monde du corps : le milieu des deux pôles (l'ellipsoïde est symétrique). */
export function bodyCenter(body: SurfaceBody): THREE.Vector3 {
  const north = body.surfacePointToWorld(90, 0);
  const south = body.surfacePointToWorld(-90, 0);
  return north.add(south).multiplyScalar(0.5);
}

/**
 * Premier point où le rayon entre dans l'ELLIPSOÏDE du corps (demi-axes portés par les trois
 * rayons mesurés : équateur à 0° et à 90° de longitude, pôle nord), ou `null`. Exact, en une
 * résolution : on passe dans le repère des axes où l'ellipsoïde devient la sphère unité, on coupe
 * cette sphère, et le paramètre du rayon est le même dans les deux repères.
 */
export function rayEllipsoidHit(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  center: THREE.Vector3,
  axisX: THREE.Vector3,
  axisY: THREE.Vector3,
  axisZ: THREE.Vector3
): THREE.Vector3 | null {
  const axes = [axisX, axisY, axisZ];
  const lengths = axes.map((axis) => axis.length());
  if (lengths.some((length) => !(length > 0))) return null;
  const oc = origin.clone().sub(center);
  const o = axes.map((axis, k) => oc.dot(axis) / (lengths[k]! * lengths[k]!));
  const d = axes.map(
    (axis, k) => direction.dot(axis) / (lengths[k]! * lengths[k]!)
  );
  const a = d[0]! ** 2 + d[1]! ** 2 + d[2]! ** 2;
  const b = o[0]! * d[0]! + o[1]! * d[1]! + o[2]! * d[2]!;
  const c = o[0]! ** 2 + o[1]! ** 2 + o[2]! ** 2 - 1;
  const discriminant = b * b - a * c;
  if (!(a > 0) || discriminant < 0) return null;
  const distance = (-b - Math.sqrt(discriminant)) / a;
  if (distance < 0) return null;
  return origin.clone().addScaledVector(direction, distance);
}

/**
 * Latitude / longitude du point de la surface visé par un rayon, ou `null` s'il manque
 * l'ellipsoïde (un rayon qui frôle la sphère équatoriale sans toucher la surface aplatie ne
 * choisit rien). `direction` doit être unitaire.
 */
export function pickGeographic(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  body: SurfaceBody
): GeographicPoint | null {
  const north = body.surfacePointToWorld(90, 0);
  const south = body.surfacePointToWorld(-90, 0);
  const center = north.clone().add(south).multiplyScalar(0.5);
  const hit = rayEllipsoidHit(
    origin,
    direction,
    center,
    body.surfacePointToWorld(0, 0).sub(center),
    body.surfacePointToWorld(0, 90).sub(center),
    north.sub(center)
  );
  return hit ? body.worldPointToGeographic(hit) : null;
}

/**
 * Le point de la surface est-il du côté VISIBLE du corps, vu de la caméra ? Un point sur la face
 * cachée ne doit ni se peindre ni se laisser lire par-dessus le disque : on teste le signe du
 * produit scalaire entre la normale (centre → point) et la direction point → caméra, sur la sphère
 * (l'aplatissement de la Terre ne change jamais ce signe de façon mesurable).
 */
export function isFacingCamera(
  point: THREE.Vector3,
  center: THREE.Vector3,
  camera: THREE.Vector3
): boolean {
  const normal = point.clone().sub(center);
  const toCamera = camera.clone().sub(point);
  return normal.dot(toCamera) > 0;
}
