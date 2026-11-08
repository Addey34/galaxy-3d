/**
 * DÉCOMPOSITION DE `data-surface-busy` (diagnostic, `?debug-surface` seulement).
 *
 * `PlanetarySurfaceEngine.busyCount` additionne trois choses de natures différentes : des
 * téléchargements en vol, une file d'attente, et des carreaux « en fondu » (`SurfaceTile.fading`,
 * qui INCLUT les carreaux retenus en attendant la révélation du groupe, `core/tileReveal.ts`).
 * Savoir lequel domine dit où passe le temps d'une attente du calme. Le total n'est pas modifié :
 * cette décomposition est lue au même instant que lui, et son total (`busy`) permet de vérifier
 * que la somme des parties le retrouve.
 *
 * Format texte compact, écrit dans `window.__surfaceBusy` : `b22p3q2h17f0m5a12`.
 */

export interface BusyDetail {
  /** Total publié (`busyCount`). */
  busy: number;
  /** Téléchargements en vol. */
  pending: number;
  /** Carreaux en file, pas encore demandés. */
  queued: number;
  /** Carreaux posés mais retenus, en attente de la révélation du groupe. */
  held: number;
  /** Carreaux en fondu ACTIF (hors retenus). */
  fading: number;
  /** Carreaux voulus pas encore posés. */
  missing: number;
  /** Âge du plus ancien carreau retenu, en secondes (0 sans carreau retenu). */
  heldAgeS: number;
}

const FORMAT = /^b(-?\d+)p(\d+)q(\d+)h(\d+)f(-?\d+)m(\d+)a(\d+)$/;

export function formatBusyDetail(d: BusyDetail): string {
  return `b${d.busy}p${d.pending}q${d.queued}h${d.held}f${d.fading}m${d.missing}a${d.heldAgeS}`;
}

/** Relit le texte écrit par `formatBusyDetail` ; `null` si le format est inconnu. */
export function parseBusyDetail(text: string): BusyDetail | null {
  const m = FORMAT.exec(text);
  if (!m) return null;
  return {
    busy: Number(m[1]),
    pending: Number(m[2]),
    queued: Number(m[3]),
    held: Number(m[4]),
    fading: Number(m[5]),
    missing: Number(m[6]),
    heldAgeS: Number(m[7]),
  };
}

/** Les parties retrouvent-elles le total ? Faux si un compteur est périmé ou négatif. */
export function isBusyDetailConsistent(d: BusyDetail): boolean {
  return d.fading >= 0 && d.pending + d.queued + d.held + d.fading === d.busy;
}
