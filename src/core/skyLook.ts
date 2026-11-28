/**
 * REGARDER LE CIEL DEPUIS LA SURFACE (GAL-EARTH-ATMOSPHERE-003, finalisation produit, 2026-11-28).
 *
 * Près du sol, la caméra relève déjà la visée vers l'horizon (`core/horizonTilt.ts`) : le sixième supérieur du
 * cadre est du ciel. Pour observer le plafond nuageux, le visiteur relève la visée DE PLUS, sans changer la
 * position de la caméra (`CameraSystem.skyTiltRad`, ajouté au relèvement d'horizon). Rien ici n'est propre à la
 * Terre : la règle vaut pour tout corps approché en Exploration.
 *
 * La commande n'apparaît que lorsque le cadrage d'horizon est FORT, c'est-à-dire près du sol : au-delà de
 * {@link SKY_LOOK_SHOW_RAD} de relèvement (57°), soit sous ~207 km d'altitude sur la Terre et ~56 km sur la Lune
 * pour un champ de 55°. Un seuil plus bas pour la retirer évite qu'elle clignote sur le bord. La retirer remet la
 * visée à l'horizon : remonter vers l'orbite, changer de corps ou passer en Éducatif rend le cadrage initial.
 */

/** Relèvement maximal offert par la commande, en degrés (le centre de l'image ~72° au-dessus de l'horizon). */
export const SKY_LOOK_MAX_DEG = 90;

/** Relèvement d'horizon (radians) au-delà duquel la commande apparaît : près du sol. */
export const SKY_LOOK_SHOW_RAD = 1.0;

/** En dessous, elle se retire (hystérésis : pas de clignotement sur le seuil). */
export const SKY_LOOK_HIDE_RAD = 0.95;

/**
 * La commande doit-elle être montrée, sachant si elle l'était ? `horizonTiltRad` est le relèvement d'horizon de
 * la dernière image (`CameraSystem.horizonTiltNow`), nul en Éducatif et sans corps suivi.
 */
export function skyLookShown(
  wasShown: boolean,
  horizonTiltRad: number
): boolean {
  if (!Number.isFinite(horizonTiltRad)) return false;
  return horizonTiltRad >= (wasShown ? SKY_LOOK_HIDE_RAD : SKY_LOOK_SHOW_RAD);
}

/** Degrés choisis → relèvement de visée en radians, borné à [0, {@link SKY_LOOK_MAX_DEG}]. */
export function skyTiltFromDeg(deg: number): number {
  const d = Number.isFinite(deg)
    ? Math.min(SKY_LOOK_MAX_DEG, Math.max(0, deg))
    : 0;
  return (d * Math.PI) / 180;
}
