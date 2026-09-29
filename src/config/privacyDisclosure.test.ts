import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from './storageKeys';
import { LOCALES } from '@/i18n/locales';
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
 *
 * DEPUIS LE LOT 35, « chaque langue » en veut dire QUATRE. La page n'en portait que deux alors
 * que l'application en sert quatre depuis le lot 20, et le défaut n'était pas qu'esthétique :
 * `privacy.js` lisait la préférence enregistrée puis la JETAIT si elle ne valait ni `fr` ni
 * `en`, si bien qu'un visiteur hispanophone lisait cette page en anglais. La liste des langues
 * est désormais DÉRIVÉE de `LOCALES`, donc une cinquième langue ajoutée à l'application fera
 * tomber ce test tant que la page ne l'aura pas.
 */
describe('divulgation du stockage local', () => {
  const keys = Object.keys(STORAGE_KEYS).length;

  it.each([
    ['français', 'Préférences enregistrées sur votre appareil'],
    ['anglais', 'Preferences stored on your device'],
    ['espagnol', 'Preferencias guardadas en su dispositivo'],
    ['portugais', 'Preferências guardadas no seu dispositivo'],
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

/**
 * LA PAGE PORTE LES MÊMES LANGUES QUE L'APPLICATION.
 *
 * Une page statique, hors bundle, ne peut pas importer `LOCALES` : elle le RECOPIE dans
 * `privacy.js`, et une copie qui ne bouge pas quand l'original bouge est exactement ce qui
 * est arrivé au lot 20. Ces gardes croisent les trois endroits — la liste du script, les
 * boutons du sélecteur, et les blocs de texte — avec la seule source de vérité.
 */
describe('la page de confidentialité parle les quatre langues', () => {
  const SCRIPT = readFileSync(join(PROJECT_ROOT, 'public/privacy.js'), 'utf8');

  it('déclare dans son script exactement les langues de l’application', () => {
    const declared = /var LOCALES = \[([^\]]+)\]/.exec(SCRIPT);
    expect(
      declared,
      'privacy.js ne déclare plus sa liste de langues'
    ).not.toBeNull();
    const listed = [...declared![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect([...listed].sort()).toEqual([...LOCALES].sort());
  });

  it('offre un bouton et un bloc de texte par langue', () => {
    for (const locale of LOCALES) {
      expect(
        PRIVACY.includes(`data-locale="${locale}"`),
        `${locale} : aucun bouton dans le sélecteur`
      ).toBe(true);
      expect(
        PRIVACY.includes(`data-lang="${locale}"`),
        `${locale} : aucun bloc de texte`
      ).toBe(true);
    }
  });

  it('n’affiche qu’une langue au chargement, et c’est celle du document', () => {
    // Sans `hidden` sur les trois autres, un visiteur sans JavaScript lirait la page QUATRE
    // fois de suite. Le bloc visible doit être celui que `<html lang>` annonce.
    const blocks = [
      ...PRIVACY.matchAll(/<div data-lang="([^"]+)"( hidden)?>/g),
    ];
    expect(blocks).toHaveLength(LOCALES.length);
    const visible = blocks.filter((b) => b[2] === undefined).map((b) => b[1]);
    expect(visible).toHaveLength(1);
    expect(/<html lang="([^"]+)"/.exec(PRIVACY)![1]).toBe(visible[0]);
  });
});
