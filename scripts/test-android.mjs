/* global console, process, setTimeout, document, performance, requestAnimationFrame */
/**
 * LES VILLES EN 3D SUR CHROME ANDROID (émulateur) : pour chaque ville demandée, ouvre la PRODUCTION
 * dans le Chrome d'un téléphone virtuel, déplie la fiche de la Terre, touche le bouton de la ville,
 * attend que des bâtiments soient posés, puis mesure l'intervalle entre images pendant 6 s.
 *
 *   node scripts/test-android.mjs [--cities "Bordeaux,New York"] [--origin <url>] [--json <fichier>]
 *
 * Environnement (rien n'est écrit en dur sauf des valeurs par défaut, le dossier partagé des outils
 * Android de cette machine) :
 *   ANDROID_SDK_ROOT  (ou ANDROID_HOME)  défaut D:\Dev\Android\Sdk
 *   ANDROID_AVD_HOME                     défaut D:\Dev\Android\avd
 *   ANDROID_AVD                          défaut Portfolio_Pixel_API_35
 *
 * Ce que cela prouve : Chrome Android charge la production, la fiche est atteignable au toucher,
 * les bâtiments se posent, aucune erreur de page, le contexte WebGL tient. Ce que cela NE prouve
 * PAS : la fluidité ni la mémoire d'un vrai téléphone. L'émulateur utilise le GPU de CE PC
 * (`-gpu host`) ; l'intervalle mesuré est un PLANCHER de régression, pas un chiffre d'appareil.
 *
 * Refus volontaires :
 *   - un rendu logiciel (SwiftShader) : l'AVD de cette machine n'a pas de GPU (`hw.gpu.enabled=no`),
 *     le contexte WebGL s'y perd et la mesure ne décrirait aucun téléphone ;
 *   - un autre site que la production par défaut : les tuiles de bâtiments n'ont de CORS que pour
 *     l'origine de production (`--origin` existe pour une préproduction qui l'aurait aussi).
 *
 * L'émulateur n'est arrêté que s'il a été démarré ICI. iOS ne s'émule pas sous Windows : il reste
 * `pnpm test:mobile` (WebKit émulé par Playwright) et `pnpm test:devices`.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { _android } from '@playwright/test';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const ORIGIN = flag('--origin', 'https://galaxy.adrianguichard.dev').replace(
  /\/$/,
  ''
);
const CITIES = flag('--cities', 'Bordeaux,New York')
  .split(',')
  .map((c) => c.trim())
  .filter(Boolean);
const JSON_OUT = flag('--json', null);

/** Plancher de régression de l'intervalle entre images (p95), émulateur sur GPU de bureau. */
const MAX_P95_MS = 40;
/** Délai pour que la descente pose des bâtiments après le toucher. */
const BUILDINGS_TIMEOUT_MS = 90_000;
const BOOT_TIMEOUT_MS = 240_000;

const sdk =
  process.env.ANDROID_SDK_ROOT ??
  process.env.ANDROID_HOME ??
  'D:\\Dev\\Android\\Sdk';
const avdHome = process.env.ANDROID_AVD_HOME ?? 'D:\\Dev\\Android\\avd';
const avdName = process.env.ANDROID_AVD ?? 'Portfolio_Pixel_API_35';
const adb = join(sdk, 'platform-tools', 'adb.exe');
const emulator = join(sdk, 'emulator', 'emulator.exe');
const env = {
  ...process.env,
  ANDROID_SDK_ROOT: sdk,
  ANDROID_AVD_HOME: avdHome,
  // Playwright cherche `adb` dans le PATH.
  PATH: `${join(sdk, 'platform-tools')};${process.env.PATH ?? ''}`,
};
process.env.PATH = env.PATH;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function runAdb(adbArgs, allowFailure = false) {
  const result = spawnSync(adb, adbArgs, {
    encoding: 'utf8',
    env,
    timeout: 30_000,
  });
  if (result.status !== 0 && !allowFailure)
    throw new Error(
      `adb ${adbArgs.join(' ')} : ${result.stderr || result.error}`
    );
  return (result.stdout ?? '').trim();
}

/** Le numéro de série d'un émulateur ENTIÈREMENT connecté, sinon null (une ligne périmée est `offline`). */
function onlineEmulator() {
  for (const line of runAdb(['devices'], true).split(/\r?\n/)) {
    const match = /^(emulator-\d+)\s+device$/.exec(line.trim());
    if (match) return match[1];
  }
  return null;
}

async function startEmulator() {
  // Après un arrêt, un relancement immédiat échoue sur « une opération de snapshot est en
  // attente » : l'émulateur sort tout de suite. On réessaie, c'est ce qui a été mesuré.
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(
      `Démarrage de ${avdName} (essai ${attempt}, GPU de la machine)…`
    );
    const child = spawn(
      emulator,
      [
        '-avd',
        avdName,
        '-no-window',
        '-no-audio',
        '-no-boot-anim',
        // L'état sauvegardé de l'AVD n'est jamais modifié par ce test.
        '-no-snapshot-save',
        '-gpu',
        'host',
      ],
      { detached: true, stdio: 'ignore', windowsHide: true, env }
    );
    let exited = false;
    child.once('exit', () => {
      exited = true;
    });
    child.unref();
    const deadline = Date.now() + BOOT_TIMEOUT_MS;
    while (!exited && Date.now() < deadline) {
      await sleep(3000);
      const serial = onlineEmulator();
      if (
        serial &&
        runAdb(
          ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'],
          true
        ) === '1'
      )
        return serial;
    }
    if (!exited)
      throw new Error("L'émulateur n'a pas fini de démarrer à temps.");
    await sleep(10_000);
  }
  throw new Error("L'émulateur sort aussitôt, trois fois de suite.");
}

/** Mesure d'une ville : bâtiments posés, intervalle entre images, crédit lu à l'écran. */
async function measureCity(context, city, problems) {
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  try {
    await page.goto(`${ORIGIN}/?debug-surface&mode=educ&body=earth`, {
      waitUntil: 'domcontentloaded',
    });
    await page
      .locator('#loader')
      .waitFor({ state: 'hidden', timeout: 120_000 });
    await sleep(4000);
    const webgl = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return 'aucun WebGL2';
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'masqué';
    });
    if (
      /swiftshader|llvmpipe|software/i.test(webgl) ||
      webgl === 'aucun WebGL2'
    )
      throw new Error(
        `rendu logiciel ou absent (${webgl}) : la mesure ne décrirait aucun téléphone, relancer avec le GPU de la machine`
      );
    await page
      .locator('#body-info')
      .waitFor({ state: 'visible', timeout: 30_000 });
    const toggle = page.locator('#body-info .bi-toggle');
    if (
      (await toggle.isVisible()) &&
      (await toggle.getAttribute('aria-expanded')) === 'false'
    )
      await toggle.click();
    const button = page.locator('.bi-city', { hasText: city });
    await button.scrollIntoViewIfNeeded();
    const box = await button.boundingBox();
    // 39,99998 px s'est vu : l'arrondi flottant ne fait pas un bouton trop petit.
    if (!box || box.height < 39.5)
      problems.push(`${city} : bouton plus petit que 40 px (${box?.height})`);
    await button.click();

    const started = Date.now();
    let state = '';
    while (Date.now() - started < BUILDINGS_TIMEOUT_MS) {
      await sleep(2000);
      state = await page.evaluate(
        () => document.querySelector('canvas')?.dataset.buildings ?? ''
      );
      if (/:\d+:[1-9]\d*$/.test(state)) break;
    }
    const placed = /:\d+:[1-9]\d*$/.test(state);
    if (!placed)
      problems.push(
        `${city} : aucun bâtiment posé en ${BUILDINGS_TIMEOUT_MS / 1000} s`
      );
    // Après la pose, les textures et les ombres finissent de se charger : un démarrage à froid
    // donnait p95 50 ms contre 16,8 ms une fois l'appareil chaud (mesuré le 2026-11-02).
    await sleep(15_000);
    const banner = await page.evaluate(() => {
      const b = document.getElementById('context-recovery-banner');
      return b && b.offsetParent !== null
        ? b.innerText.replace(/\s+/g, ' ')
        : '';
    });
    if (banner) problems.push(`${city} : contexte WebGL perdu (« ${banner} »)`);
    const intervals = await page.evaluate(
      () =>
        new Promise((done) => {
          const out = [];
          let last = performance.now();
          const end = last + 6000;
          const tick = (now) => {
            out.push(now - last);
            last = now;
            if (now < end) requestAnimationFrame(tick);
            else done(out);
          };
          requestAnimationFrame(tick);
        })
    );
    const sorted = [...intervals].sort((a, b) => a - b);
    const at = (p) =>
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    const p95 = at(0.95);
    if (p95 > MAX_P95_MS)
      problems.push(
        `${city} : intervalle p95 ${p95.toFixed(1)} ms au-dessus de ${MAX_P95_MS} ms`
      );
    if (pageErrors.length)
      problems.push(`${city} : erreurs de page : ${pageErrors.join(' | ')}`);
    const credit = await page.evaluate(
      () =>
        document
          .querySelector('.si-buildings')
          ?.innerText.replace(/\s+/g, ' ') ?? ''
    );
    return {
      city,
      webgl,
      buttonHeightPx: box?.height ?? null,
      buildings: state,
      secondsToBuildings: placed
        ? Math.round((Date.now() - started) / 1000)
        : null,
      frames: intervals.length,
      p50Ms: Number(at(0.5).toFixed(1)),
      p95Ms: Number(p95.toFixed(1)),
      maxMs: Number(sorted[sorted.length - 1].toFixed(1)),
      credit: credit.slice(0, 300),
    };
  } finally {
    await page.close();
  }
}

/** Garde-fou : une exécution bloquée (appareil muet) ne doit pas durer des dizaines de minutes. */
const WATCHDOG_MS = 15 * 60_000;

async function main() {
  setTimeout(() => {
    console.error(
      `Délai global dépassé (${WATCHDOG_MS / 60_000} min) : arrêt.`
    );
    process.exit(1);
  }, WATCHDOG_MS).unref();
  for (const [what, path] of [
    ['adb', adb],
    ['emulator', emulator],
    ['AVD', join(avdHome, `${avdName}.ini`)],
  ])
    if (!existsSync(path))
      throw new Error(
        `${what} introuvable (${path}) : définir ANDROID_SDK_ROOT, ANDROID_AVD_HOME et ANDROID_AVD`
      );
  runAdb(['start-server']);
  let serial = onlineEmulator();
  const startedHere = serial === null;
  if (startedHere) {
    serial = await startEmulator();
    // Un navigateur lancé sitôt le démarrage fini s'est fermé en cours de mesure (2 Go de RAM,
    // services encore en train de monter) : on laisse l'appareil se stabiliser.
    await sleep(20_000);
  }
  console.log(`Appareil : ${serial} (${avdName})`);
  const problems = [];
  const results = [];
  let context;
  let device;
  try {
    [device] = await _android.devices();
    if (!device) throw new Error('Playwright ne voit aucun appareil Android');
    context = await device.launchBrowser();
    for (const city of CITIES) {
      try {
        let row;
        try {
          row = await measureCity(context, city, problems);
        } catch (error) {
          // Chrome Android peut être fermé par le système : on rouvre le navigateur UNE fois.
          if (!/has been closed/.test(error.message)) throw error;
          console.log(`${city} : navigateur fermé, nouvel essai`);
          await context.close().catch(() => {});
          context = await device.launchBrowser();
          row = await measureCity(context, city, problems);
        }
        results.push(row);
        console.log(
          `${city} : ${row.buildings || '(rien)'} en ${row.secondsToBuildings ?? '-'} s, intervalle p50 ${row.p50Ms} ms, p95 ${row.p95Ms} ms, max ${row.maxMs} ms`
        );
      } catch (error) {
        problems.push(`${city} : ${error.message}`);
      }
    }
  } finally {
    await context?.close().catch(() => {});
    await device?.close().catch(() => {});
    if (startedHere) {
      runAdb(['-s', serial, 'emu', 'kill'], true);
      console.log('Émulateur arrêté (démarré ici).');
    }
  }
  if (JSON_OUT) {
    const file = resolve(JSON_OUT);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify(
        { origin: ORIGIN, avd: avdName, results, problems },
        null,
        2
      ) + '\n'
    );
  }
  console.log(
    problems.length
      ? `\nÉCHEC :\n- ${problems.join('\n- ')}`
      : `\nOK : ${results.length} ville(s), aucun problème.`
  );
  process.exit(problems.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
