import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from './storageKeys';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PRIVACY = readFileSync(join(PROJECT_ROOT, 'public/privacy.html'), 'utf8');

/** Items de la liste qui suit un titre donné (section « préférences enregistrées »). */
function listAfter(heading: string): string[] {
  const start = PRIVACY.indexOf(heading);
  expect(start, `titre introuvable : ${heading}`).toBeGreaterThan(-1);
  const list = PRIVACY.slice(start, PRIVACY.indexOf('</ul>', start));
  return [...list.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]!.trim());
}

/**
 * LA PAGE DE CONFIDENTIALITÉ DIT TOUT CE QUE L'APPLICATION ENREGISTRE.
 *
 * Elle promet de lister les préférences gardées dans le navigateur. Elle en citait trois quand
 * l'application en stockait huit : luminosité, palette daltonienne, unités, suggestion de visite
 * et trajectoires interstellaires avaient été ajoutées sans que la page suive. Rien ne cassait —
 * c'est une promesse faite aux visiteurs, pas du code. Ce test en fait un contrat : une clé de
 * stockage de plus sans ligne de plus dans CHAQUE langue, et il tombe.
 */
describe('divulgation du stockage local', () => {
  const keys = Object.keys(STORAGE_KEYS).length;

  it.each([
    ['français', 'Préférences enregistrées sur votre appareil'],
    ['anglais', 'Preferences stored on your device'],
  ])(
    'la version %s liste une préférence par clé de stockage',
    (_l, heading) => {
      expect(listAfter(heading)).toHaveLength(keys);
    }
  );
});
