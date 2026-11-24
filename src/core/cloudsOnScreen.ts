/**
 * LES NUAGES RÉELS SONT-ILS À L'ÉCRAN ? (GAL-EARTH-CLOUD-IMMERSION-001, 2026-11-24)
 *
 * Posé par la couche « Nuages (NASA) » (`ui/realtimeClouds`) quand elle a posé une image observée et
 * qu'elle est visible, lu par le panneau de surface pour décider jusqu'où garder le fond du jour
 * (`core/farBase.ts`). Un objet partagé plutôt qu'un import entre deux modules d'interface : le panneau
 * de surface et la couche ne se connaissent pas.
 */
export const cloudsOnScreen = { value: false };
