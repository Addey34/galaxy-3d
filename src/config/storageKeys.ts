/**
 * Clés `localStorage` de l'application — SOURCE UNIQUE.
 *
 * Regrouper les clés ici évite qu'un même nom soit codé en dur à plusieurs endroits
 * (risque de collision ou de divergence silencieuse) et documente d'un coup d'œil tout
 * ce que l'app persiste côté navigateur. Préfixe `ssv-` (Solar System Visualizer).
 *
 * NB : la page statique `public/privacy.js` réutilise la valeur `'ssv-locale'` mais ne
 * peut pas importer ce module (script hors bundle) — elle la code en dur avec un
 * commentaire renvoyant ici. Garder les deux synchronisés.
 */
export const STORAGE_KEYS = {
  /** Langue choisie (i18n). */
  locale: 'ssv-locale',
  /** Visite guidée déjà affichée au premier passage. */
  guidedTour: 'ssv-guided-tour-v1',
  /** Palier de qualité graphique sélectionné. */
  quality: 'ssv-quality',
  /** Nudge « essayer une visite guidée » déjà affiché au premier passage en Exploration. */
  exploTourNudge: 'ssv-explo-tour-nudge-v1',
  /** Exposition du tone mapping (réglage utilisateur). */
  exposure: 'ssv-exposure',
  /** Palette d'orbites daltonienne activée. */
  colorblind: 'ssv-colorblind',
  /** Système d'unités préféré (métrique/impérial). */
  units: 'ssv-units',
  /** Imagerie de surface streamée à l'approche (activée par défaut, opt-out). */
  surfaceImagery: 'ssv-surface-imagery',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/**
 * Clés que l'application N'ÉCRIT PLUS, effacées au démarrage chez les visiteurs qui les
 * portent encore : `public/privacy.html` ne liste que ce qui est enregistré, et une valeur
 * orpheline laissée dans le navigateur ferait mentir cette liste.
 *
 * `ssv-interstellar-paths` : la bascule des trajectoires interstellaires est devenue, le
 * 2026-09-22, la colonne « Orbite » du tableau Réglages, et le contenu de la scène ne se
 * conserve pas d'une visite à l'autre (seules les préférences de rendu et de lecture le sont).
 */
export const RETIRED_STORAGE_KEYS: readonly string[] = [
  'ssv-interstellar-paths',
];

/** Efface les clés retirées ; un stockage refusé (mode privé) n'a rien à effacer. */
export function clearRetiredStorage(): void {
  try {
    for (const key of RETIRED_STORAGE_KEYS) localStorage.removeItem(key);
  } catch {
    // Accès au stockage refusé : rien n'y a été écrit.
  }
}
