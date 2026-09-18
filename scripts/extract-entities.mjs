#!/usr/bin/env node
/* global console, process */
/**
 * MIGRATION DU LOT 7 (phase 3) : écrit `src/registry/entities/*.json` depuis les littéraux
 * TypeScript de `src/config/bodies.ts` et `src/config/smallBodies.ts`, par leur AST.
 *
 * Aucune valeur n'est recopiée à la main : chaque expression est traduite dans la forme déclarée
 * que `src/registry/load.ts` sait évaluer (`7.25 * D2R` → `{"$deg": 7.25}`), et une forme inconnue
 * ARRÊTE le script. Les commentaires du catalogue, qui portent la provenance et les pièges, sont
 * rangés dans le champ `notes` de chaque fiche (retiré du bundle client à l'import) ; le script
 * compte ceux qu'il a vus et ceux qu'il a rangés, et refuse d'en perdre un.
 *
 * Outil de migration, à usage unique : une fois la bascule faite, les littéraux n'existent plus
 * et ce script n'a plus rien à lire. Il reste dans l'historique git comme trace de la migration.
 *
 * Usage : node scripts/extract-entities.mjs
 */
import ts from 'typescript';
import { Body } from 'astronomy-engine';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const OUT = resolve(ROOT, 'src/registry/entities');

const FACT_ORDER = [
  'radiusKm',
  'massKg',
  'gravity',
  'meanTempC',
  'moonCount',
  'axialTilt',
  'distanceAU',
  'orbitPeriodDays',
  'rotationPeriod',
];
/** Champs de `realData` qui sont des FAITS (leur valeur rejoint l'objet du fait). */
const CATALOGUE_FACT_VALUES = new Set(
  FACT_ORDER.filter((f) => f !== 'rotationPeriod')
);
/** Champs des éléments d'un petit corps qui sont des faits, et le fait qu'ils portent. */
const SMALL_BODY_FACT_VALUES = {
  radiusKm: 'radiusKm',
  massKg: 'massKg',
  gravity: 'gravity',
  meanTempC: 'meanTempC',
  moonCount: 'moonCount',
  axialTiltDeg: 'axialTilt',
  rotationHours: 'rotationPeriod',
};
const COLOR_KEYS = new Set([
  'orbitalColor',
  'fallbackColor',
  'atmosphereColor',
  'color',
]);
const TARGET_CLASS = {
  star: 'star',
  planet: 'planet',
  moon: 'satellite',
  skybox: 'sky',
  dwarf: 'dwarf_planet',
  asteroid: 'asteroid',
  comet: 'comet',
};

let commentsSeen = 0;
let commentsFiled = 0;

function load(file) {
  const text = readFileSync(resolve(ROOT, file), 'utf-8');
  return {
    text,
    src: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true),
  };
}

/** Texte d'un commentaire, sans ses marqueurs. */
function commentText(raw) {
  if (raw.startsWith('//')) return raw.replace(/^\/\/\s?/, '').trim();
  return raw
    .replace(/^\/\*+/, '')
    .replace(/\*+\/$/, '')
    .split('\n')
    .map((l) => l.replace(/^\s*\*\s?/, '').trim())
    .filter(Boolean)
    .join(' ');
}

/**
 * Range chaque commentaire d'un littéral objet sous la propriété qu'il documente : un
 * commentaire qui partage la ligne de la propriété PRÉCÉDENTE lui appartient, sinon il précède
 * la suivante. Ceux d'après la dernière propriété vont à l'objet lui-même (`…$end`).
 */
function collectNotes(ctx, obj, path, notes) {
  const { text, src } = ctx;
  const line = (pos) => src.getLineAndCharacterOfPosition(pos).line;
  const add = (key, raw) => {
    commentsFiled++;
    const t = commentText(raw);
    notes[key] = notes[key] ? `${notes[key]} ${t}` : t;
  };
  let previous = null;
  for (const prop of obj.properties) {
    const ranges = ts.getLeadingCommentRanges(text, prop.getFullStart()) ?? [];
    for (const r of ranges) {
      const raw = text.slice(r.pos, r.end);
      if (previous && line(r.pos) === line(previous.getEnd()))
        add(`${path}${previous.name.getText(src)}`, raw);
      else add(`${path}${prop.name?.getText(src) ?? '$spread'}`, raw);
    }
    previous = prop;
  }
  const close = obj.getLastToken(src);
  for (const r of ts.getLeadingCommentRanges(text, close.getFullStart()) ??
    []) {
    const raw = text.slice(r.pos, r.end);
    if (previous && line(r.pos) === line(previous.getEnd()))
      add(`${path}${previous.name.getText(src)}`, raw);
    else add(`${path}$end`, raw);
  }
}

/** Compte les commentaires d'une portée, par le scanner : l'étalon de `commentsFiled`. */
function countComments(ctx, node) {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    ctx.text.slice(node.getStart(ctx.src), node.getEnd())
  );
  let n = 0;
  for (
    let k = scanner.scan();
    k !== ts.SyntaxKind.EndOfFileToken;
    k = scanner.scan()
  )
    if (
      k === ts.SyntaxKind.SingleLineCommentTrivia ||
      k === ts.SyntaxKind.MultiLineCommentTrivia
    )
      n++;
  return n;
}

const fail = (ctx, node, why) => {
  const { line } = ctx.src.getLineAndCharacterOfPosition(
    node.getStart(ctx.src)
  );
  throw new Error(
    `${ctx.src.fileName}:${line + 1} : ${why} : ${node.getText(ctx.src).slice(0, 80)}`
  );
};

const unwrap = (n) =>
  ts.isParenthesizedExpression(n) ? unwrap(n.expression) : n;
const isNum = (n) => ts.isNumericLiteral(unwrap(n));
const numOf = (n) => Number(unwrap(n).getText().replace(/_/g, ''));
const callee = (n) =>
  ts.isCallExpression(n) && ts.isIdentifier(n.expression)
    ? n.expression.text
    : null;

/** Une expression numérique du catalogue → sa forme déclarée. */
function encodeValue(ctx, node, key) {
  const n = unwrap(node);
  if (ts.isNumericLiteral(n)) {
    const raw = n.getText(ctx.src);
    if (/^0x/i.test(raw)) {
      if (!COLOR_KEYS.has(key))
        fail(ctx, n, `hexadécimal hors d'un champ couleur (${key})`);
      return `0x${Number(raw).toString(16).padStart(6, '0')}`;
    }
    return numOf(n);
  }
  if (
    ts.isPrefixUnaryExpression(n) &&
    n.operator === ts.SyntaxKind.MinusToken
  ) {
    const inner = unwrap(n.operand);
    if (ts.isNumericLiteral(inner)) return -numOf(inner);
    if (callee(inner) === '_R')
      return {
        $rotationHours: encodeValue(ctx, inner.arguments[0], ''),
        $retrograde: true,
      };
    fail(ctx, n, 'négation non reconnue');
  }
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))
    return n.text;
  if (n.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (n.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (n.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(n))
    return n.elements.map((e) => encodeValue(ctx, e, key));
  if (ts.isBinaryExpression(n)) {
    const op = n.operatorToken.kind;
    const L = unwrap(n.left);
    const R = unwrap(n.right);
    if (
      op === ts.SyntaxKind.AsteriskToken &&
      ts.isIdentifier(R) &&
      R.text === 'D2R'
    )
      return { $deg: encodeValue(ctx, L, '') };
    if (
      op === ts.SyntaxKind.AsteriskToken &&
      isNum(R) &&
      numOf(R) === 24 &&
      isNum(L)
    )
      return { $days: numOf(L) };
    if (
      op === ts.SyntaxKind.AsteriskToken &&
      key === 'uncertainty' &&
      isNum(L) &&
      isNum(R)
    )
      return { $fraction: numOf(L), $of: numOf(R) };
    if (
      op === ts.SyntaxKind.SlashToken &&
      isNum(R) &&
      numOf(R) === 2 &&
      isNum(L)
    )
      return { $diameterKm: numOf(L) };
    if (
      op === ts.SyntaxKind.MinusToken &&
      isNum(R) &&
      numOf(R) === 273.15 &&
      isNum(L)
    )
      return { $kelvin: numOf(L) };
    // (Math.PI * 2) / (x * 86_400)  |  (Math.PI * 2) / (x * 24 * 3_600)
    if (
      op === ts.SyntaxKind.SlashToken &&
      L.getText(ctx.src) === 'Math.PI * 2' &&
      ts.isBinaryExpression(R)
    ) {
      const Rl = unwrap(R.left);
      if (isNum(R.right) && numOf(R.right) === 86_400 && isNum(Rl))
        return { $spinPeriodDays: numOf(Rl) };
      // (Math.PI * 2) / (h * 3_600) : exactement `_R(h)`.
      if (isNum(R.right) && numOf(R.right) === 3_600 && isNum(Rl))
        return { $rotationHours: numOf(Rl) };
      if (
        isNum(R.right) &&
        numOf(R.right) === 3_600 &&
        ts.isBinaryExpression(Rl) &&
        isNum(Rl.right) &&
        numOf(Rl.right) === 24 &&
        isNum(Rl.left)
      )
        return { $rotationHours: { $days: numOf(Rl.left) } };
    }
    fail(ctx, n, 'expression binaire non reconnue');
  }
  const c = callee(n);
  if (c) {
    const a = n.arguments.map((x) => encodeValue(ctx, x, ''));
    const want = (k) => {
      if (a.length !== k) fail(ctx, n, `${c} attend ${k} argument(s)`);
    };
    switch (c) {
      case '_R':
        want(1);
        return { $rotationHours: a[0] };
      case 'kmToAu':
        want(1);
        return { $km: a[0] };
      case 'massFromGM':
        want(1);
        return { $gm: a[0] };
      case 'gravityFromGM':
        want(2);
        return { $gm: a[0], $radiusKm: a[1] };
      case 'massFromDensity':
        want(2);
        return { $density: a[0], $radiusKm: a[1] };
      case 'gravityFromMass':
        want(2);
        return { $massKg: a[0], $radiusKm: a[1] };
      case 'exploCameraDistance':
        want(1);
        return { $cameraFromRadiusKm: a[0] };
      default:
        fail(ctx, n, `appel non déclaré ${c}`);
    }
  }
  if (ts.isNewExpression(n) && n.expression.getText(ctx.src) === 'Date') {
    const [arg] = n.arguments;
    if (!arg || !ts.isStringLiteral(arg))
      fail(ctx, n, 'new Date attend une chaîne ISO');
    return { $date: arg.text };
  }
  if (
    ts.isPropertyAccessExpression(n) &&
    n.expression.getText(ctx.src) === 'Body'
  ) {
    const name = n.name.text;
    if (Body[name] !== name)
      fail(ctx, n, `Body.${name} n'est pas une chaîne égale à son nom`);
    return name;
  }
  if (ts.isObjectLiteralExpression(n)) return encodeObject(ctx, n, key, '', {});
  fail(ctx, n, 'forme non reconnue');
}

/** Un objet de données ordinaire, clé par clé, ordre conservé. */
function encodeObject(ctx, obj, _key, path, notes) {
  if (path) collectNotes(ctx, obj, path, notes);
  const out = {};
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop))
      fail(ctx, prop, 'propriété non littérale');
    const k = ts.isStringLiteral(prop.name)
      ? prop.name.text
      : prop.name.getText(ctx.src);
    const v = unwrap(prop.initializer);
    out[k] = ts.isObjectLiteralExpression(v)
      ? encodeObject(ctx, v, k, path ? `${path}${k}.` : '', notes)
      : encodeValue(ctx, v, k);
  }
  return out;
}

/** `measured('src', {…})` / `derived(…)` → morceau de fait. */
function encodeProvenance(ctx, call) {
  const c = callee(call);
  if (c !== 'measured' && c !== 'derived')
    fail(ctx, call, 'provenance attendue (measured/derived)');
  const [src, extra] = call.arguments;
  if (!ts.isStringLiteral(src))
    fail(ctx, call, 'identifiant de source littéral attendu');
  const out = { source: src.text, method: c };
  if (extra) {
    if (!ts.isObjectLiteralExpression(extra))
      fail(ctx, extra, 'options littérales attendues');
    for (const p of extra.properties) {
      const k = p.name.getText(ctx.src);
      const v = unwrap(p.initializer);
      if (k === 'detail') {
        if (
          ts.isPropertyAccessExpression(v) &&
          v.expression.getText(ctx.src) === 'DETAIL'
        )
          out.detail = v.name.text;
        else if (ts.isObjectLiteralExpression(v))
          out.detail = encodeObject(ctx, v, k, '', {});
        else fail(ctx, v, 'précision non reconnue');
      } else if (k === 'uncertainty') out.uncertainty = encodeValue(ctx, v, k);
      else if (k === 'asOf' || k === 'citation') {
        if (!ts.isStringLiteral(v)) fail(ctx, v, `${k} littéral attendu`);
        out[k] = v.text;
      } else fail(ctx, p, `option de provenance inconnue ${k}`);
    }
  }
  return out;
}

function encodeReason(ctx, node) {
  const v = unwrap(node);
  if (ts.isIdentifier(v) && v.text === 'NOT_YET_SOURCED')
    return 'not-yet-sourced';
  if (ts.isObjectLiteralExpression(v)) return encodeObject(ctx, v, '', '', {});
  fail(ctx, v, 'raison de non-publication non reconnue');
}

/** Ajoute un morceau à l'objet d'un fait, en refusant les doublons. */
function putFact(ctx, node, facts, field, part) {
  const entry = (facts[field] ??= {});
  for (const [k, v] of Object.entries(part)) {
    if (k in entry) fail(ctx, node, `fait ${field} : ${k} déclaré deux fois`);
    entry[k] = v;
  }
}

/** Ordre canonique des clés d'un fait, pour des fiches qui se lisent toutes pareil. */
function sortFacts(facts) {
  const KEY_ORDER = [
    'value',
    'source',
    'method',
    'asOf',
    'uncertainty',
    'detail',
    'citation',
    'published',
    'reason',
  ];
  const out = {};
  for (const field of FACT_ORDER) {
    if (!facts[field]) continue;
    const entry = {};
    for (const k of KEY_ORDER)
      if (k in facts[field]) entry[k] = facts[field][k];
    for (const k of Object.keys(facts[field]))
      if (!KEY_ORDER.includes(k)) throw new Error(`clé de fait inconnue ${k}`);
    out[field] = entry;
  }
  for (const f of Object.keys(facts))
    if (!FACT_ORDER.includes(f)) throw new Error(`fait inconnu ${f}`);
  return out;
}

const entities = [];

/** Les notes d'un chemin de fait (`realData.sources.radiusKm`…) vont au fait. */
function refileFactNotes(notes, rules) {
  const out = {};
  for (const [path, text] of Object.entries(notes)) {
    let target = path;
    for (const [re, to] of rules) {
      const m = re.exec(path);
      if (m) {
        target = to(m);
        break;
      }
    }
    out[target] = out[target] ? `${out[target]} ${text}` : text;
  }
  return out;
}

function catalogueEntity(ctx, id, obj, leadingNotes) {
  const notes = { ...leadingNotes };
  collectNotes(ctx, obj, '', notes);
  const config = {};
  const facts = {};
  let kind = null;
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop))
      fail(ctx, prop, 'propriété non littérale');
    const k = prop.name.getText(ctx.src);
    const v = unwrap(prop.initializer);
    if (k === 'kind') kind = v.text;
    if (k === 'satellites') {
      if (!ts.isObjectLiteralExpression(v))
        fail(ctx, v, 'satellites littéraux attendus');
      const ids = [];
      const sat = {};
      collectNotes(ctx, v, '', sat);
      for (const child of v.properties) {
        const cid = child.name.getText(ctx.src);
        ids.push(cid);
        const own = sat[cid] ? { '': sat[cid] } : {};
        catalogueEntity(ctx, cid, unwrap(child.initializer), own);
      }
      if (sat.$end) notes['satellites.$end'] = sat.$end;
      config.satellites = ids;
      continue;
    }
    if (k === 'realData') {
      if (!ts.isObjectLiteralExpression(v))
        fail(ctx, v, 'realData littéral attendu');
      collectNotes(ctx, v, 'realData.', notes);
      const rest = {};
      for (const p of v.properties) {
        const rk = p.name.getText(ctx.src);
        const rv = unwrap(p.initializer);
        if (rk === 'sources') {
          collectNotes(ctx, rv, 'realData.sources.', notes);
          for (const s of rv.properties)
            putFact(
              ctx,
              s,
              facts,
              s.name.getText(ctx.src),
              encodeProvenance(ctx, unwrap(s.initializer))
            );
        } else if (rk === 'unknown') {
          collectNotes(ctx, rv, 'realData.unknown.', notes);
          for (const u of rv.properties)
            putFact(ctx, u, facts, u.name.getText(ctx.src), {
              published: false,
              reason: encodeReason(ctx, u.initializer),
            });
        } else if (CATALOGUE_FACT_VALUES.has(rk)) {
          putFact(ctx, p, facts, rk, { value: encodeValue(ctx, rv, rk) });
        } else {
          rest[rk] = ts.isObjectLiteralExpression(rv)
            ? encodeObject(ctx, rv, rk, `realData.${rk}.`, notes)
            : encodeValue(ctx, rv, rk);
        }
      }
      config.realData = rest;
      continue;
    }
    config[k] = ts.isObjectLiteralExpression(v)
      ? encodeObject(ctx, v, k, `${k}.`, notes)
      : encodeValue(ctx, v, k);
  }
  if (!TARGET_CLASS[kind]) fail(ctx, obj, `kind inconnu ${kind}`);
  entities.push({
    $schema: '../schema/entity.schema.json',
    id,
    targetClass: TARGET_CLASS[kind],
    source: 'catalogue',
    config,
    ...(Object.keys(facts).length ? { facts: sortFacts(facts) } : {}),
    ...notesField(
      refileFactNotes(notes, [
        [/^realData\.(sources|unknown)\.([A-Za-z]+)$/, (m) => `facts.${m[2]}`],
        [
          /^realData\.([A-Za-z]+)$/,
          (m) => (CATALOGUE_FACT_VALUES.has(m[1]) ? `facts.${m[1]}` : m[0]),
        ],
      ])
    ),
  });
}

const notesField = (notes) => (Object.keys(notes).length ? { notes } : {});

function smallBodyEntity(ctx, obj, leadingNotes) {
  const notes = { ...leadingNotes };
  collectNotes(ctx, obj, '', notes);
  const elements = {};
  const facts = {};
  let id = null;
  let kind = 'asteroid';
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop))
      fail(ctx, prop, 'propriété non littérale');
    const k = prop.name.getText(ctx.src);
    const v = unwrap(prop.initializer);
    if (k === 'name') {
      id = v.text;
      continue;
    }
    if (k === 'kind') kind = v.text;
    if (k === 'satellites') {
      const ids = [];
      const sat = {};
      collectNotes(ctx, v, '', sat);
      for (const child of v.properties) {
        const cid = child.name.getText(ctx.src);
        ids.push(cid);
        catalogueEntity(
          ctx,
          cid,
          unwrap(child.initializer),
          sat[cid] ? { '': sat[cid] } : {}
        );
      }
      if (sat.$end) notes['satellites.$end'] = sat.$end;
      elements.satellites = ids;
      continue;
    }
    if (k === 'sources') {
      collectNotes(ctx, v, 'sources.', notes);
      for (const s of v.properties)
        putFact(
          ctx,
          s,
          facts,
          s.name.getText(ctx.src),
          encodeProvenance(ctx, unwrap(s.initializer))
        );
      continue;
    }
    if (k === 'unknown') {
      collectNotes(ctx, v, 'unknown.', notes);
      for (const u of v.properties)
        putFact(ctx, u, facts, u.name.getText(ctx.src), {
          published: false,
          reason: encodeReason(ctx, u.initializer),
        });
      continue;
    }
    if (k in SMALL_BODY_FACT_VALUES) {
      putFact(ctx, prop, facts, SMALL_BODY_FACT_VALUES[k], {
        value: encodeValue(ctx, v, k),
      });
      continue;
    }
    elements[k] = ts.isObjectLiteralExpression(v)
      ? encodeObject(ctx, v, k, `${k}.`, notes)
      : encodeValue(ctx, v, k);
  }
  if (!id) fail(ctx, obj, 'petit corps sans name');
  entities.push({
    $schema: '../schema/entity.schema.json',
    id,
    targetClass: TARGET_CLASS[kind],
    source: 'small-body',
    elements,
    ...(Object.keys(facts).length ? { facts: sortFacts(facts) } : {}),
    ...notesField(
      refileFactNotes(notes, [
        [/^(sources|unknown)\.([A-Za-z]+)$/, (m) => `facts.${m[2]}`],
        [
          /^([A-Za-z]+)$/,
          (m) =>
            m[1] in SMALL_BODY_FACT_VALUES
              ? `facts.${SMALL_BODY_FACT_VALUES[m[1]]}`
              : m[0],
        ],
      ])
    ),
  });
  return id;
}

// ── bodies.ts ──
const bodies = load('src/config/bodies.ts');
let catalogueNode = null;
ts.forEachChild(bodies.src, function find(n) {
  if (
    ts.isVariableDeclaration(n) &&
    n.name.getText(bodies.src) === 'CELESTIAL_CONFIG'
  )
    catalogueNode = n.initializer;
  ts.forEachChild(n, find);
});
const bodiesObj = catalogueNode.properties.find(
  (p) => p.name?.getText(bodies.src) === 'bodies'
).initializer;
commentsSeen += countComments(bodies, bodiesObj);
const top = {};
collectNotes(bodies, bodiesObj, '', top);
const order = [];
for (const prop of bodiesObj.properties) {
  if (ts.isSpreadAssignment(prop)) {
    if (prop.expression.getText(bodies.src) !== 'SMALL_BODIES')
      fail(bodies, prop, 'spread inattendu');
    continue;
  }
  const id = prop.name.getText(bodies.src);
  order.push(id);
  catalogueEntity(
    bodies,
    id,
    unwrap(prop.initializer),
    top[id] ? { '': top[id] } : {}
  );
}
// Le commentaire qui introduit la fusion des petits corps décrit la STRUCTURE, pas un corps.
const structural = top.$spread ?? '';

// ── smallBodies.ts ──
const small = load('src/config/smallBodies.ts');
let elementsNode = null;
ts.forEachChild(small.src, function find(n) {
  if (
    ts.isVariableDeclaration(n) &&
    n.name.getText(small.src) === 'SMALL_BODY_ELEMENTS'
  )
    elementsNode = n.initializer;
  ts.forEachChild(n, find);
});
commentsSeen += countComments(small, elementsNode);
for (const el of elementsNode.elements) {
  const ranges =
    ts.getLeadingCommentRanges(small.text, el.getFullStart()) ?? [];
  const lead = {};
  for (const r of ranges) {
    commentsFiled++;
    const t = commentText(small.text.slice(r.pos, r.end));
    lead[''] = lead[''] ? `${lead['']} ${t}` : t;
  }
  order.push(smallBodyEntity(small, unwrap(el), lead));
}
// Commentaires après le dernier élément du tableau.
for (const r of ts.getLeadingCommentRanges(
  small.text,
  elementsNode.getLastToken(small.src).getFullStart()
) ?? []) {
  commentsFiled++;
  console.warn(
    `commentaire de fin de tableau, rangé nulle part : ${commentText(small.text.slice(r.pos, r.end)).slice(0, 80)}`
  );
}

if (commentsFiled !== commentsSeen)
  throw new Error(
    `commentaires : ${commentsSeen} vus, ${commentsFiled} rangés. Aucun ne doit se perdre.`
  );

// Ne supprime que les fiches JSON : le dossier contient aussi `index.ts` et
// `entities.test.ts`. Un premier `rmSync` du dossier entier les a effacés, et le commit est
// parti sans eux (rectifié dans le commit suivant) : ne jamais revenir à cette forme.
mkdirSync(OUT, { recursive: true });
for (const name of readdirSync(OUT))
  if (name.endsWith('.json')) rmSync(resolve(OUT, name));
for (const e of entities)
  writeFileSync(
    resolve(OUT, `${e.id}.json`),
    `${JSON.stringify(e, null, 2)}\n`,
    'utf-8'
  );
writeFileSync(
  resolve(OUT, 'order.json'),
  `${JSON.stringify({ $comment: structural || undefined, order }, null, 2)}\n`,
  'utf-8'
);
console.log(
  `${entities.length} fiches écrites (${order.length} au premier niveau), ${commentsFiled}/${commentsSeen} commentaires rangés`
);
