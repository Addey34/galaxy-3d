/**
 * UN MARQUEUR DERRIÈRE UN CORPS NE SE PEINT PAS PAR-DESSUS (ligne 45.8, 2026-10-09).
 *
 * Module PUR. Les couches instrument (petits corps, sondes, objets interstellaires, marqueurs et
 * étiquettes de l'Explo) dessinent en 2D, sur un canevas posé au-dessus du rendu WebGL : rien ne
 * les masquait quand leur objet passait derrière une planète. Mesuré à 1 000 km d'altitude
 * au-dessus de Mars, qui remplit l'écran : 1 064 pixels de marqueurs d'astéroïdes peints sur son
 * sol, pris d'abord pour des étoiles. Le champ d'étoiles, lui, n'y était pour rien (0 pixel, même
 * mesure, étoiles retirées).
 *
 * La question posée est géométrique : le segment caméra → point traverse-t-il la sphère d'un
 * corps AVANT d'atteindre le point ? On teste une sphère INSCRITE (le plus petit demi-axe du
 * globe rendu) : un marqueur réellement visible au ras du limbe n'est jamais caché à tort ; seule
 * une bande de l'aplatissement d'une géante peut laisser passer un marqueur qu'elle devrait
 * cacher, ce qui est le moindre des deux défauts.
 */

/** Un corps capable de masquer : son centre et son rayon, dans le repère du monde. */
export interface SceneOccluder {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Rayon de la sphère inscrite au globe rendu, en unités de scène. */
  readonly radius: number;
}

/**
 * Le segment `from` → `to` traverse-t-il la sphère (`cx`, `cy`, `cz`, `r`) avant d'atteindre
 * `to` ? Un `to` situé DANS la sphère compte comme caché : il est sous la surface.
 */
export function segmentBlockedBySphere(
  fx: number,
  fy: number,
  fz: number,
  tx: number,
  ty: number,
  tz: number,
  cx: number,
  cy: number,
  cz: number,
  r: number
): boolean {
  const dx = tx - fx;
  const dy = ty - fy;
  const dz = tz - fz;
  const length2 = dx * dx + dy * dy + dz * dz;
  if (!(length2 > 0) || !(r > 0)) return false;
  // Paramètre du point du segment le plus proche du centre, borné à [0, 1].
  const t = Math.min(
    1,
    Math.max(0, ((cx - fx) * dx + (cy - fy) * dy + (cz - fz) * dz) / length2)
  );
  const px = fx + t * dx - cx;
  const py = fy + t * dy - cy;
  const pz = fz + t * dz - cz;
  return px * px + py * py + pz * pz < r * r;
}

/**
 * Les occulteurs d'UNE image, réduits à ceux qui peuvent masquer quelque chose : un corps dont le
 * rayon apparent est sous `minAngularRadius` (radians) couvre moins d'un pixel et ne cache rien.
 * En pratique il en reste un ou deux, et le test par marqueur devient négligeable (8 000 petits
 * corps).
 */
export class ScreenOcclusion {
  private _camX = 0;
  private _camY = 0;
  private _camZ = 0;
  private readonly _active: SceneOccluder[] = [];

  /** Recompose l'ensemble pour cette image. */
  set(
    camera: { x: number; y: number; z: number },
    occluders: Iterable<SceneOccluder>,
    minAngularRadius = 1e-3
  ): void {
    this._camX = camera.x;
    this._camY = camera.y;
    this._camZ = camera.z;
    this._active.length = 0;
    for (const o of occluders) {
      const distance = Math.hypot(
        o.x - camera.x,
        o.y - camera.y,
        o.z - camera.z
      );
      if (!(o.radius > 0)) continue;
      // La caméra DANS un corps (approche ratée) : il ne masque rien, sinon tout disparaîtrait.
      if (distance <= o.radius) continue;
      if (o.radius / distance >= minAngularRadius) this._active.push(o);
    }
  }

  /** Nombre d'occulteurs retenus pour cette image (lu par les tests). */
  get size(): number {
    return this._active.length;
  }

  /**
   * Le point (`x`, `y`, `z`) est-il caché par un corps ? `except` nomme le corps dont le point
   * EST le centre ou un repère propre (l'étiquette de Mars ne se cache pas derrière Mars).
   */
  hides(x: number, y: number, z: number, except?: string | null): boolean {
    for (const o of this._active) {
      if (o.name === except) continue;
      if (
        segmentBlockedBySphere(
          this._camX,
          this._camY,
          this._camZ,
          x,
          y,
          z,
          o.x,
          o.y,
          o.z,
          o.radius
        )
      )
        return true;
    }
    return false;
  }
}
