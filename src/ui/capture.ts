/**
 * Bouton « Capturer cette vue » (#capture-btn) — mode planétarium.
 *
 * Masque tout le chrome UI, fige la frame WebGL courante dans une image, y incruste un
 * cartouche (corps, date, distance) et déclenche un téléchargement PNG — pensé pour le partage
 * social organique. Miroir de `share.ts` (action en un clic → toast), mais avec un `try/finally`
 * car cette fonctionnalité mute temporairement l'état visuel de l'app (contrairement à `share.ts`,
 * sans effet de bord en cas d'échec).
 */
import { t, intlLocale, getLocale } from '@/i18n';
import { formatDateText } from '@/core/dateText';
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
  // Le premier du mois en ordinal (« 1er mars »), comme partout ailleurs (`core/dateText.ts`).
  const dateStr = formatDateText(
    date,
    { dateStyle: 'long' },
    getLocale(),
    intlLocale()
  );
  const subtitle =
    distanceKm !== null
      ? `${dateStr} · ${formatLiveDistance(distanceKm)}`
      : dateStr;
  return { title: bodyLabel, subtitle };
}

const SITE_NAME = 'Galaxy';

/**
 * Les crédits que le bandeau de provenance montre à l'écran (imagerie, relief, bâtiments), à
 * reporter sur l'image : sans eux, une capture emportait l'image d'un tiers SANS la mention que sa
 * licence exige, puisque le mode capture masque ce bandeau. Pur : les textes sont fournis.
 */
export function buildCreditText(parts: readonly string[]): string {
  const seen = new Set<string>();
  for (const part of parts) {
    const text = part.replace(/\s+/g, ' ').trim();
    if (text) seen.add(text);
  }
  return [...seen].join(' · ');
}

/** Coupe un texte en lignes de `maxWidth` au plus (mesure fournie) ; un mot trop long reste entier. */
export function wrapText(
  text: string,
  maxWidth: number,
  measure: (line: string) => number
): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && measure(candidate) > maxWidth) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}

/** Ce que le bandeau de provenance dit à l'écran, lu avant que le mode capture ne le masque. */
function onScreenCredit(): string {
  const badge = document.getElementById('surface-imagery');
  if (!badge || badge.hidden) return '';
  const parts = ['.si-credit', '.si-buildings-credit'].map(
    (selector) => badge.querySelector(selector)?.textContent ?? ''
  );
  return buildCreditText(parts);
}

function drawCartouche(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  title: string,
  subtitle: string,
  credit: string
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

  // Crédits des données : au-dessus du filigrane, alignés à droite, sur au plus 60 % de la largeur
  // (et jamais sur le cartouche, à gauche).
  if (credit) {
    const creditSize = Math.max(9, 11 * scale);
    ctx.font = `400 ${creditSize}px ${fontStack}`;
    ctx.fillStyle = 'rgba(220, 230, 250, 0.8)';
    const lines = wrapText(credit, w * 0.6, (l) => ctx.measureText(l).width);
    let baseline = h - pad - wmSize * 1.6;
    for (const line of lines.reverse()) {
      ctx.fillText(line, w - pad, baseline);
      baseline -= creditSize * 1.25;
    }
  }
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
    // Lu AVANT le masquage : c'est ce que la licence des données exige de voir.
    const credit = onScreenCredit();
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
      drawCartouche(ctx, w, h, title, subtitle, credit);

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
      const slug = (
        selected && selected !== 'overview' ? selected : 'overview'
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
