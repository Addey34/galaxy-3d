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
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];
