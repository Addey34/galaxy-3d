/* global console, process, setTimeout, document, navigator, innerWidth, innerHeight, HTMLElement */
// Les globals du NAVIGATEUR ci-dessus ne sont pas une facilité : les rappels passés à
// `page.evaluate` sont sérialisés puis exécutés DANS la page, pas dans Node. C'est la même
// convention que les autres scripts du dépôt (cf. `scripts/audit-textures.mjs`).
/**
 * LA PASSE LECTEUR D'ÉCRAN, CAPTURÉE PLUTÔT QUE RACONTÉE (lot 19).
 *
 * `pnpm test:a11y` (axe-core) vérifie des RÈGLES et attrape 30 à 50 % des problèmes réels ;
 * `e2e/a11y-tree.spec.ts` lit l'arbre d'accessibilité calculé par Chromium, donc les noms et
 * les états. Ni l'un ni l'autre ne dit ce qu'un lecteur d'écran ÉNONCE, ni dans quel ordre, ni
 * où part le focus. C'est exactement ce que ce script mesure, et il le mesure pour de vrai :
 * NVDA tourne, en muet, et écrit chaque énoncé dans son journal.
 *
 * LE POINT QUI DÉCIDE DE TOUT : NVDA pose un crochet clavier au niveau du SYSTÈME. Les frappes
 * injectées par CDP (`page.keyboard`) ne passent jamais par ce crochet, donc NVDA ne les voit
 * pas et le mode navigation ne réagit pas. Les touches sont donc envoyées par `SendInput`
 * (`scripts/send-keys.ps1`), tandis que CDP ne sert qu'à OBSERVER (focus réel, taille de la
 * fenêtre, préparation de l'état). Les deux moitiés sont indispensables et ne se remplacent pas.
 *
 * Ce qui est mesuré : la suite ordonnée des énoncés, appariée à l'élément qui a réellement le
 * focus après chaque touche. Cet APPARIEMENT est le vrai apport : il montre un focus qui bouge
 * sans que rien ne soit annoncé, et un énoncé qui ne correspond pas à l'endroit où l'on est.
 *
 * Ce qui n'est PAS mesuré, et qui reste dû à une écoute humaine : le ressenti, la verbosité
 * supportable, la prononciation, et le comportement d'un AUTRE lecteur d'écran (VoiceOver,
 * JAWS) dont les heuristiques diffèrent.
 *
 * Prérequis : la copie portable de NVDA (`scripts/nvda-session.mjs`), un Chrome lancé avec
 * `--remote-debugging-port=9222 --user-data-dir=C:\a11y\cp`, et l'application servie.
 *
 * Usage :
 *   node scripts/capture-screenreader.mjs --locale fr --width 1280 --scenario palette
 *   node scripts/capture-screenreader.mjs --locale en --width 390            (tous les scénarios)
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');

const NVDA_LOG = 'C:/a11y/logs/nvda.log';
const SEND_KEYS = resolve(import.meta.dirname, 'send-keys.ps1');
const CDP = process.env.GALAXY_CDP ?? 'http://localhost:9222';
const APP = process.env.GALAXY_APP ?? 'http://localhost:4173/';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Le parseur d'énoncés vit dans `src/core/speechTranscript.ts`, PUR et tenu par des tests :
// une mesure fausse est pire qu'une mesure absente, et le premier parseur écrit pour cette
// passe accusait l'application d'un défaut qui était le sien. Chargé par Vite, comme
// `scripts/check-startup-budget.mjs` charge `core/startupBudget.ts`.
const vite = await (
  await import('vite')
).createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});
const { extractSpeech } = await vite.ssrLoadModule(
  '/src/core/speechTranscript.ts'
);

// ─────────────────────────────────────────────────────────────────────────────
// Lecture du journal de NVDA
// ─────────────────────────────────────────────────────────────────────────────

class SpeechLog {
  constructor(path) {
    this.path = path;
    this.offset = this.size();
  }
  size() {
    try {
      return statSync(this.path).size;
    } catch {
      return 0;
    }
  }
  /** Les séquences énoncées depuis le dernier appel. */
  drain(pageLang) {
    const size = this.size();
    if (size <= this.offset) {
      this.offset = size;
      return [];
    }
    const buffer = readFileSync(this.path);
    const chunk = buffer.subarray(this.offset, size).toString('utf8');
    this.offset = size;
    return extractSpeech(chunk, pageLang);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Frappes réelles et observation du focus
// ─────────────────────────────────────────────────────────────────────────────

function sendKeys(keys) {
  // `send-keys.ps1` REFUSE d'envoyer si la fenêtre au premier plan n'est pas celle du banc.
  // Sans cette garde, une capture taperait dans la fenêtre de quelqu'un d'autre, et surtout
  // elle relèverait les énoncés d'une AUTRE application en les attribuant à celle-ci.
  //
  // Une console passagère (un `ping`, une tâche planifiée) peut voler le premier plan une
  // seconde. On réessaie donc, mais on n'abandonne JAMAIS la garde : mieux vaut une capture
  // qui s'arrête qu'une capture qui attribue à cette application les énoncés d'une autre.
  let output = '';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const result = runPowerShell(['-File', SEND_KEYS, '-Keys', keys]);
    output = result.text;
    if (result.status === 0 && output.startsWith('OK')) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 900);
  }
  throw new Error(`frappe refusée (${keys}) : ${output}`);
}

/**
 * `windowsHide` n'est PAS un détail de confort ici. Sans lui, Node ouvre une console pour
 * chaque appel, et cette console prend le premier plan une fraction de seconde : la garde de
 * `send-keys.ps1` refusait alors des frappes légitimes, et surtout le focus du banc sautait
 * entre deux touches, ce qui fabriquait un faux « ordre de tabulation ». Un banc qui perturbe
 * ce qu'il mesure ne mesure rien.
 */
function runPowerShell(args) {
  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args],
    { encoding: 'utf8', windowsHide: true }
  );
  return {
    status: result.status,
    text: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
  };
}

/** Le titre de la fenêtre au premier plan, pour savoir si la mesure est attribuable. */
function foregroundTitle() {
  return runPowerShell(['-File', SEND_KEYS, '-FocusOnly', '-ReportOnly']).text;
}

/** Ce qui a RÉELLEMENT le focus, décrit comme un humain le désignerait. */
const describeFocus = (page) =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body)
      return 'document.body (aucun élément focalisé)';
    const id = el.id ? `#${el.id}` : '';
    const cls =
      el.className && typeof el.className === 'string'
        ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
        : '';
    const name =
      el.getAttribute('aria-label') ??
      (el.getAttribute('aria-labelledby')
        ? document
            .getElementById(el.getAttribute('aria-labelledby'))
            ?.textContent?.trim()
        : null) ??
      el.textContent?.trim().slice(0, 40) ??
      '';
    const host = el.closest('[role="dialog"]');
    const inDialog = host
      ? ` [dans ${host.id ? '#' + host.id : '.' + host.className.split(/\s+/)[0]}]`
      : '';
    return `${el.tagName.toLowerCase()}${id}${cls} « ${name} »${inDialog}`;
  });

// ─────────────────────────────────────────────────────────────────────────────
// Le banc
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Le journal de NVDA est GLOBAL : il porte aussi ce qu'une autre fenêtre fait annoncer pendant
 * la capture (une région live, un message qui s'insère). Ces énoncés n'appartiennent pas à
 * l'application et les attribuer serait une mesure fausse.
 *
 * On ne les SUPPRIME pas — supprimer une donnée qu'on ne comprend pas est la meilleure façon de
 * perdre un vrai défaut. On les MARQUE, avec une règle explicite : une séquence dont la plus
 * longue partie dépasse 25 caractères et ne se retrouve nulle part dans le texte de la page est
 * marquée « hors application ». Le seuil existe parce que les mots de rôle de NVDA
 * (« bouton », « réduit ») ne sont évidemment pas dans la page et ne prouvent rien.
 */
function markForeign(sequences, corpus) {
  const normalise = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const haystack = normalise(corpus);
  return sequences.map((sequence) => {
    const longest = sequence.reduce(
      (a, b) => (b.length > a.length ? b : a),
      ''
    );
    const suspect =
      longest.length > 25 &&
      !haystack.includes(normalise(longest).slice(0, 40));
    return suspect ? [...sequence, '⚠ hors application'] : sequence;
  });
}

/** Tout ce que la page peut faire lire : son texte plus les noms accessibles. */
const pageCorpus = (page) =>
  page.evaluate(() => {
    const labels = [...document.querySelectorAll('[aria-label],[title],[alt]')]
      .map(
        (el) =>
          `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`
      )
      .join(' ');
    return `${document.title} ${document.body.innerText} ${labels}`;
  });

class Bench {
  constructor(page, log, pageLang) {
    this.page = page;
    this.log = log;
    this.pageLang = pageLang;
    this.rows = [];
  }

  /** Une touche réelle, puis ce qui a été énoncé et où le focus a atterri. */
  async key(keys, note = '') {
    this.log.drain(this.pageLang);
    sendKeys(keys);
    await sleep(1100);
    const said = markForeign(
      this.log.drain(this.pageLang),
      await pageCorpus(this.page)
    );
    const focus = await describeFocus(this.page);
    this.rows.push({
      kind: 'key',
      keys,
      note,
      said,
      focus,
      foreign: await this.stolen(),
    });
    return said;
  }

  /** Ce qui s'énonce sans qu'on touche à rien (régions live, chargements). */
  async listen(ms, note) {
    this.log.drain(this.pageLang);
    await sleep(ms);
    const said = markForeign(
      this.log.drain(this.pageLang),
      await pageCorpus(this.page)
    );
    this.rows.push({
      kind: 'listen',
      keys: `(écoute ${ms} ms)`,
      note,
      said,
      focus: '',
      foreign: await this.stolen(),
    });
    return said;
  }

  /**
   * La fenêtre qui avait le premier plan à la fin du pas, quand ce n'est PAS le banc.
   *
   * Le journal de NVDA est GLOBAL. Si une autre fenêtre a pris le focus pendant la mesure, ce
   * qui a été énoncé ne décrit plus cette application : le relevé le dit au lieu de faire
   * semblant. Une mesure dont on ignore la provenance est plus dangereuse qu'une mesure
   * manquante, parce qu'elle a l'air d'une donnée.
   */
  async stolen() {
    const fg = foregroundTitle();
    const mine = await this.page.title();
    return fg && mine && fg.startsWith(mine) ? null : fg;
  }

  /**
   * Pose le focus sur le PREMIER élément tabulable du document, et rend son signalement.
   *
   * Deux façons plus évidentes ne marchent pas, et les deux ont été essayées ici :
   * `document.body.focus()` ne fait rien (`body` n'est pas focalisable, l'élément courant garde
   * le focus), et `blur()` ne suffit pas non plus, parce que Chrome mémorise le POINT DE DÉPART
   * de la navigation séquentielle indépendamment de l'élément actif. Dans les deux cas la
   * première tabulation reprenait au milieu du dock, et le relevé décrivait un ordre de
   * parcours qui n'était celui de personne.
   */
  async resetFocus() {
    const first = await this.page.evaluate(() => {
      const candidates = [
        ...document.querySelectorAll(
          'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])'
        ),
      ].filter((el) => {
        if (
          el.hasAttribute('disabled') ||
          el.getAttribute('aria-hidden') === 'true'
        )
          return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      const el = candidates[0];
      if (!(el instanceof HTMLElement)) return null;
      el.focus();
      return `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}`;
    });
    await sleep(1100);
    const said = markForeign(
      this.log.drain(this.pageLang),
      await pageCorpus(this.page)
    );
    this.rows.push({
      kind: 'key',
      keys: '(1er élément tabulable du document)',
      note: '',
      said,
      focus: first ?? 'AUCUN élément tabulable',
      foreign: await this.stolen(),
    });
    return first;
  }

  title(text) {
    this.rows.push({ kind: 'title', text });
  }
}

function toMarkdown(meta, rows) {
  const lines = [
    `# Passe lecteur d'écran — ${meta.locale.toUpperCase()}, ${meta.width} px`,
    '',
    `- NVDA **${meta.nvdaVersion}**, synthèse muette, journal DEBUG, langue de NVDA : \`${meta.nvdaLang}\``,
    `- Chrome ${meta.chrome}, ${meta.innerWidth}x${meta.innerHeight} px CSS (${meta.sizing})`,
    `- Application : ${meta.app} (\`${meta.title}\`, \`<html lang="${meta.htmlLang}">\`)`,
    `- Capturé le ${meta.date}`,
    '',
    'Chaque ligne est UNE touche réelle. « Énoncé » est ce que NVDA a écrit dans son journal,',
    "dans l'ordre ; « Focus réel » est lu dans le DOM au même instant. Un écart entre les deux",
    'colonnes est un défaut, pas une approximation de la mesure.',
    '',
  ];
  for (const row of rows) {
    if (row.kind === 'title') {
      lines.push(
        '',
        `## ${row.text}`,
        '',
        '| Touche | Focus réel | Énoncé par NVDA |',
        '| --- | --- | --- |'
      );
      continue;
    }
    const said = row.said.length
      ? row.said.map((seq) => seq.join(' · ')).join('<br>')
      : '**(rien)**';
    const focus = row.focus ? row.focus.replace(/\|/g, '\\|') : '—';
    const keys = `\`${row.keys}\`${row.note ? ` ${row.note}` : ''}`;
    const stolen = row.foreign
      ? ` <br>**⚠ non attribuable : « ${row.foreign} » avait le premier plan**`
      : '';
    lines.push(
      `| ${keys} | ${focus.replace(/\n/g, ' ')} | ${said.replace(/\|/g, '\\|')}${stolen} |`
    );
  }
  return lines.join('\n') + '\n';
}

// ─────────────────────────────────────────────────────────────────────────────

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

async function main() {
  const locale = arg('locale', 'fr');
  const width = Number(arg('width', '1280'));
  const height = Number(arg('height', width === 390 ? '844' : '800'));
  const only = arg('scenario', null);
  const nvdaLang = arg('nvda-lang', locale);
  const out = arg('out', `reports/screenreader/${locale}-${width}.md`);

  const { scenarios } = await import('./screenreader-scenarios.mjs');
  const chosen = only ? scenarios.filter((s) => s.name === only) : scenarios;
  if (chosen.length === 0) {
    throw new Error(
      `scénario inconnu : ${only} (connus : ${scenarios.map((s) => s.name).join(', ')})`
    );
  }

  const browser = await chromium.connectOverCDP(CDP);
  const context = browser.contexts()[0];
  const page =
    context.pages().find((p) => p.url().startsWith(APP)) ?? context.pages()[0];

  // La taille est réglée en pixels CSS EXACTS. Une garde de mise en page mobile qui démarre à
  // la mauvaise taille reste verte avec le défaut réintroduit : c'est une leçon du dépôt, et
  // elle vaut aussi pour un relevé.
  const cdp = await context.newCDPSession(page);
  const { windowId } = await cdp.send('Browser.getWindowForTarget');
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const inner = await page.evaluate(() => [innerWidth, innerHeight]);
    if (inner[0] === width && inner[1] === height) break;
    const { bounds } = await cdp.send('Browser.getWindowBounds', { windowId });
    await cdp.send('Browser.setWindowBounds', {
      windowId,
      bounds: {
        width: bounds.width + (width - inner[0]),
        height: bounds.height + (height - inner[1]),
      },
    });
    await sleep(400);
  }

  // Chrome refuse sous Windows une fenêtre plus étroite qu'environ 500 px : la largeur
  // téléphone de 390 px est donc INATTEIGNABLE par la fenêtre, et un relevé qui se contenterait
  // du plus petit possible décrirait une mise en page que personne n'a. On émule alors les
  // métriques, ce qui change la mise en page ET l'arbre d'accessibilité que NVDA lit. La
  // différence est écrite dans l'en-tête du relevé : la fenêtre, elle, reste plus large, donc
  // ce n'est pas tout à fait un téléphone et on ne prétend pas le contraire.
  let sizing = 'fenêtre réelle';
  if ((await page.evaluate(() => innerWidth)) !== width) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(800);
    sizing =
      'métriques émulées (la fenêtre Chrome ne descend pas sous ~500 px)';
  }

  const log = new SpeechLog(NVDA_LOG);
  const bench = new Bench(page, log, locale);

  for (const scenario of chosen) {
    await scenario.run({ bench, page, sleep, locale, width, sendKeys });
  }

  const meta = {
    locale,
    width,
    nvdaLang,
    nvdaVersion: '2026.2 (copie portable)',
    chrome:
      (await page.evaluate(() => navigator.userAgent)).match(
        /Chrome\/[\d.]+/
      )?.[0] ?? '?',
    app: APP,
    date: new Date().toISOString().slice(0, 16).replace('T', ' '),
    title: await page.title(),
    htmlLang: await page.evaluate(() => document.documentElement.lang),
    innerWidth: await page.evaluate(() => innerWidth),
    innerHeight: await page.evaluate(() => innerHeight),
    sizing,
  };

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, toMarkdown(meta, bench.rows), 'utf8');
  console.log(`écrit : ${out} (${bench.rows.length} lignes)`);
  await browser.close();
  await vite.close();
}

await main();
