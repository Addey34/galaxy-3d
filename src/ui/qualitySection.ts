/**
 * Section « Qualité graphique » — vit dans la surface Réglages (fusionnée depuis l'ancien
 * popover dédié #quality-btn/#quality-menu : c'était le seul autre réglage « général » de
 * l'app, avec un style de popover différent du reste — le fusionner ici retire un point
 * d'entrée du dock et unifie le style pour tous les réglages généraux au même endroit.
 *
 * Perf adaptative manuelle : l'utilisateur force un palier (Auto/Bas/Moyen/Élevé) selon la
 * puissance de sa machine. Applique les leviers À CHAUD via `SceneSystem.applyQualityLive()`
 * (pixel ratio) et signale honnêtement quand un levier FIGÉ (antialiasing, anisotropie,
 * densité géométrie) ne prendra effet qu'au prochain chargement.
 */
import { BOOT_QUALITY_TIER, isMobile } from '@/config/engine';
import {
  readQualityMode,
  resolveQualityTier,
  writeQualityMode,
  type QualityMode,
} from '@/core/qualityTier';
import type { SceneSystem } from '@/components/systems/SceneSystem';
import { onLocaleChange, t } from '@/i18n';

const MODES: readonly QualityMode[] = ['auto', 'low', 'medium', 'high'];

export function setupQualitySection(scene: SceneSystem): void {
  const group = document.createElement('fieldset');
  group.id = 'quality-group';
  group.className = 'quality-group';

  const legend = document.createElement('legend');
  legend.className = 'quality-group-title';
  group.append(legend);

  const radios: HTMLInputElement[] = [];
  const names: HTMLSpanElement[] = [];
  const hints: HTMLSpanElement[] = [];

  for (const mode of MODES) {
    const optLabel = document.createElement('label');
    optLabel.className = 'quality-opt';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'quality-mode';
    radio.className = 'quality-radio';
    radio.value = mode;

    const text = document.createElement('span');
    text.className = 'quality-opt-text';
    const name = document.createElement('span');
    name.className = 'quality-opt-name';
    const hint = document.createElement('span');
    hint.className = 'quality-opt-hint';
    text.append(name, hint);

    optLabel.append(radio, text);
    group.append(optLabel);
    radios.push(radio);
    names.push(name);
    hints.push(hint);
  }

  const note = document.createElement('p');
  note.className = 'quality-menu-note';
  note.id = 'quality-reload-note';
  note.hidden = true;
  group.append(note);

  const host =
    document.querySelector('#orbit-options .surface-body') ?? document.body;
  host.append(group);

  const currentMode = (): QualityMode => readQualityMode();

  // Marque l'option active et met à jour la note « rechargement » : un palier dont les
  // leviers FIGÉS diffèrent de ceux réellement rendus au boot nécessite un reload.
  const syncActive = (): void => {
    const mode = currentMode();
    radios.forEach((radio) => {
      radio.checked = radio.value === mode;
    });
    const effectiveTier = resolveQualityTier(mode, isMobile());
    note.hidden = effectiveTier === BOOT_QUALITY_TIER;
  };

  const refresh = (): void => {
    legend.textContent = t('quality.heading');
    MODES.forEach((mode, i) => {
      names[i].textContent = t(`quality.${mode}`);
      hints[i].textContent = t(`quality.${mode}.hint`);
    });
    note.textContent = t('quality.reloadNote');
    syncActive();
  };

  radios.forEach((radio, i) => {
    radio.addEventListener('change', () => {
      writeQualityMode(MODES[i]);
      // Levier à chaud : le pixel ratio se ré-applique immédiatement (fluidité instantanée).
      scene.applyQualityLive();
      syncActive();
    });
  });

  refresh();
  onLocaleChange(refresh);
}
