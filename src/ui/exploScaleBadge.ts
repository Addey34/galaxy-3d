/**
 * Badge d'échelle permanent — visible en Exploration tant qu'aucune cible n'est suivie.
 *
 * Une fois un corps sélectionné, la fiche affiche déjà sa vraie distance et son temps-lumière
 * (`bodyInfo.ts`, bloc `.bi-live`) : ce badge ne duplique pas ce rôle, il comble le trou d'AVANT
 * la sélection — la vue d'ensemble Explo n'est sinon que des points dans le vide, sans rien pour
 * dire pourquoi c'est déjà impressionnant. Fait tourner quelques repères de temps-lumière réels
 * (valeurs moyennes bien connues, arrondies : pas une mesure live comme le reste de l'app, mais
 * un repère pédagogique fixe) pour ancrer concrètement ce que « vraie échelle » veut dire.
 */
import { onLocaleChange, t } from '@/i18n';

const FACT_KEYS = [
  'exploScale.fact.earth',
  'exploScale.fact.jupiter',
  'exploScale.fact.neptune',
  'exploScale.fact.voyager',
];

const ROTATE_MS = 6000;

export interface ExploScaleBadge {
  setMode(mode: 'educ' | 'explo'): void;
  setHasTarget(hasTarget: boolean): void;
}

export function setupExploScaleBadge(): ExploScaleBadge {
  const badge = document.createElement('div');
  badge.id = 'explo-scale-badge';
  badge.className = 'explo-scale-badge';
  // Décoratif et déjà lisible visuellement en continu : pas d'annonce lecteur d'écran à
  // chaque rotation (une live-region ici serait plus gênante qu'utile).
  badge.setAttribute('aria-hidden', 'true');
  document.body.append(badge);

  let index = 0;
  let mode: 'educ' | 'explo' = 'educ';
  let hasTarget = false;
  // `number`, pas `ReturnType<typeof window.setInterval>` : `@types/node` (tsconfig `types`)
  // fait résoudre ce ReturnType vers `NodeJS.Timeout` malgré le préfixe `window.`.
  let timer: number | null = null;

  const render = (): void => {
    badge.textContent = t(FACT_KEYS[index % FACT_KEYS.length]);
  };

  const updateVisibility = (): void => {
    const visible = mode === 'explo' && !hasTarget;
    badge.classList.toggle('is-visible', visible);
    if (visible && !timer) {
      render();
      timer = window.setInterval(() => {
        index++;
        render();
      }, ROTATE_MS);
    } else if (!visible && timer) {
      window.clearInterval(timer);
      timer = null;
    }
  };

  onLocaleChange(render);

  return {
    setMode(next: 'educ' | 'explo'): void {
      mode = next;
      updateVisibility();
    },
    setHasTarget(next: boolean): void {
      hasTarget = next;
      updateVisibility();
    },
  };
}
