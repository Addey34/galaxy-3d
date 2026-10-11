import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { stripGlslComments, stripPiece } from './glslComments';

/**
 * LE RETRAIT DES COMMENTAIRES GLSL (2026-10-11) : sur des cas écrits, puis sur TOUS les shaders
 * du dépôt, confrontés à une seconde méthode indépendante.
 */

describe('stripPiece', () => {
  it('retire les commentaires de ligne et de bloc, garde chaque fin de ligne', () => {
    const raw =
      '\n  // le pourquoi\n  float a = 1.0; // la mesure\n  /* deux\n lignes */ a *= 2.0;\n';
    const out = stripPiece(raw);
    expect(out).toBe('\n\nfloat a = 1.0;\n\na *= 2.0;\n');
    expect(out.split('\n')).toHaveLength(raw.split('\n').length);
  });

  it('laisse un commentaire qui court jusqu’à une expression', () => {
    // `// valeur ${x}` : le retirer collerait la valeur de x au code GLSL.
    expect(stripPiece('\n  float a; // valeur ')).toBe('\nfloat a; // valeur ');
    expect(stripPiece('\n  float a; /* ouvert ')).toBe('\nfloat a; /* ouvert ');
  });
});

describe('stripGlslComments', () => {
  it('ne touche ni à un gabarit sans GLSL, ni à une expression', () => {
    const code = [
      'const url = `https://example.org // pas un commentaire`;',
      'const shader = `uniform float k; // à retirer',
      '  void main() { gl_FragColor = vec4(${value /* garde-moi */}); }`;',
    ].join('\n');
    const out = stripGlslComments(code)!;
    expect(out).toContain('`https://example.org // pas un commentaire`');
    expect(out).toContain('${value /* garde-moi */}');
    expect(out).not.toContain('à retirer');
    expect(out.split('\n')).toHaveLength(code.split('\n').length);
  });

  it('rend null quand il n’y a rien à faire', () => {
    expect(stripGlslComments('const a = `texte`;')).toBeNull();
  });
});

/** Tous les fichiers de `src/` qui portent un gabarit GLSL. */
function sourcesWithShaders(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out.push(path);
    }
  };
  walk(join(process.cwd(), 'src'));
  return out.filter(
    (path) => stripGlslComments(readFileSync(path, 'utf8'), path) !== null
  );
}

/**
 * Le GLSL d'un fichier, comme une suite de JETONS : le texte littéral des gabarits, les
 * commentaires retirés par une expression régulière (méthode indépendante de celle testée),
 * puis découpé sur les blancs. Le retrait ne doit changer AUCUN jeton.
 */
function glslTokens(code: string): string[] {
  const sf = ts.createSourceFile('m.ts', code, ts.ScriptTarget.Latest, true);
  const tokens: string[] = [];
  const visit = (node: ts.Node): void => {
    const pieces = ts.isNoSubstitutionTemplateLiteral(node)
      ? [node.rawText ?? '']
      : ts.isTemplateExpression(node)
        ? [
            node.head.rawText ?? '',
            ...node.templateSpans.map((s) => s.literal.rawText ?? ''),
          ]
        : null;
    if (pieces)
      for (const raw of pieces)
        tokens.push(
          ...raw
            .replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/\/\/[^\n]*\n/g, '\n')
            .split(/\s+/)
            .filter(Boolean),
          '|'
        );
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return tokens;
}

describe('les shaders du dépôt', () => {
  const files = sourcesWithShaders();

  it('en trouve, et chacun compile encore', () => {
    // Quatre au 2026-10-11 : layerConfig, GlowPass, AtmosphereShader, NightLightsShader.
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const path of files) {
      const out = stripGlslComments(readFileSync(path, 'utf8'), path)!;
      const { diagnostics } = ts.transpileModule(out, {
        reportDiagnostics: true,
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      });
      expect(diagnostics ?? [], relative(process.cwd(), path)).toHaveLength(0);
    }
  });

  it('ne change aucun jeton GLSL, ni aucune ligne', () => {
    for (const path of files) {
      const code = readFileSync(path, 'utf8');
      const out = stripGlslComments(code, path)!;
      const name = relative(process.cwd(), path);
      expect(glslTokens(out), name).toEqual(glslTokens(code));
      expect(out.split('\n').length, name).toBe(code.split('\n').length);
      // Et le code JavaScript HORS des gabarits est intact.
      expect(out.replace(/`[^`]*`/g, '``'), name).toBe(
        code.replace(/`[^`]*`/g, '``')
      );
    }
  });

  it('est idempotent', () => {
    for (const path of files) {
      const once = stripGlslComments(readFileSync(path, 'utf8'), path)!;
      expect(stripGlslComments(once, path) ?? once).toBe(once);
    }
  });
});
