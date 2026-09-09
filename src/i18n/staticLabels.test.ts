import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { messages } from './locales';

/**
 * LIBELLÉS STATIQUES DE `index.html` — traduits, et jamais périmés.
 *
 * Deux défauts que ce fichier attrape, tous deux réellement présents avant lui.
 *
 * 1. **Un libellé anglais figé.** Quatre éléments portaient un `aria-label` en dur SANS
 *    `data-i18n-aria` : le dock (« Tools »), le curseur de vitesse (« Simulation speed »), le
 *    panneau de réglages (« Display settings ») et le champ de recherche (« Search a body »).
 *    Un utilisateur francophone se les entendait annoncer en anglais. Deux d'entre eux avaient
 *    même déjà leur clé de traduction, inutilisée, à quelques lignes de là. Rien ne le
 *    signalait : la page s'affiche, axe-core est content (le nom existe), et le test d'arbre
 *    d'accessibilité aussi (il vérifie qu'un nom existe, pas qu'il est traduit).
 *
 * 2. **Un repli périmé.** Le HTML porte à la fois le texte anglais et la clé i18n : le texte
 *    sert avant que `applyStaticI18n` ne passe, et si l'i18n échoue. C'est légitime — mais il
 *    devient un mensonge dès que la valeur du dictionnaire change sans que le HTML suive. On
 *    exige donc l'ÉGALITÉ avec la valeur anglaise, ce qui transforme une redondance en
 *    garantie.
 *
 * Vérification purement STATIQUE : ni navigateur ni rendu, donc elle tourne dans `pnpm verify`
 * en quelques millisecondes plutôt qu'en vingt minutes d'e2e.
 */

const html = readFileSync(
  new URL('../../index.html', import.meta.url),
  'utf-8'
);

/** Chaque balise ouvrante du document, avec ses attributs. */
const TAGS = html.match(/<[a-z][a-z0-9]*\s[^>]*>/gi) ?? [];

const attribute = (tag: string, name: string): string | null =>
  tag.match(new RegExp(String.raw`\s` + name + '="([^"]*)"'))?.[1] ?? null;

/** De quoi situer l'élément fautif dans le fichier sans faire lire le HTML entier. */
const identify = (tag: string): string =>
  attribute(tag, 'id') ?? attribute(tag, 'class') ?? tag.slice(0, 40);

/** Les deux paires attribut visible → attribut de liaison i18n. */
const BOUND: { label: string; binding: string }[] = [
  { label: 'aria-label', binding: 'data-i18n-aria' },
  { label: 'title', binding: 'data-i18n-title' },
];

describe('libellés statiques de index.html', () => {
  it('couvre bien le document', () => {
    // Si le HTML est réorganisé au point que ce test ne voit plus rien, il doit le dire au
    // lieu de passer sur un ensemble vide.
    expect(TAGS.length).toBeGreaterThan(100);
    const labelled = TAGS.filter((tag) =>
      BOUND.some(({ label }) => attribute(tag, label) !== null)
    );
    expect(labelled.length).toBeGreaterThan(20);
  });

  for (const { label, binding } of BOUND) {
    it(`lie chaque ${label} à une clé de traduction`, () => {
      const unbound = TAGS.filter(
        (tag) =>
          attribute(tag, label) !== null && attribute(tag, binding) === null
      ).map((tag) => `${identify(tag)} → ${label}="${attribute(tag, label)}"`);

      expect(
        unbound,
        `${label} figé en anglais : ajouter ${binding}="<clé>" (ou la clé existante si elle ` +
          `existe déjà — deux de ces quatre cas l'avaient sous la main)`
      ).toEqual([]);
    });

    it(`garde chaque ${label} identique à sa valeur anglaise`, () => {
      const stale: string[] = [];
      for (const tag of TAGS) {
        const key = attribute(tag, binding);
        const value = attribute(tag, label);
        if (key === null || value === null) continue;
        const english = messages.en[key];
        if (english === undefined) {
          stale.push(`${identify(tag)} → clé inconnue "${key}"`);
        } else if (english !== value) {
          stale.push(
            `${identify(tag)} → "${value}" ≠ en["${key}"] = "${english}"`
          );
        }
      }
      expect(
        stale,
        'le texte en dur sert de repli avant/sans i18n : périmé, il ment'
      ).toEqual([]);
    });
  }

  it('traduit en français chaque clé référencée par le HTML', () => {
    const missing = new Set<string>();
    for (const tag of TAGS)
      for (const { binding } of BOUND) {
        const key = attribute(tag, binding);
        if (key !== null && messages.fr[key] === undefined) missing.add(key);
      }
    expect([...missing]).toEqual([]);
  });
});
