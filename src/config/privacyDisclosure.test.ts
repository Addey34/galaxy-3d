import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from './storageKeys';
import { connectHostsFromFirebase } from '@/seo/sourcesPage';
import firebaseJson from '../../firebase.json';

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

/**
 * LA PAGE DE CONFIDENTIALITÉ NOMME TOUT CE QUE LE NAVIGATEUR CONTACTE.
 *
 * Elle promet d'énumérer les services interrogés, et elle en citait trois quand la CSP en
 * autorisait six : les deux fournisseurs d'événements terrestres du lot 8 ont été ajoutés
 * après coup, et ce test existe pour que la prochaine fois la page tombe au lieu d'être
 * silencieusement incomplète. La CSP fait foi : c'est elle, et elle seule, qui décide ce
 * qu'un navigateur a le droit de joindre.
 *
 * La comparaison se fait par SUFFIXE : la page cite « open-meteo.com » là où la CSP autorise
 * `api.open-meteo.com` et `archive-api.open-meteo.com`, et nommer le domaine une fois suffit
 * à décrire honnêtement les deux.
 */
describe('divulgation des services contactés', () => {
  const connectHosts = connectHostsFromFirebase(firebaseJson);
  /** Hôtes écrits entre parenthèses dans la page, quelle que soit la langue. */
  const mentioned = [
    ...PRIVACY.matchAll(/[( ,]([a-z0-9-]+(?:\.[a-z0-9-]+)+)[),]/g),
  ].map((match) => match[1]!);

  it('trouve des hôtes dans la page, sinon la suite ne prouverait rien', () => {
    expect(connectHosts.length).toBeGreaterThanOrEqual(6);
    expect(mentioned.length).toBeGreaterThanOrEqual(4);
  });

  it.each(connectHosts)('%s est nommé dans la page', (host) => {
    const covered = mentioned.some(
      (name) => host === name || host.endsWith(`.${name}`)
    );
    expect(
      covered,
      `${host} est autorisé par la CSP mais n'est décrit nulle part dans public/privacy.html`
    ).toBe(true);
  });
});
