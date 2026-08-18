/**
 * Sélecteur de QUALITÉ graphique (#quality-btn + #quality-menu). Perf adaptative manuelle :
 * l'utilisateur force un palier (Auto/Bas/Moyen/Élevé) selon la puissance de sa machine.
 *
 * Frontière DOM stricte (comme les autres modules ui/) : lit/écrit le choix via `core/
 * qualityTier` (pur), applique les leviers À CHAUD via `SceneSystem.applyQualityLive()`
 * (pixel ratio) et signale honnêtement quand un levier FIGÉ (antialiasing, anisotropie,
 * densité géométrie) ne prendra effet qu'au prochain chargement.
 */
import {
  BOOT_QUALITY_TIER,
  isMobile,
} from '@/config/engine';
import {
  readQualityMode,
  resolveQualityTier,
  writeQualityMode,
  type QualityMode,
} from '@/core/qualityTier';
import type { SceneSystem } from '@/components/systems/SceneSystem';
import { t } from '@/i18n';

export function setupQualitySwitch(scene: SceneSystem): () => void {
  const btn = document.getElementById('quality-btn');
  const menu = document.getElementById('quality-menu');
  const reloadNote = document.getElementById('quality-reload-note');
  if (!btn || !menu) return () => {};

  const options = Array.from(
    menu.querySelectorAll<HTMLButtonElement>('.quality-opt')
  );

  const currentMode = (): QualityMode => readQualityMode();

  // Marque l'option active (aria-checked) et met à jour la note « rechargement » : un palier
  // dont les leviers FIGÉS diffèrent de ceux réellement rendus au boot nécessite un reload.
  const syncMenu = (): void => {
    const mode = currentMode();
    for (const opt of options) {
      const checked = opt.dataset['quality'] === mode;
      opt.setAttribute('aria-checked', String(checked));
      opt.classList.toggle('is-active', checked);
    }
    const effectiveTier = resolveQualityTier(mode, isMobile());
    // Les leviers figés (antialiasing/anisotropie/densité) sont ceux du BOOT. S'ils diffèrent
    // du palier désormais choisi, on prévient que le rendu complet attend un rechargement.
    if (reloadNote) reloadNote.hidden = effectiveTier === BOOT_QUALITY_TIER;
  };

  const closeMenu = (): void => {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };
  const openMenu = (): void => {
    syncMenu();
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
  };

  const onBtnClick = (e: MouseEvent): void => {
    e.stopPropagation();
    if (menu.hidden) openMenu();
    else closeMenu();
  };

  const onOptClick = (opt: HTMLButtonElement) => (): void => {
    const mode = opt.dataset['quality'];
    if (mode !== 'auto' && mode !== 'low' && mode !== 'medium' && mode !== 'high')
      return;
    writeQualityMode(mode);
    // Levier à chaud : le pixel ratio se ré-applique immédiatement (fluidité instantanée).
    scene.applyQualityLive();
    syncMenu();
  };

  // Ferme au clic extérieur / Échap (menu léger, pas d'overlay bloquant).
  const onDocClick = (e: MouseEvent): void => {
    if (menu.hidden) return;
    if (e.target instanceof Node && (menu.contains(e.target) || btn.contains(e.target)))
      return;
    closeMenu();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && !menu.hidden) {
      closeMenu();
      btn.focus();
    }
  };

  btn.addEventListener('click', onBtnClick as EventListener);
  const optHandlers = options.map((opt) => {
    const h = onOptClick(opt);
    opt.addEventListener('click', h);
    return [opt, h] as const;
  });
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKey);

  // Titre du bouton = mode courant (info-bulle honnête).
  const refreshTitle = (): void => {
    const label = t(`quality.${currentMode()}`);
    btn.setAttribute('title', `${t('quality.title')} · ${label}`);
  };
  refreshTitle();
  syncMenu();

  return () => {
    btn.removeEventListener('click', onBtnClick as EventListener);
    for (const [opt, h] of optHandlers) opt.removeEventListener('click', h);
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onKey);
  };
}
