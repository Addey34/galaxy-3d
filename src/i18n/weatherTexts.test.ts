import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PRECIP_MODEL_SETTINGS } from '@/config/engine';
import { messages } from './allDictionaries';
import { LOCALES } from './locales';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

/**
 * LES TEXTES DE LA MÉTÉO DISENT CE QUE L'ÉCRAN FAIT (audit des panneaux, lot 3, 2026-10-30).
 *
 * Quatre phrases publiées affirmaient autre chose que le code :
 *  - la note de pression promettait des isobares, le rendu est un aplat de couleurs ;
 *  - le bas de la barre de pluie disait « 0 mm/h » alors que tout ce qui est sous le seuil de
 *    transparence est invisible ;
 *  - la note des nuages modélisés renvoyait au « direct », que le badge d'une couche modèle ne
 *    produit jamais (aucune tolérance `live`) ;
 *  - la palette vide empruntait le message du panneau Événements.
 */
describe('textes de la météo et de la palette', () => {
  it('ne promet des isobares que si la couche trace des contours', () => {
    const traceContours = /contour|isoline|marching/i.test(
      read('src/ui/pressureModelLayer.ts')
    );
    for (const locale of LOCALES) {
      const note = messages[locale]['weather.pressureModel.note'];
      if (!traceContours) expect(note, locale).not.toMatch(/isobar|isóbar/i);
    }
  });

  it('écrit en bas de la barre de pluie le seuil réel de transparence', () => {
    const threshold = PRECIP_MODEL_SETTINGS.transparentBelow;
    for (const locale of LOCALES) {
      const low = messages[locale]['weather.precipModel.lo'];
      const value = Number(low.replace(',', '.').replace(/[^\d.]/g, ''));
      expect(value, `${locale} : « ${low} »`).toBe(threshold);
    }
  });

  it('ne renvoie pas les nuages modélisés au « direct »', () => {
    for (const locale of LOCALES) {
      const note = messages[locale]['weather.cloudsModel.note'];
      expect(note, locale).not.toMatch(/live view|direct\b|ao vivo/i);
    }
  });

  it('dit « aucun résultat » dans la palette avec sa propre clé', () => {
    expect(read('src/ui/bodyPalette.ts')).not.toContain("'events.empty'");
    for (const locale of LOCALES) {
      expect(messages[locale]['nav.noMatch'], locale).not.toBe('');
    }
  });
});

/**
 * LE CHIFFRE DU TÉLÉCHARGEMENT HORS LIGNE DE LA PAGE DE CONFIDENTIALITÉ EST CELUI DU MANIFESTE.
 *
 * Elle annonçait 51,2 Mo « au 2026-10-04 » quand un commentaire du code parlait de 38 Mo et que
 * le manifeste pèse 64,0 Mo : trois chiffres pour une seule grandeur, que l'écran, lui, lit
 * toujours. Le chiffre écrit est arrondi au Mo décimal (comme `offlineData.ts`) et ce test tombe
 * dès que le manifeste change d'un Mo.
 */
describe('taille du paquet hors ligne annoncée par la page de confidentialité', () => {
  const manifest = JSON.parse(
    read('public/assets/ephemerides/manifest.json')
  ) as { bodies: Record<string, { file: string }> };
  const bytes = Object.values(manifest.bodies).reduce(
    (total, entry) =>
      total +
      statSync(join(ROOT, 'public/assets/ephemerides', entry.file)).size,
    0
  );
  const megabytes = Math.round(bytes / 1e6);
  const privacy = read('public/privacy.html');

  it.each([
    ['fr', 'environ', 'Mo'],
    ['en', 'about', 'MB'],
    ['es', 'unos', 'MB'],
    ['pt-BR', 'cerca de', 'MB'],
  ])('%s annonce %s le poids lu dans le manifeste', (_locale, lead, unit) => {
    expect(privacy).toContain(`(${lead} ${megabytes} ${unit})`);
  });
});
