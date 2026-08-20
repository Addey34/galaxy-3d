/**
 * Constantes mathématiques partagées — source unique pour les conversions d'angle.
 *
 * Ces facteurs étaient auparavant redéfinis localement dans une dizaine de fichiers
 * (`D2R`, `DEG2RAD`, `RAD2DEG`, `DEG`, `HOURS_TO_RADIANS`). Les centraliser évite les
 * divergences et clarifie l'intention. Module pur, sans état ni dépendance.
 */

/** Degrés → radians (× π/180). */
export const DEG_TO_RAD = Math.PI / 180;

/** Radians → degrés (× 180/π). */
export const RAD_TO_DEG = 180 / Math.PI;

/**
 * Heures d'ascension droite → radians (× π/12) : 24 h = 2π. Utilisé pour convertir
 * une longitude/ascension exprimée en heures horaires en angle.
 */
export const HOURS_TO_RAD = Math.PI / 12;
