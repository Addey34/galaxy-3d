/**
 * Bouton « Capturer cette vue » (#capture-btn) — mode planétarium.
 *
 * Masque tout le chrome UI, fige la frame WebGL courante dans une image, y incruste un
 * cartouche (corps, date, distance) et déclenche un téléchargement PNG — pensé pour le partage
 * social organique. Miroir de `share.ts` (action en un clic → toast), mais avec un `try/finally`
 * car cette fonctionnalité mute temporairement l'état visuel de l'app (contrairement à `share.ts`,
 * sans effet de bord en cas d'échec).
 */
import { t, intlLocale } from '@/i18n';
import { bodyDisplayName } from '@/i18n/bodyText';
import type { CameraSystem } from '@/components/systems/CameraSystem';
import type { OrbitalMechanics } from '@/core/OrbitalMechanics';
import type { PlanetNavigation } from './planetNav';
import { formatLiveDistance, sceneUnitsToKm } from './bodyInfo';

/** Toast éphémère, même motif visuel que `share.ts` (réutilise sa classe CSS `.share-toast`). */
function showToast(message: string): void {
  const existing = document.getElementById('capture-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'capture-toast';
  toast.className = 'share-toast';
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  document.body.appendChild(toast);

  void toast.offsetWidth; // force un reflow avant la transition d'entrée
  toast.classList.add('is-visible');

  window.setTimeout(() => {
    toast.classList.remove('is-visible');
    window.setTimeout(() => toast.remove(), 250);
  }, 2200);
}

/**
 * Titre + sous-titre du cartouche — fonction pure (aucun accès DOM/i18n) : `bodyLabel` et la
 * distance déjà résolus/formatés sont fournis par l'appelant, pour rester testable isolément.
 */
export function buildCartoucheText(
  bodyLabel: string,
  date: Date,
  distanceKm: number | null
): { title: string; subtitle: string } {
  const dateStr = date.toLocaleDateString(intlLocale(), { dateStyle: 'long' });
  const subtitle =
    distanceKm !== null
      ? `${dateStr} · ${formatLiveDistance(distanceKm)}`
      : dateStr;
  return { title: bodyLabel, subtitle };
}

const SITE_NAME = '3D Solar System';

function drawCartouche(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  title: string,
  subtitle: string
): void {
  const scale = w / 1600; // proportionnel à la résolution d'export, pas un nombre de px fixe
  const pad = 18 * scale;
  const titleSize = Math.max(14, 22 * scale);
  const subtitleSize = Math.max(11, 15 * scale);
  const fontStack =
    "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";

  ctx.font = `700 ${titleSize}px ${fontStack}`;
  const titleWidth = ctx.measureText(title).width;
  ctx.font = `400 ${subtitleSize}px ${fontStack}`;
  const subtitleWidth = ctx.measureText(subtitle).width;
  const barWidth = Math.max(titleWidth, subtitleWidth) + pad * 2;
  const barHeight = titleSize + subtitleSize + pad * 2.2;
  const x = pad;
  const y = h - pad - barHeight;
  const radius = 10 * scale;

  ctx.fillStyle = 'rgba(10, 14, 22, 0.72)';
  ctx.beginPath();
  ctx.roundRect(x, y, barWidth, barHeight, radius);
  ctx.fill();

  ctx.fillStyle = 'rgba(240, 245, 255, 0.98)';
  ctx.font = `700 ${titleSize}px ${fontStack}`;
  ctx.fillText(title, x + pad, y + pad + titleSize * 0.8);
  ctx.fillStyle = 'rgba(205, 220, 245, 0.85)';
  ctx.font = `400 ${subtitleSize}px ${fontStack}`;
  ctx.fillText(
    subtitle,
    x + pad,
    y + pad + titleSize * 0.8 + subtitleSize * 1.15
  );

  // Filigrane discret, coin bas-droit.
  const wmSize = Math.max(10, 12 * scale);
  ctx.font = `400 ${wmSize}px ${fontStack}`;
  ctx.fillStyle = 'rgba(220, 230, 250, 0.55)';
  ctx.textAlign = 'right';
  ctx.fillText(SITE_NAME, w - pad, h - pad);
  ctx.textAlign = 'left';
}

export function setupCapture(
  camera: CameraSystem,
  om: OrbitalMechanics,
  navigation: PlanetNavigation
): void {
  const btn = document.getElementById('capture-btn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    document.body.classList.add('is-capturing');
    try {
      // La boucle de rendu tourne déjà en continu (AnimationSystem) : ce tick garantit
      // seulement qu'au moins une frame a été rendue après le masquage du chrome.
      await new Promise<number>((resolve) => requestAnimationFrame(resolve));

      const source = camera.renderer.domElement;
      const w = source.width;
      const h = source.height;
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        showToast(t('capture.failed'));
        return;
      }
      ctx.drawImage(source, 0, 0, w, h);

      const selected = navigation.getSelectedBody();
      const bodyLabel =
        !selected || selected === 'overview'
          ? t('nav.overview')
          : bodyDisplayName(selected);
      const distanceKm =
        om.scaleMode === 'explo'
          ? (() => {
              const sceneDist = camera.getDistanceToTargetSceneUnits();
              return sceneDist === null ? null : sceneUnitsToKm(sceneDist);
            })()
          : null;
      const { title, subtitle } = buildCartoucheText(
        bodyLabel,
        om.simulationDate,
        distanceKm
      );
      drawCartouche(ctx, w, h, title, subtitle);

      const blob: Blob | null = await new Promise((resolve) =>
        canvas.toBlob(resolve, 'image/png')
      );
      if (!blob) {
        showToast(t('capture.failed'));
        return;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const isoDate = om.simulationDate.toISOString().slice(0, 10);
      const slug = (selected && selected !== 'overview'
        ? selected
        : 'overview'
      ).toLowerCase();
      a.href = url;
      a.download = `galaxy-${slug}-${isoDate}.png`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(t('capture.success'));
    } catch {
      showToast(t('capture.failed'));
    } finally {
      document.body.classList.remove('is-capturing');
    }
  });
}
