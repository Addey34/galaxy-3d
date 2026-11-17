import { expect, test, type Page } from '@playwright/test';
import { en } from '../src/i18n/dict-en';
import { es } from '../src/i18n/dict-es';
import { fr } from '../src/i18n/dict-fr';
import { ptBR } from '../src/i18n/dict-pt-BR';
import { blockExternalNetwork } from './netBlock';

/**
 * GAL-PERF-001B-02 : les événements terrestres (couches USGS et NASA EONET, canvas d'instrument,
 * panneau, étiquettes) sont un module chargé au PREMIER survol, focus ou clic
 * (`ui/earthEventsLauncher`). Le serveur de développement le sert sous `/src/ui/earthEventsModule.ts`
 * (le morceau de production, son précache et l'ouverture hors ligne sont contrôlés sur le build par
 * `built-pwaPrecache.spec.ts` et `built-earthEventsOffline.spec.ts`).
 *
 * Les scénarios fixent ce que le chargement différé ne doit pas casser : rien de monté au
 * démarrage, une ouverture au premier clic, une seule charge et une seule instance, une intention
 * qui EXPIRE si le visiteur a fait autre chose, deux échecs distincts (import, montage) annoncés
 * puis réessayables sans instance résiduelle, et AUCUNE requête scientifique avant qu'une couche
 * soit cochée. Réponses USGS/EONET simulées et déterministes, jamais le réseau réel. L'import est
 * retenu par une porte, jamais par un délai deviné. Ils sont ici, et non dans `test:pages`, parce que
 * chacun démarre l'application entière : ce job a 15 minutes en tout.
 */
const CHUNK = /\/src\/ui\/earthEventsModule\.ts(\?.*)?$/;
const PANEL = '#earth-events';
const TRIGGER = '#earth-events-trigger';
const CANVAS = '#earth-events-overlay';
const TOGGLE = '#event-labels-toggle';
const ROWS = `${PANEL} .ee-item`;
const SOURCES = ['earthquake.usgs.gov', 'eonet.gsfc.nasa.gov'];

const quake = (
  id: string,
  mag: number,
  place: string,
  lon: number,
  lat: number
) => ({
  type: 'Feature',
  id,
  properties: { mag, place, time: Date.parse('2011-03-11T05:46:24Z') },
  geometry: { type: 'Point', coordinates: [lon, lat, 29] },
});
const TOHOKU = {
  features: [
    quake(
      'tohoku',
      9.1,
      'near the east coast of Honshu, Japan',
      142.373,
      38.297
    ),
  ],
};
const MAULE = {
  features: [quake('maule', 8.8, 'offshore Maule, Chile', -72.733, -35.909)],
};
const EONET = {
  events: [
    {
      id: 'EONET_TEST_OPEN',
      title: 'Test Volcano',
      closed: null,
      categories: [{ id: 'volcanoes', title: 'Volcanoes' }],
      geometry: [
        {
          date: '2011-03-05T00:00:00Z',
          type: 'Point',
          coordinates: [130.657, 31.585],
        },
      ],
    },
  ],
};

interface Boot {
  /** Requêtes de la page pour le module. */
  module: string[];
  /** Requêtes vers USGS et EONET (jamais réelles : toutes servies par `page.route`). */
  science: string[];
}

async function boot(
  page: Page,
  options: {
    quakes?: () => unknown;
    url?: string;
    storage?: Record<string, string>;
  } = {}
): Promise<Boot> {
  await blockExternalNetwork(page);
  const seen: Boot = { module: [], science: [] };
  page.on('request', (request) => {
    const url = request.url();
    if (CHUNK.test(url)) seen.module.push(url);
    if (SOURCES.includes(new URL(url).host)) seen.science.push(url);
  });
  await page.route('**earthquake.usgs.gov/**', (route) =>
    route.fulfill({ json: (options.quakes ?? (() => TOHOKU))() })
  );
  await page.route('**eonet.gsfc.nasa.gov/**', (route) =>
    route.fulfill({ json: EONET })
  );
  const storage = options.storage ?? {};
  await page.addInitScript((extra) => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    if (!localStorage.getItem('ssv-locale'))
      localStorage.setItem('ssv-locale', 'en');
    for (const [key, value] of Object.entries(extra))
      localStorage.setItem(key, value);
  }, storage);
  await page.goto(options.url ?? '/earth/?date=2011-03-11T12%3A00%3A00Z');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  return seen;
}

/** Retient le module jusqu'à l'appel de la fonction rendue ; `seen()` compte ses requêtes. */
async function hold(
  page: Page
): Promise<{ release: () => void; seen: () => number }> {
  let release: () => void = () => undefined;
  let count = 0;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(CHUNK, async (route) => {
    count++;
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  return { release, seen: () => count };
}

const canvases = (page: Page) => page.locator(CANVAS);
const idle = (page: Page) => page.waitForTimeout(2_500); // > checkIntervalMs (2 s) du socle daté

test('rien n’est monté au démarrage : ni module, ni canvas, ni panneau rempli, ni requête scientifique', async ({
  page,
}) => {
  const seen = await boot(page);
  await idle(page);
  expect(seen.module, 'requêtes du module').toEqual([]);
  expect(seen.science, 'requêtes USGS/EONET').toEqual([]);
  await expect(canvases(page)).toHaveCount(0);
  await expect(page.locator(ROWS)).toHaveCount(0);
  await expect(page.locator(TOGGLE)).toHaveCount(0);
  const trigger = page.locator(TRIGGER);
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).not.toHaveAttribute('aria-busy', /.*/);
});

test('le premier clic ouvre le panneau sans second clic, sans requête scientifique, une seule instance', async ({
  page,
}) => {
  const seen = await boot(page);
  await page.locator(TRIGGER).click();
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(TRIGGER)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator(ROWS)).toHaveCount(2);
  await expect(canvases(page)).toHaveCount(1);
  await expect(page.locator(TOGGLE)).toHaveCount(1);
  // Monté mais éteint : ouvrir le panneau ne demande RIEN à un service public.
  await idle(page);
  expect(seen.science).toEqual([]);
  await expect(canvases(page)).not.toHaveClass(/is-visible/);
  expect(seen.module).toHaveLength(1);

  // Fermé puis rouvert : le MÊME montage, un seul écouteur de bascule (deux fermeraient aussitôt).
  await page.keyboard.press('Escape');
  await expect(page.locator(PANEL)).toBeHidden();
  await expect(page.locator(TRIGGER)).toBeFocused();
  await page.locator(TRIGGER).click();
  await expect(page.locator(PANEL)).toBeVisible();
  await page.locator(TRIGGER).click();
  await expect(page.locator(PANEL)).toBeHidden();
  expect(seen.module).toHaveLength(1);
  await expect(canvases(page)).toHaveCount(1);
});

test('le canvas garde sa place : avant celui des sondes, qui se peignent par-dessus', async ({
  page,
}) => {
  await boot(page);
  await page.locator(TRIGGER).click();
  await expect(canvases(page)).toHaveCount(1);
  const order = await page.evaluate(() => {
    const earth = document.getElementById('earth-events-overlay');
    const probes = document.getElementById('spacecraft-overlay');
    if (!earth || !probes) return null;
    return Boolean(
      earth.compareDocumentPosition(probes) & Node.DOCUMENT_POSITION_FOLLOWING
    );
  });
  expect(order).toBe(true);
});

test('le survol précharge le module sans rien monter ni demander, et le clic le réutilise', async ({
  page,
}) => {
  const seen = await boot(page);
  await page.locator(TRIGGER).hover();
  await expect.poll(() => seen.module.length).toBe(1);
  await idle(page);
  await expect(canvases(page)).toHaveCount(0);
  await expect(page.locator(ROWS)).toHaveCount(0);
  await expect(page.locator(TOGGLE)).toHaveCount(0);
  expect(seen.science).toEqual([]);
  await page.locator(TRIGGER).click();
  await expect(page.locator(PANEL)).toBeVisible();
  expect(seen.module).toHaveLength(1);
});

test('le focus clavier précharge aussi, et Entrée ouvre sans second appui', async ({
  page,
}) => {
  const seen = await boot(page);
  await page.locator(TRIGGER).focus();
  await expect.poll(() => seen.module.length).toBe(1);
  await expect(canvases(page)).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(`${PANEL} .surface-close`)).toBeFocused();
  // Case, puis Échap rend le focus au déclencheur.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Escape');
  await expect(page.locator(PANEL)).toBeHidden();
  await expect(page.locator(TRIGGER)).toBeFocused();
});

test('des clics répétés pendant l’import : une charge, une instance, une ouverture', async ({
  page,
}) => {
  const seen = await boot(page);
  const gate = await hold(page);
  const trigger = page.locator(TRIGGER);
  await trigger.click();
  await expect.poll(gate.seen).toBe(1);
  await expect(trigger).toHaveAttribute('aria-busy', 'true');
  await trigger.click();
  await trigger.click();
  await expect(canvases(page)).toHaveCount(0);
  gate.release();
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
  await expect(canvases(page)).toHaveCount(1);
  await expect(page.locator(TOGGLE)).toHaveCount(1);
  await expect(page.locator(ROWS)).toHaveCount(2);
  expect(gate.seen()).toBe(1);
  expect(seen.module).toHaveLength(1);
  await expect(trigger).not.toHaveAttribute('aria-busy', /.*/);
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
});

test('une autre surface ouverte pendant l’import : la réponse ne rouvre pas le panneau', async ({
  page,
}) => {
  await boot(page);
  const gate = await hold(page);
  await page.locator(TRIGGER).click();
  await expect.poll(gate.seen).toBe(1);
  await page.evaluate(() =>
    document.getElementById('settings-trigger')!.click()
  );
  await expect(page.locator('#orbit-options')).toBeVisible();
  // Focus REMIS sur le déclencheur : seule l'annonce du coordinateur peut annuler l'intention.
  await page.locator(TRIGGER).focus();
  gate.release();
  await expect(page.locator(TRIGGER)).not.toHaveAttribute('aria-busy', /.*/);
  await expect(canvases(page)).toHaveCount(1);
  await expect(page.locator(PANEL)).toBeHidden();
  await expect(page.locator('#orbit-options')).toBeVisible();
  await expect(page.locator(`${PANEL} .surface-close`)).not.toBeFocused();
  // Le clic suivant ouvre normalement et ferme la surface précédente.
  await page.locator(TRIGGER).click();
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(page.locator('#orbit-options')).toBeHidden();
});

test('le démarrage d’une visite pendant l’import annule l’ouverture, sans voler le focus', async ({
  page,
}) => {
  await boot(page);
  const gate = await hold(page);
  await page.locator(TRIGGER).click();
  await expect.poll(gate.seen).toBe(1);
  await page.locator('#help-btn').click();
  await page.locator('.stour-start').click();
  await page.locator('.stour-picker-item').first().click();
  await expect(page.locator('.stour-card')).toBeVisible();
  gate.release();
  await expect(page.locator(TRIGGER)).not.toHaveAttribute('aria-busy', /.*/);
  await expect(page.locator(PANEL)).toBeHidden();
  await expect(page.locator('.stour-card')).toBeVisible();
  await expect(page.locator(`${PANEL} .surface-close`)).not.toBeFocused();
  await expect(canvases(page)).toHaveCount(1);
});

test('Échap pendant l’import annule l’ouverture', async ({ page }) => {
  await boot(page);
  const gate = await hold(page);
  await page.locator(TRIGGER).click();
  await expect.poll(gate.seen).toBe(1);
  await page.keyboard.press('Escape');
  gate.release();
  await expect(page.locator(TRIGGER)).not.toHaveAttribute('aria-busy', /.*/);
  await expect(page.locator(PANEL)).toBeHidden();
  await expect(page.locator(TRIGGER)).toHaveAttribute('aria-expanded', 'false');
  await page.locator(TRIGGER).click();
  await expect(page.locator(PANEL)).toBeVisible();
});

test('le focus parti ailleurs pendant l’import n’est pas volé', async ({
  page,
}) => {
  await boot(page);
  const gate = await hold(page);
  await page.locator(TRIGGER).click();
  await expect.poll(gate.seen).toBe(1);
  await page.locator('#settings-trigger').focus();
  gate.release();
  await expect(page.locator(TRIGGER)).not.toHaveAttribute('aria-busy', /.*/);
  await expect(page.locator(PANEL)).toBeHidden();
  await expect(page.locator('#settings-trigger')).toBeFocused();
});

test('un échec d’import est annoncé, rien n’est monté, puis le clic suivant réussit', async ({
  page,
}) => {
  await boot(page);
  await page.route(CHUNK, (route) => route.abort());
  await page.locator(TRIGGER).click();
  await expect(page.locator('[role="status"].sr-only').first()).toContainText(
    'could not be loaded',
    {
      timeout: 15_000,
    }
  );
  await expect(canvases(page)).toHaveCount(0);
  await expect(page.locator(ROWS)).toHaveCount(0);
  await expect(page.locator(TRIGGER)).not.toHaveAttribute('aria-busy', /.*/);
  await page.unroute(CHUNK);
  await page.locator(TRIGGER).click();
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
  await expect(canvases(page)).toHaveCount(1);
  await expect(page.locator(ROWS)).toHaveCount(2);
});

/**
 * Recensement des écouteurs posés sur le déclencheur, le panneau et son bouton de fermeture : un
 * montage raté qui en laisse un seul derrière lui doublerait la bascule au montage suivant.
 */
const CENSUS = () => {
  const live: Array<{ t: Element; type: string; l: unknown; c: boolean }> = [];
  const watched = (el: Element) =>
    el.id === 'earth-events-trigger' ||
    el.id === 'earth-events' ||
    el.matches('#earth-events .surface-close');
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  const capture = (o: unknown) =>
    typeof o === 'boolean' ? o : Boolean((o as { capture?: boolean })?.capture);
  EventTarget.prototype.addEventListener = function (
    this: EventTarget,
    type: string,
    listener: never,
    options?: never
  ) {
    if (this instanceof Element && watched(this)) {
      const c = capture(options);
      if (
        !live.some(
          (e) =>
            e.t === this && e.type === type && e.l === listener && e.c === c
        )
      )
        live.push({ t: this, type, l: listener, c });
    }
    return add.call(this, type, listener, options);
  } as typeof add;
  EventTarget.prototype.removeEventListener = function (
    this: EventTarget,
    type: string,
    listener: never,
    options?: never
  ) {
    const c = capture(options);
    const at = live.findIndex(
      (e) => e.t === this && e.type === type && e.l === listener && e.c === c
    );
    if (at >= 0) live.splice(at, 1);
    return remove.call(this, type, listener, options);
  } as typeof remove;
  (window as unknown as { __census: () => string[] }).__census = () =>
    live.map((e) => `${e.t.id || 'close'}:${e.type}`).sort();
};
const census = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __census: () => string[] }).__census()
  );

/** Où l'initialisation lève, UNE fois : de plus en plus tard, donc avec de plus en plus à défaire. */
const INJECTIONS = [
  ['le contexte 2D du canvas (rien encore à défaire)', 'context'],
  ['la construction des rangées (canvas et réglage déjà posés)', 'rows'],
  [
    'le dernier réglage du déclencheur (écouteurs et abonnements déjà posés)',
    'late',
  ],
] as const;

for (const [label, kind] of INJECTIONS) {
  test(`une exception pendant l’initialisation (${label}) est annoncée, ne laisse aucune instance, et le clic suivant réussit`, async ({
    page,
  }) => {
    await page.addInitScript(CENSUS);
    const seen = await boot(page);
    await page.evaluate((where) => {
      let armed = true;
      const once = () => {
        const fire = armed;
        armed = false;
        return fire;
      };
      if (where === 'context') {
        const original = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (
          this: HTMLCanvasElement,
          ...args: unknown[]
        ) {
          if (this.id === 'earth-events-overlay' && once())
            throw new Error('échec simulé');
          return (original as (...a: unknown[]) => unknown).apply(this, args);
        } as typeof original;
      } else if (where === 'rows') {
        const original = Element.prototype.replaceChildren;
        Element.prototype.replaceChildren = function (
          this: Element,
          ...nodes: (Node | string)[]
        ) {
          if (this.classList.contains('ee-body') && once())
            throw new Error('échec simulé');
          return original.apply(this, nodes);
        };
      } else {
        const original = Element.prototype.setAttribute;
        Element.prototype.setAttribute = function (
          this: Element,
          name: string,
          value: string
        ) {
          if (
            this.id === 'earth-events-trigger' &&
            name === 'aria-expanded' &&
            once()
          )
            throw new Error('échec simulé');
          return original.call(this, name, value);
        };
      }
    }, kind);

    const before = await census(page);
    await page.locator(TRIGGER).click();
    await expect(page.locator('[role="status"].sr-only').first()).toContainText(
      'could not be loaded',
      {
        timeout: 20_000,
      }
    );
    // Aucune instance résiduelle : ni canvas, ni rangée, ni réglage, ni panneau ouvert, et
    // exactement les écouteurs d'avant le clic (ceux du lanceur, rien d'autre).
    await expect(canvases(page)).toHaveCount(0);
    await expect(page.locator(ROWS)).toHaveCount(0);
    await expect(page.locator(TOGGLE)).toHaveCount(0);
    await expect(page.locator(PANEL)).toBeHidden();
    await expect(page.locator(TRIGGER)).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    await expect(page.locator(TRIGGER)).not.toHaveAttribute('aria-busy', /.*/);
    expect(await census(page), 'écouteurs après l’échec').toEqual(before);
    // Un abonnement de langue résiduel reconstruirait des rangées dans un panneau censé être vide.
    await page.locator('#help-btn').click();
    await page.locator('#lang-switch .lang-btn[data-locale="fr"]').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.locator(ROWS)).toHaveCount(0);

    // Le module est déjà importé : la reprise ne le redemande pas, et monte UNE instance saine.
    await page.keyboard.press('Escape');
    await page.locator(TRIGGER).click();
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
    await expect(canvases(page)).toHaveCount(1);
    await expect(page.locator(TOGGLE)).toHaveCount(1);
    await expect(page.locator(ROWS)).toHaveCount(2);
    expect(seen.module).toHaveLength(1);
    expect(await census(page), 'écouteurs après la reprise').toEqual([
      'close:click',
      'earth-events-trigger:click',
      'earth-events:keydown',
    ]);
    // Un seul écouteur de bascule sur le déclencheur : Échap puis deux clics, ouvert puis fermé.
    await page.keyboard.press('Escape');
    await page.locator(TRIGGER).click();
    await expect(page.locator(PANEL)).toBeVisible();
    await page.locator(TRIGGER).click();
    await expect(page.locator(PANEL)).toBeHidden();
  });
}

test('cocher une couche demande UNE fois sa source ; éteindre puis rallumer en redemande une, légitimement', async ({
  page,
}) => {
  const seen = await boot(page);
  await page.locator(TRIGGER).click();
  const quakes = page.locator(ROWS).nth(0);
  await quakes.locator('input').check();
  await expect(quakes.locator('.ee-list')).toContainText('M9.1', {
    timeout: 15_000,
  });
  await idle(page);
  // Une couche cochée, une seule requête, vers USGS seulement (EONET reste éteint).
  expect(seen.science.map((u) => new URL(u).host)).toEqual([
    'earthquake.usgs.gov',
  ]);
  await expect(canvases(page)).toHaveClass(/is-visible/);

  await quakes.locator('input').uncheck();
  await expect(quakes.locator('.ee-list li')).toHaveCount(0);
  await expect(canvases(page)).not.toHaveClass(/is-visible/);
  await idle(page);
  expect(seen.science).toHaveLength(1);

  await quakes.locator('input').check();
  await expect(quakes.locator('.ee-list')).toContainText('M9.1', {
    timeout: 15_000,
  });
  expect(seen.science).toHaveLength(2);
  await expect(canvases(page)).toHaveCount(1);
});

test('un changement de date pendant une réponse en cours : la réponse périmée n’est pas appliquée', async ({
  page,
}) => {
  let calls = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const seen = await boot(page);
  await page.unroute('**earthquake.usgs.gov/**');
  await page.route('**earthquake.usgs.gov/**', async (route) => {
    calls++;
    if (calls === 1) {
      await gate;
      await route.fulfill({ json: TOHOKU }).catch(() => undefined);
    } else {
      await route.fulfill({ json: MAULE });
    }
  });
  await page.locator(TRIGGER).click();
  const quakes = page.locator(ROWS).nth(0);
  await quakes.locator('input').check();
  await expect.poll(() => calls).toBe(1);
  // La date change pendant que la première réponse est encore en route.
  // `<input type="date">` : `fill` + Entrée ne valide pas partout (WebKit mobile), la valeur et
  // l'événement `change` sont donc posés explicitement, comme le fait le sélecteur natif.
  await page.locator('#date-input').evaluate((el) => {
    (el as HTMLInputElement).value = '2010-02-28';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect.poll(() => calls, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  await expect(quakes.locator('.ee-list')).toContainText('M8.8', {
    timeout: 15_000,
  });
  release();
  await page.waitForTimeout(1_000);
  await expect(quakes.locator('.ee-list')).toContainText('M8.8');
  await expect(quakes.locator('.ee-list')).not.toContainText('M9.1');
  expect(seen.science.length).toBe(calls);
});

test('l’état des étiquettes persiste, activé par défaut, et un stockage indisponible ne casse rien', async ({
  page,
}) => {
  await boot(page);
  await page.locator(TRIGGER).click();
  const toggle = page.locator(TOGGLE);
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  expect(
    await page.evaluate(() => localStorage.getItem('ssv-event-labels'))
  ).toBe('0');
  await page.reload();
  await expect(page.locator('#loader')).toBeHidden({ timeout: 60_000 });
  await page.locator(TRIGGER).click();
  await expect(page.locator(TOGGLE)).not.toBeChecked();
  await page.locator(TOGGLE).check();
  expect(
    await page.evaluate(() => localStorage.getItem('ssv-event-labels'))
  ).toBe('1');
});

test('stockage refusé : le réglage reste actif pour la session, sans exception', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await boot(page);
  await page.evaluate(() => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function (this: Storage, key: string) {
      if (key === 'ssv-event-labels') throw new Error('stockage refusé');
      return original.call(this, key);
    };
    Storage.prototype.setItem = function () {
      throw new Error('stockage refusé');
    };
  });
  await page.locator(TRIGGER).click();
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(TOGGLE)).toBeChecked();
  await page.locator(TOGGLE).uncheck();
  await page.locator(TOGGLE).check();
  expect(errors).toEqual([]);
});

test('clavier : Tab atteint une case, Espace la coche, la source est demandée une fois', async ({
  page,
}) => {
  const seen = await boot(page);
  await page.locator(TRIGGER).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Tab');
  await expect(page.locator(`${ROWS} input`).first()).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.locator(ROWS).nth(0).locator('.ee-list')).toContainText(
    'M9.1',
    {
      timeout: 15_000,
    }
  );
  // Le focus reste sur la case : l'arrivée des données ne reconstruit pas le panneau.
  await expect(page.locator(`${ROWS} input`).first()).toBeFocused();
  expect(seen.science).toHaveLength(1);
});

for (const [locale, dict] of [
  ['en', en],
  ['fr', fr],
  ['es', es],
  ['pt-BR', ptBR],
] as const) {
  test(`les textes du panneau sont ceux du dictionnaire (${locale})`, async ({
    page,
  }) => {
    await boot(page, { storage: { 'ssv-locale': locale } });
    await page.locator(TRIGGER).click();
    await expect(page.locator(PANEL)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(`${PANEL} .surface-title`)).toHaveText(
      dict['earthEvents.title']
    );
    await expect(page.locator(PANEL)).toHaveAttribute(
      'aria-label',
      dict['earthEvents.dialog.aria']
    );
    await expect(page.locator(`${TOGGLE}`)).toHaveAttribute(
      'aria-label',
      dict['settings.eventLabels']
    );
    await expect(
      page.locator(`${PANEL} .settings-switch-label`).last()
    ).toHaveText(dict['settings.eventLabels']);
    await expect(page.locator(PANEL)).not.toContainText(
      /earthEvents\.|settings\.eventLabels/
    );
  });
}
