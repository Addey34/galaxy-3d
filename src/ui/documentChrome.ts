/**
 * CE QUE LA PAGE DIT D'ELLE-MÊME À QUI NE LA VOIT PAS (lot 19).
 *
 * Deux défauts mesurés par la passe lecteur d'écran, tous deux invisibles à l'écran et tous
 * deux relevés dans `docs/private/LECTEUR_ECRAN_LOT19.md` :
 *
 * - **D2** : le seul titre de niveau 1 de la page est écrit en anglais, en dur, dans
 *   `index.html`. Il y RESTE, parce que c'est l'ancre que `src/seo/bodyLandingPage.ts`
 *   remplace et le texte que lisent les robots ; mais avec `<html lang="fr">`, NVDA annonçait
 *   « titre · niveau 1 » suivi d'une phrase anglaise, lue par une voix française. On le
 *   localise donc au démarrage, exactement comme `ui/documentTitle` le fait pour l'onglet, et
 *   `src/seo/headingParity.test.ts` tient les deux textes anglais identiques.
 *
 * - **D3** : la page entière n'exposait QU'UN repère (« Contrôles temporels »). Ni `main`, ni
 *   rien pour la scène. La navigation par repères, premier réflexe sur une page inconnue, ne
 *   menait nulle part. La toile 3D EST le contenu principal : elle reçoit donc `role="main"` et
 *   un nom. Les deux docks reçoivent leur rôle de barre d'outils directement dans `index.html`.
 *
 * Pourquoi la toile plutôt qu'un `<main>` qui l'envelopperait : `SceneSystem` attache la toile
 * au `<body>` lui-même, et la déplacer dans un conteneur toucherait à la mise en page d'un
 * élément plein écran pour un gain nul. Le rôle se pose sur l'élément qui porte déjà le
 * contenu.
 */
import { onLocaleChange, t } from '@/i18n';

export interface DocumentChrome {
  dispose(): void;
}

export function setupDocumentChrome(): DocumentChrome {
  const heading = document.querySelector<HTMLHeadingElement>('h1.sr-only');
  // La toile existe : `SolarSystemApp.init()` construit la scène avant que la composition
  // n'appelle les modules d'interface.
  const canvas = document.querySelector<HTMLCanvasElement>('canvas');

  const apply = (): void => {
    if (heading) heading.textContent = t('a11y.pageHeading');
    if (canvas) {
      canvas.setAttribute('role', 'main');
      canvas.setAttribute('aria-label', t('a11y.scene'));
    }
  };

  apply();
  const off = onLocaleChange(apply);
  return { dispose: off };
}
