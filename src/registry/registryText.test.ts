import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DERIVED_TEXT_LOCALES,
  collectTranslations,
  englishStrings,
  hydrateLocalized,
  stripToEnglish,
  textKey,
} from '@/core/registryText';

/**
 * LA DÉRIVATION DU TEXTE DU REGISTRE EST-ELLE FIDÈLE ? (lot 20, phase 20B)
 *
 * Le navigateur ne reçoit que l'anglais des fiches, et les trois autres langues arrivent dans une
 * carte dérivée au build. Cette séparation est une OPTIMISATION, donc elle doit être prouvée
 * neutre : ce que la fiche disait, l'application doit le dire encore.
 *
 * La propriété centrale est un ALLER-RETOUR, vérifié sur les fiches réellement livrées : alléger
 * puis reposer la carte d'une langue reconstruit exactement le texte de cette langue. Une
 * dérivation qui perdrait un champ, ou qui le rattacherait au mauvais bloc, échoue ici — et pas
 * dans six mois, sous les yeux d'un visiteur hispanophone.
 */

const REGISTRY = resolve(import.meta.dirname);
const DIRS = ['entities', 'spacecraft', 'interstellar', 'providers', 'tours'];

function fiches(): { file: string; json: unknown }[] {
  const out: { file: string; json: unknown }[] = [];
  for (const dir of DIRS) {
    const full = join(REGISTRY, dir);
    for (const name of readdirSync(full))
      if (name.endsWith('.json') && name !== 'order.json')
        out.push({
          file: `${dir}/${name}`,
          json: JSON.parse(readFileSync(join(full, name), 'utf8')) as unknown,
        });
  }
  return out;
}

describe('dérivation du texte du registre', () => {
  const all = fiches();

  it('lit bien les fiches', () => {
    expect(all.length).toBeGreaterThan(70);
  });

  for (const locale of DERIVED_TEXT_LOCALES) {
    it(`reconstruit exactement le ${locale} après allègement`, () => {
      const drift: string[] = [];
      for (const { file, json } of all) {
        const map = collectTranslations(json, locale);
        const rebuilt = stripToEnglish(json);
        hydrateLocalized(rebuilt, map, locale);
        // La comparaison porte sur le texte de CETTE langue uniquement : les autres langues ont
        // été retirées à dessein, et les comparer ferait échouer le test pour la bonne raison au
        // mauvais endroit.
        const before = collectTranslations(json, locale);
        const after = collectTranslations(rebuilt, locale);
        if (JSON.stringify(before) !== JSON.stringify(after)) drift.push(file);
      }
      expect(
        drift,
        'ces fiches ne se reconstruisent pas à l’identique'
      ).toEqual([]);
    });

    it(`couvre chaque texte anglais en ${locale}`, () => {
      const missing: string[] = [];
      for (const { file, json } of all) {
        const map = collectTranslations(json, locale);
        // Un lien Wikipédia peut manquer dans une langue : il est DÉRIVÉ de l'article anglais
        // et omis quand l'article n'existe pas (cf. `localizedFidelity.test.ts`). Sa garde est
        // `pnpm i18n:wiki --check`, pas cette carte.
        const wikiEnglish = new Set(
          [...JSON.stringify(json).matchAll(/"wiki":\{"en":"([^"]+)"/g)].map(
            (m) => m[1]!
          )
        );
        for (const english of englishStrings(json))
          if (map[textKey(english)] === undefined && !wikiEnglish.has(english))
            missing.push(`${file} : « ${english.slice(0, 60)} »`);
      }
      expect(
        missing,
        'un anglais sans traduction afficherait de l’anglais sous une autre étiquette de langue'
      ).toEqual([]);
    });
  }

  it('n’emporte plus aucune autre langue dans la version allégée', () => {
    for (const { file, json } of all) {
      const stripped = JSON.stringify(stripToEnglish(json));
      for (const locale of DERIVED_TEXT_LOCALES)
        expect(stripped, `${file} porte encore du ${locale}`).not.toContain(
          `"${locale}":`
        );
    }
  });

  it('allège vraiment : la version servie est plus petite', () => {
    // La mesure, pas la promesse. Au lot 20 : 50 263 octets d'espagnol et de portugais étaient
    // inlinés pour tous les visiteurs, et le bundle est passé de 586 918 à 523 825 octets.
    const full = all.reduce(
      (n, { json }) => n + JSON.stringify(json).length,
      0
    );
    const lean = all.reduce(
      (n, { json }) => n + JSON.stringify(stripToEnglish(json)).length,
      0
    );
    expect(lean).toBeLessThan(full * 0.8);
  });

  it('n’a aucune collision d’empreinte sur les textes livrés', () => {
    const byKey = new Map<string, string>();
    for (const { json } of all)
      for (const english of englishStrings(json)) {
        const key = textKey(english);
        const seen = byKey.get(key);
        expect(seen ?? english, `collision sur ${key}`).toBe(english);
        byKey.set(key, english);
      }
    expect(byKey.size).toBeGreaterThan(150);
  });

  it('attrape vraiment une dérivation infidèle', () => {
    // Falsification INTÉGRÉE. Sans elle, l'aller-retour passerait aussi sur un `strip` qui ne
    // retire rien, ou sur une `hydrate` qui n'écrit rien.
    const fiche = {
      description: { en: 'A', fr: 'B', es: 'C', 'pt-BR': 'D' },
      radius: 1.5,
      nested: [{ note: { en: 'X', fr: 'Y', es: 'Z', 'pt-BR': 'W' } }],
    };
    const lean = stripToEnglish(fiche);
    expect(JSON.stringify(lean)).toBe(
      JSON.stringify({
        description: { en: 'A' },
        radius: 1.5,
        nested: [{ note: { en: 'X' } }],
      })
    );
    expect(hydrateLocalized(lean, collectTranslations(fiche, 'es'), 'es')).toBe(
      2
    );
    expect(JSON.stringify(lean)).toContain('"es":"C"');
    // Une carte vide ne complète rien, et ne prétend pas le contraire.
    expect(hydrateLocalized(stripToEnglish(fiche), {}, 'fr')).toBe(0);
    // L'empreinte distingue deux chaînes proches, et reste stable.
    expect(textKey('A')).not.toBe(textKey('B'));
    expect(textKey('Mars')).toBe(textKey('Mars'));
    // Un objet de configuration qui porte un champ `en` n'est PAS un texte localisé.
    const config = { en: 'x', radius: 2 };
    expect(JSON.stringify(stripToEnglish(config))).toBe(
      JSON.stringify({ en: 'x', radius: 2 })
    );
  });
});

/**
 * UNE `Map` SE TRAVERSE — le défaut trouvé le 2026-09-28 en ouvrant le lot 21.
 *
 * `Object.values(new Map(...))` rend un tableau VIDE : la première version de `hydrateLocalized`
 * ne posait donc RIEN dans un objet rangé par clé, et les 14 objets d'instrument, tenus par
 * `NAVIGABLE_TARGETS` et `NAVIGABLE_BODIES`, lisaient l'anglais dans les trois autres langues alors
 * que leur traduction était téléchargée. Invisible en test (les fiches n'y sont pas allégées) et
 * invisible à l'œil (une description anglaise reste une phrase).
 */
describe('la traversée d’une Map', () => {
  const fiche = () => ({
    displayName: { en: 'Probe', fr: 'Sonde', es: 'Sonda', 'pt-BR': 'Sonda' },
  });

  it('pose la langue dans les valeurs d’une Map, pas seulement d’un tableau', () => {
    const inArray = [stripToEnglish(fiche())];
    const inMap = new Map([['probe', stripToEnglish(fiche())]]);
    const map = collectTranslations(fiche(), 'fr');

    expect(hydrateLocalized(inArray, map, 'fr')).toBe(1);
    // Le cas qui rendait 0 avant le correctif.
    expect(hydrateLocalized(inMap, map, 'fr')).toBe(1);
    expect(inMap.get('probe')!.displayName.fr).toBe('Sonde');
  });

  it('compte les textes anglais d’une Map, pour que la garde et la pose s’accordent', () => {
    // Deux lectures du même objet : si `englishStrings` ignorait la Map alors que
    // `hydrateLocalized` la traverse, la garde de `config/catalogueText.test.ts` serait verte à tort.
    expect(englishStrings(new Map([['probe', fiche()]])).size).toBe(1);
  });
});
