import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { bodyLandingPages } from './bodyLandingPage';
import { eclipseLandingPages } from './eclipseLandingPage';

/**
 * AUCUN TIRET CADRATIN DANS UN TEXTE PUBLIÉ.
 *
 * Décision de l'utilisateur (2026-09-16) : le tiret cadratin « — », et le demi-cadratin entouré
 * d'espaces « – », donnent l'allure d'un texte généré. On emploie deux-points, virgule,
 * parenthèses ou point. La règle existait, et le titre du site, les titres des 52 pages de corps,
 * les textes alternatifs de leurs vignettes, trois descriptions du catalogue, trois étapes de
 * visite guidée, la page de confidentialité et le marqueur de valeur inconnue de la fiche la
 * violaient encore le 2026-09-17 : une règle que rien ne vérifie finit ignorée.
 *
 * Périmètre : ce qu'un visiteur ou un lecteur du dépôt LIT. Les chaînes du code sont lues par
 * l'analyseur TypeScript, qui distingue un littéral d'un commentaire ; restent hors périmètre
 * les commentaires, le GLSL, les messages d'erreur et de console (destinés au développeur) et
 * les modules actifs seulement derrière un drapeau de débogage. Les plages non espacées
 * (« 2024–2035 ») sont une typographie correcte et restent permises.
 */

const ROOT = resolve(import.meta.dirname, '..', '..');
const FORBIDDEN = /—| – /;

/** Modules qui n'affichent rien sans `?debug-…` dans l'URL. */
const DEBUG_ONLY = new Set([
  'src/ui/earthDebug.ts',
  'src/ui/solarDebug.ts',
  'src/ui/meteoDebug.ts',
  'src/ui/terminatorProbe.ts',
]);

/** Appels dont l'argument s'adresse au développeur, pas au visiteur. */
const DEVELOPER_CALL =
  /^(console|Logger|C)\.(log|warn|error|info|debug|group)$/;

// `#include` ne commence pas par un caractère de mot : `\b` devant `#` ne correspond jamais.
const isGlsl = (text: string): boolean =>
  /\b(uniform|varying|gl_\w+|void main|vec[234])\b|#include\b|#ifdef\b/.test(
    text
  );

interface Offence {
  where: string;
  text: string;
}

/** Littéraux de chaîne publiés contenant un tiret interdit, dans un fichier TypeScript. */
export function offendingLiterals(file: string, source: string): Offence[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found: Offence[] = [];
  const visit = (node: ts.Node): void => {
    const isText =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node);
    if (isText && FORBIDDEN.test(node.text) && !isGlsl(node.text)) {
      let parent: ts.Node | undefined = node.parent;
      let developer = false;
      for (
        let depth = 0;
        depth < 5 && parent;
        depth++, parent = parent.parent
      ) {
        if (
          ts.isNewExpression(parent) &&
          /Error$/.test(parent.expression.getText())
        ) {
          developer = true;
          break;
        }
        if (
          ts.isCallExpression(parent) &&
          DEVELOPER_CALL.test(parent.expression.getText())
        ) {
          developer = true;
          break;
        }
      }
      if (!developer) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
        found.push({ where: `${file}:${line + 1}`, text: node.text });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** Texte d'un document HTML sans ses commentaires ni ses scripts exécutables. */
export function publishedHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script(?![^>]*ld\+json)[^>]*>[\s\S]*?<\/script>/g, '');
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'shaders') continue;
      out.push(...sourceFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts'))
      out.push(full);
  }
  return out;
}

const rel = (path: string): string => relative(ROOT, path).replace(/\\/g, '/');

describe('aucun tiret cadratin dans le texte publié', () => {
  it('dans les chaînes affichées par l’application et les pages générées', () => {
    const files = sourceFiles(resolve(ROOT, 'src')).filter(
      (file) => !DEBUG_ONLY.has(rel(file))
    );
    expect(files.length).toBeGreaterThan(100);
    const offences = [...files, resolve(ROOT, 'vite.config.ts')].flatMap(
      (file) => offendingLiterals(rel(file), readFileSync(file, 'utf-8'))
    );
    expect(
      offences.map((o) => `${o.where} « ${o.text.slice(0, 80)} »`),
      'remplacer par deux-points, virgule, parenthèses ou point'
    ).toEqual([]);
  });

  it('dans les documents HTML servis tels quels', () => {
    for (const file of ['index.html', 'public/privacy.html']) {
      const lines = publishedHtml(readFileSync(resolve(ROOT, file), 'utf-8'))
        .split('\n')
        .filter((line) => FORBIDDEN.test(line))
        .map((line) => line.trim());
      expect(lines, file).toEqual([]);
    }
  });

  it('dans les fichiers publics du dépôt', () => {
    for (const file of [
      'README.md',
      'CHANGELOG.md',
      'CITATION.cff',
      'THIRD_PARTY_NOTICES.md',
    ]) {
      const lines = readFileSync(resolve(ROOT, file), 'utf-8')
        .split(/\r?\n/)
        .filter((line) => FORBIDDEN.test(line));
      expect(lines, file).toEqual([]);
    }
  });

  it('dans le texte des pages de corps et d’éclipse, tel qu’il est rendu', () => {
    const pages = [
      ...bodyLandingPages(CELESTIAL_CONFIG, 'https://example.test'),
      ...eclipseLandingPages('https://example.test'),
    ];
    expect(pages.length).toBeGreaterThan(100);
    const offending = pages.flatMap((page) =>
      [
        page.title,
        page.description,
        page.heading,
        page.imageAlt,
        page.summary ?? '',
      ]
        .filter((text) => FORBIDDEN.test(text))
        .map((text) => `${page.canonical} « ${text} »`)
    );
    expect(offending).toEqual([]);
  });

  it('attrape vraiment un tiret, et laisse passer ce qui est hors périmètre', () => {
    // Falsification intégrée : un scanner cassé rendrait tout le reste vert.
    const sample = [
      "const a = { en: 'Jupiter — giant' };",
      'const b = `${name} – planet`;',
      '// commentaire — ignoré',
      "throw new Error('panne — pour le développeur');",
      "console.warn('trace — pour le développeur');",
      "const glsl = 'uniform vec3 uSun; // lumière — commentaire GLSL';",
      "const chunk = '#include <map_fragment> // fondu — GLSL';",
      "const range = 'Pages 2024–2035';",
    ].join('\n');
    expect(offendingLiterals('sample.ts', sample).map((o) => o.text)).toEqual([
      'Jupiter — giant',
      ' – planet',
    ]);
    expect(publishedHtml('<!-- a — b --><p>ok</p>')).not.toMatch(FORBIDDEN);
    expect(publishedHtml('<title>A — B</title>')).toMatch(FORBIDDEN);
  });
});
