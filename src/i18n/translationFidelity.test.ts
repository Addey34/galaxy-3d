import { describe, expect, it } from 'vitest';
import { messages } from './allDictionaries';
import { LOCALES, type Locale } from './locales';
import { en } from './dict-en';

/**
 * CE QU'UNE MACHINE PEUT VÉRIFIER D'UNE TRADUCTION — et ce lot en a besoin.
 *
 * Les quatre dictionnaires ont été traduits par Claude au lot 20 et relus par aucun locuteur
 * natif : c'est écrit dans `docs/private/LANGUES_LOT20.md`. Une machine ne sait pas juger une
 * tournure, mais elle sait refuser les trois fautes qui transforment une traduction en
 * AFFIRMATION FAUSSE, et ce sont exactement les pièges P1 à P3 du plan :
 *
 *   - un NOMBRE qui change (« 24 » traduit en « 25 », une décimale déplacée) ;
 *   - un GABARIT `{…}` perdu : l'interpolation ne remplace alors rien, et la phrase affiche
 *     « corps correspondent » sans le compte, ou perd la date entière ;
 *   - un NOM PROPRE ou un sigle traduit : « NASA IMERG » n'est pas un mot commun, et une source
 *     citée sous un autre nom n'est plus une source.
 *
 * Et une quatrième, qui n'est pas une faute de sens mais une faute d'OUBLI : une valeur restée
 * identique à l'anglais parce que personne ne l'a traduite. Elle est interdite sauf déclaration,
 * ce qui force à écrire POURQUOI « Auto » reste « Auto ».
 */

/** Les suites de chiffres d'une chaîne, comparées comme un multiensemble ordonné. */
function digits(value: string): string[] {
  return (value.match(/\d+/g) ?? []).sort();
}

/** Les gabarits d'interpolation, ceux que `t()` remplace. */
function placeholders(value: string): string[] {
  return (value.match(/\{[a-zA-Z]+\}/g) ?? []).sort();
}

/**
 * Ce qui NE se traduit PAS, et qui doit donc se retrouver mot pour mot dans les quatre langues.
 *
 * Deux familles : les noms de produits et d'organisations (une source citée sous un autre nom
 * n'est plus vérifiable), et les noms de jeux de données. Les noms de CORPS n'y sont pas, et
 * c'est la raison d'être de cette liste explicite : « Earth » devient « Terre », « Tierra »,
 * « Terra », donc aucune règle générale sur les majuscules ne pourrait trancher.
 */
const UNTRANSLATABLE = [
  'Galaxy',
  'Ko-fi',
  'Open-Meteo',
  'Astronomy Engine',
  'JPL Horizons',
  'JPL Small-Body Database',
  'NASA',
  'USGS',
  'EONET',
  'IMERG',
  'MERRA-2',
  'ERA5',
  'Voyager 1',
  'V07',
] as const;

/**
 * Les valeurs qui restent IDENTIQUES à l'anglais, avec leur raison. Une par clé, et le test
 * refuse une entrée qui ne servirait plus : une liste d'exceptions qui pourrit est une liste
 * d'exceptions qui couvre autre chose que ce qu'elle dit.
 */
const IDENTICAL_TO_ENGLISH: Record<string, string> = {
  // Bornes de légende : un nombre et une unité du SI, rien à traduire.
  'weather.precipModel.lo': 'nombre + unité SI',
  'weather.precipModel.hi': 'nombre + unité SI',
  'weather.thermalModel.lo': 'nombre + unité SI',
  'weather.thermalModel.hi': 'nombre + unité SI',
  'weather.pressureModel.lo': 'nombre + unité SI',
  'weather.pressureModel.hi': 'nombre + unité SI',
  'weather.humidityModel.lo': 'nombre + unité SI',
  'weather.humidityModel.hi': 'nombre + unité SI',
  // Noms propres et abréviations partagées.
  'position.source.astronomy-engine': 'nom du logiciel',
  'quality.auto': '« Auto » s’écrit pareil dans les quatre langues',
  'mode.educ': 'abréviation, identique en espagnol et en portugais',
  'mode.explo': 'abréviation, identique dans les quatre langues',
  'help.tip.mode.key': 'reprend les deux abréviations ci-dessus',
  // Mots savants identiques d'une langue romane à l'autre.
  'events.kind.penumbral': 'même mot en espagnol et en portugais',
  'events.kind.total': 'même mot en espagnol et en portugais',
  'help.title': 'même mot en français',
  'credits.textures': 'même mot en français',
  'credits.sources': 'même mot en français',
  'bi.sources': 'même mot en français',
  'bi.missions.label': 'même mot en français',
  'bi.source': 'même mot en français',
  'tours.pause': 'même mot en français',
  'weather.precip.legendHi': 'même mot en français',
  // Unités et suffixes : décidés une fois, cf. `dict-es` et `dict-pt-BR`.
  'unit.day.short': '« d » pour day/día/dia',
  'unit.million': '« M » en français comme en anglais',
  // Gabarit de ponctuation : seul le français met une espace avant le deux-points, donc les
  // trois autres langues partagent la même forme. C'est le but de cette clé.
  'bi.creditLine': 'ponctuation : identique hors du français',
};

const OTHER_LOCALES = LOCALES.filter(
  (locale): locale is Exclude<Locale, 'en'> => locale !== 'en'
);
const KEYS = Object.keys(en);

describe('fidélité des traductions', () => {
  it('trouve bien les quatre dictionnaires et leurs clés', () => {
    // Borne : un relevé vide rendrait tout le reste vert sans rien prouver.
    expect(LOCALES).toHaveLength(4);
    expect(KEYS.length).toBeGreaterThan(300);
    for (const locale of LOCALES)
      expect(Object.keys(messages[locale]).sort()).toEqual([...KEYS].sort());
  });

  for (const locale of OTHER_LOCALES) {
    it(`garde chaque nombre de l’anglais en ${locale}`, () => {
      const drift: string[] = [];
      for (const key of KEYS) {
        const source = digits(en[key as keyof typeof en]);
        const target = digits(messages[locale][key as keyof typeof en]);
        if (source.join(',') !== target.join(','))
          drift.push(`${key} : en=[${source}] ${locale}=[${target}]`);
      }
      expect(
        drift,
        'un nombre déplacé ou perdu dans une traduction est une affirmation fausse'
      ).toEqual([]);
    });

    it(`garde chaque gabarit d’interpolation en ${locale}`, () => {
      const drift: string[] = [];
      for (const key of KEYS) {
        const source = placeholders(en[key as keyof typeof en]);
        const target = placeholders(messages[locale][key as keyof typeof en]);
        if (source.join(',') !== target.join(','))
          drift.push(`${key} : en=[${source}] ${locale}=[${target}]`);
      }
      expect(
        drift,
        'un gabarit perdu fait disparaître la valeur qu’il portait, sans erreur'
      ).toEqual([]);
    });

    it(`ne traduit aucun nom propre ni sigle en ${locale}`, () => {
      const lost: string[] = [];
      for (const key of KEYS) {
        const source = en[key as keyof typeof en];
        const target = messages[locale][key as keyof typeof en];
        for (const name of UNTRANSLATABLE)
          if (source.includes(name) && !target.includes(name))
            lost.push(`${key} : « ${name} » absent de la version ${locale}`);
      }
      expect(lost).toEqual([]);
    });

    it(`ne laisse aucune valeur vide ni mal découpée en ${locale}`, () => {
      const bad: string[] = [];
      for (const key of KEYS) {
        const value = messages[locale][key as keyof typeof en];
        if (value.trim() === '') bad.push(`${key} : vide`);
        else if (value !== value.trim()) bad.push(`${key} : espace aux bords`);
      }
      expect(bad).toEqual([]);
    });
  }

  it('ne laisse aucune valeur identique à l’anglais sans raison écrite', () => {
    const undeclared: string[] = [];
    for (const locale of OTHER_LOCALES)
      for (const key of KEYS)
        if (
          messages[locale][key as keyof typeof en] ===
            en[key as keyof typeof en] &&
          IDENTICAL_TO_ENGLISH[key] === undefined
        )
          undeclared.push(`${locale} / ${key}`);
    expect(
      undeclared,
      'une valeur restée en anglais est soit un oubli, soit une décision : dans le second cas ' +
        'elle s’écrit dans IDENTICAL_TO_ENGLISH avec sa raison'
    ).toEqual([]);
  });

  it('ne garde aucune exception qui ne serve plus', () => {
    const useless = Object.keys(IDENTICAL_TO_ENGLISH).filter(
      (key) =>
        !OTHER_LOCALES.some(
          (locale) =>
            messages[locale][key as keyof typeof en] ===
            en[key as keyof typeof en]
        )
    );
    expect(
      useless,
      'ces clés ne sont plus identiques à l’anglais : retirer leur exception'
    ).toEqual([]);
  });

  it('attrape vraiment une traduction infidèle', () => {
    // Falsification INTÉGRÉE : sans elle, ces quatre tests passeraient aussi sur des
    // comparateurs cassés. Chaque mutation est celle qu'une traduction automatique produit.
    expect(digits('24 mil millones de km')).toEqual(['24']);
    expect(digits('25 mil millones de km')).not.toEqual(digits('24 mil'));
    expect(digits('1,50')).toEqual(['1', '50']);
    expect(placeholders('{count} cuerpos coinciden.')).toEqual(['{count}']);
    expect(placeholders('cuerpos coinciden.')).toEqual([]);
    expect('Datos de la NASA'.includes('NASA')).toBe(true);
    expect('Datos de la ANSA'.includes('NASA')).toBe(false);
  });
});
