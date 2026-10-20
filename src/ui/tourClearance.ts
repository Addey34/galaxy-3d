/**
 * CE QUE LA CARTE D'UNE VISITE OCCUPE EN BAS DE L'ÉCRAN (2026-10-20).
 *
 * La carte de la visite est posée en bas, au-dessus de tout dans la pile, et cachait le bandeau de
 * provenance de l'imagerie, donc ses lignes de crédit, à 390 px. Elle PUBLIE la hauteur qu'elle
 * occupe (`--stour-clear`, en pixels depuis le bas de la fenêtre) et prévient d'un événement ; le
 * bandeau, qui se place déjà par mesure (`surfacePanel.placeBadge`), s'empile au-dessus. Même
 * patron que `ephemerisNotice.NOTICE_CHANGED` : aucun des deux modules n'importe l'autre.
 */
export const TOUR_CLEARANCE_CHANGED = 'galaxy:tour-clearance';

/** Pixels que la carte occupe depuis le bas de la fenêtre ; 0 hors visite. */
export function tourClearancePx(): number {
  const value =
    document.documentElement.style.getPropertyValue('--stour-clear');
  const px = Number.parseFloat(value);
  return Number.isFinite(px) ? px : 0;
}
