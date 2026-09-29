import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { BUILD_ONLY_DIRS } from '@/buildOnly';

/**
 * UN TEXTE D'UNE LANGUE QUE LE VISITEUR NE LIT PAS NE DOIT PAS PARTIR AVEC LE DÉMARRAGE.
 *
 * Le lot 20 a posé le contrat — « un visiteur charge le dictionnaire de SA langue et d'aucune
 * autre » — et il est CHIFFRÉ dans le code qui le déclare : la raison du groupe exclusif
 * `catalogue-*` de `core/startupBudget.ts` parle de 50 263 octets qu'un anglophone ne lit jamais.
 *
 * CE CONTRAT N'AVAIT AUCUNE GARDE, et il était violé. La table `DETAIL` de
 * `config/factSources.ts` inlinait ses 28 précisions dans les quatre langues, au milieu de la
 * clôture statique : 6 676 octets de source, 2 828 gzippés, payés par tout le monde. Mesuré dans
 * le build livré, pas supposé — les chaînes espagnoles étaient bien dans le morceau d'entrée que
 * `dist/index.html` charge.
 *
 * POURQUOI LA GARDE EST ICI ET PAS DANS `pnpm budget:startup`. Le budget raisonne sur des
 * FICHIERS, et le compte des groupes exclusifs ne pouvait pas voir cette fuite : elle ne fait
 * apparaître aucun fichier de plus, elle grossit celui de l'entrée. Une fuite de langue se voit
 * à la SOURCE, dans la forme du littéral, et une garde de `pnpm verify` la voit sans build.
 *
 * LA RÈGLE. Dans un module livré, une clé de langue autre que l'anglais ne porte pas de PROSE.
 * Le seuil est la longueur : `'pt-BR': 'd'` est une abréviation d'unité dont la mise en
 * dictionnaire coûterait plus qu'elle n'économise, alors que `'raio equatorial no nível de
 * pressão de 1 bar'` est un texte qui a sa place dans `dict-pt-BR`.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Au-delà de cette longueur, une chaîne est de la PROSE. En dessous, c'est une abréviation ou un
 * code, et le dictionnaire coûterait plus que l'octet gagné.
 */
const PROSE_MIN_LENGTH = 12;

/**
 * Les modules livrés qui inlinent malgré tout de la prose en plusieurs langues, avec la raison
 * qui le justifie. Chacune est écrite DANS le module concerné : cette table la cite, elle ne
 * l'invente pas.
 */
const DECLARED: readonly { readonly file: string; readonly why: string }[] = [
  {
    file: 'i18n/locales.ts',
    why: "l'endonyme d'une langue (« Português (Brasil) ») nomme une langue que le visiteur n'a PAS chargée : le sélecteur doit pouvoir l'écrire avant elle.",
  },
  {
    file: 'ui/speedSlider.ts',
    why: "module PUR, testé langue par langue (`speedLabel(scale, 'es')` répond sans qu'aucune langue soit active) ; passer par `t()` lui rendrait un état global. Six chaînes, environ 150 octets.",
  },
];

function shippedModules(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = relative(ROOT, full).split('\\').join('/');
      if (BUILD_ONLY_DIRS.some((d) => rel === d || rel.startsWith(`${d}/`)))
        continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts') && !entry.name.includes('.test.'))
        out.push(rel);
    }
  };
  walk(ROOT);
  return out.sort();
}

/** Les chaînes de PROSE affectées à une clé de langue autre que l'anglais. */
function proseInOtherLanguages(rel: string): string[] {
  const source = readFileSync(join(ROOT, rel), 'utf-8');
  const found: string[] = [];
  for (const match of source.matchAll(
    /(?:^|[{,\s])('pt-BR'|fr|es)\s*:\s*(?:\n\s*)?'((?:[^'\\]|\\.)*)'/g
  ))
    if (match[2].length > PROSE_MIN_LENGTH) found.push(match[2]);
  return found;
}

describe('une langue inactive ne part pas avec le démarrage', () => {
  it('ne laisse AUCUN module livré inliner de la prose non anglaise', () => {
    const declared = new Set(DECLARED.map((d) => d.file));
    const leaking = shippedModules()
      .filter((rel) => !declared.has(rel))
      .map((rel) => ({ rel, prose: proseInOtherLanguages(rel) }))
      .filter((row) => row.prose.length > 0);
    expect(
      leaking.map(
        (row) => `${row.rel} (${row.prose.length}) : ${row.prose[0]}`
      ),
      "ces modules partent avec le démarrage et portent du texte qu'un visiteur sur quatre lit"
    ).toEqual([]);
  });

  it('n’autorise une exception que si elle EXISTE et qu’elle en est vraiment une', () => {
    // Une exception qui ne sert plus désarme la garde en silence, et une exception dont le
    // fichier a disparu est une ligne que personne ne relira jamais.
    const shipped = new Set(shippedModules());
    for (const entry of DECLARED) {
      expect(
        shipped.has(entry.file),
        `${entry.file} n'est plus un module livré`
      ).toBe(true);
      expect(
        proseInOtherLanguages(entry.file).length,
        `${entry.file} n'inline plus de prose : retirer son exception`
      ).toBeGreaterThan(0);
      expect(entry.why.length, entry.file).toBeGreaterThan(60);
    }
  });

  it('tient la parité : le texte déplacé est dans les QUATRE dictionnaires', () => {
    // Le compilateur le tient déjà (`MessageKey` dérive de `dict-en`), mais cette garde dit
    // POURQUOI ces clés existent, et rougirait si quelqu'un les rendait facultatives.
    const keys = (file: string): string[] =>
      [
        ...readFileSync(join(ROOT, `i18n/${file}`), 'utf-8').matchAll(
          /'(detail\.[A-Za-z0-9]+)':/g
        ),
      ].map((m) => m[1]);
    const reference = keys('dict-en.ts');
    expect(reference.length).toBeGreaterThanOrEqual(28);
    for (const file of ['dict-fr.ts', 'dict-es.ts', 'dict-pt-BR.ts'])
      expect(keys(file), file).toEqual(reference);
  });
});
