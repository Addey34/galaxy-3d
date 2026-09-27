/* global process, document, localStorage, getComputedStyle */
// Idem : ces globals appartiennent aux rappels exécutés dans la page par `page.evaluate`.
/**
 * LES SCÉNARIOS DE LA PASSE LECTEUR D'ÉCRAN (lot 19).
 *
 * Un scénario suit un PARCOURS que quelqu'un fait vraiment au clavier, pas une liste de
 * sélecteurs : arriver, chercher un corps, lire sa fiche, régler l'affichage, refermer. Ce qui
 * est mesuré à chaque touche est écrit par `capture-screenreader.mjs`.
 *
 * Deux façons d'atteindre une surface, et elles ne disent pas la même chose :
 *
 * - `bench.key('{TAB}')` mesure le PARCOURS : combien de touches, dans quel ordre, et ce qui
 *   est énoncé en chemin. C'est la seule qui puisse révéler un piège à focus ou un ordre faux.
 * - `focusVia(...)` pose le focus par le DOM pour ARRIVER quelque part sans rejouer trente
 *   tabulations. L'événement de focus est réel, donc NVDA l'annonce, mais la ligne est marquée
 *   « mise en place » : elle ne prouve rien sur le parcours.
 */

const STORAGE = {
  locale: 'ssv-locale',
  guidedTour: 'ssv-guided-tour-v1',
  exploTourNudge: 'ssv-explo-tour-nudge-v1',
};

/** Recharge l'application dans un état connu, puis attend que le chargeur ait disparu. */
async function boot(page, { locale, firstVisit = false }) {
  await page.evaluate(
    ([keys, loc, first]) => {
      localStorage.clear();
      localStorage.setItem(keys.locale, loc);
      if (!first) {
        localStorage.setItem(keys.guidedTour, '1');
        localStorage.setItem(keys.exploTourNudge, '1');
      }
    },
    [STORAGE, locale, firstVisit]
  );
  // On NAVIGUE vers la racine plutôt que de recharger : le chemin porte le corps sélectionné
  // (`core/permalink`), donc un rechargement rejouerait la sélection du scénario précédent et
  // le relevé décrirait une page que personne n'a ouverte.
  await page.goto(process.env.GALAXY_APP ?? 'http://localhost:4173/', {
    waitUntil: 'domcontentloaded',
  });
  await page.locator('#loader').waitFor({ state: 'hidden', timeout: 90_000 });
  await page.waitForTimeout(1500);
}

/** Pose le focus sur un élément et relève ce que NVDA en dit (ligne de mise en place). */
async function focusVia(bench, page, selector, note) {
  bench.log.drain(bench.pageLang);
  await page.locator(selector).first().focus();
  await page.waitForTimeout(1100);
  const said = bench.log.drain(bench.pageLang);
  const focus = await page.evaluate(() => {
    const el = document.activeElement;
    return el && el !== document.body
      ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}`
      : 'document.body';
  });
  bench.rows.push({
    kind: 'key',
    keys: `(mise en place : focus ${selector})`,
    note: note ?? '',
    said,
    focus,
  });
}

/** Les repères et les titres exposés, dans l'ordre du document. */
async function structure(bench, page) {
  const found = await page.evaluate(() => {
    const landmarks = [
      ...document.querySelectorAll(
        'main,nav,aside,header,footer,section,form,[role]'
      ),
    ]
      .filter((el) => {
        const role =
          el.getAttribute('role') ??
          {
            MAIN: 'main',
            NAV: 'navigation',
            ASIDE: 'complementary',
            HEADER: 'banner',
            FOOTER: 'contentinfo',
            FORM: 'form',
            SECTION: 'region',
          }[el.tagName];
        return [
          'main',
          'navigation',
          'complementary',
          'banner',
          'contentinfo',
          'search',
          'form',
          'region',
        ].includes(role ?? '');
      })
      .filter(
        (el) =>
          el.offsetParent !== null || getComputedStyle(el).position === 'fixed'
      )
      .map((el) => {
        const role = el.getAttribute('role') ?? el.tagName.toLowerCase();
        const name =
          el.getAttribute('aria-label') ??
          document
            .getElementById(el.getAttribute('aria-labelledby') ?? '')
            ?.textContent?.trim() ??
          '(sans nom)';
        return `${role} « ${name} »`;
      });
    const headings = [
      ...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]'),
    ].map(
      (el) =>
        `${el.tagName.toLowerCase()} « ${el.textContent.trim().slice(0, 60)} »${el.offsetParent === null ? ' (masqué)' : ''}`
    );
    return {
      landmarks,
      headings,
      lang: document.documentElement.lang,
      title: document.title,
    };
  });
  bench.rows.push({
    kind: 'key',
    keys: '(structure du document)',
    note: '',
    focus: `lang=${found.lang} · titre « ${found.title} »`,
    said: [
      [
        `REPÈRES : ${found.landmarks.length ? found.landmarks.join(' | ') : 'AUCUN'}`,
      ],
      [
        `TITRES : ${found.headings.length ? found.headings.join(' | ') : 'AUCUN'}`,
      ],
    ],
  });
}

export const scenarios = [
  {
    name: 'arrivee',
    async run({ bench, page, locale }) {
      bench.title('Arrivée sur la page, sans rien toucher');
      await boot(page, { locale });
      await bench.listen(2500, "ce qui s'énonce une fois le chargeur parti");
      await structure(bench, page);

      bench.title(
        'Parcours au clavier depuis le début de la page (20 tabulations)'
      );
      await bench.resetFocus();
      for (let i = 0; i < 20; i += 1) await bench.key('{TAB}');
    },
  },

  {
    name: 'palette',
    async run({ bench, page, locale }) {
      bench.title('Palette des corps : ouvrir, chercher, choisir, refermer');
      await boot(page, { locale });
      await focusVia(
        bench,
        page,
        '#body-search-trigger',
        'le déclencheur de la palette'
      );
      await bench.key('{ENTER}', '— ouvre la palette');
      await bench.key('m', '— saisie dans le champ de recherche');
      await bench.key('a');
      await bench.key('r');
      await bench.key('{DOWN}', '— parcourir les résultats');
      await bench.key('{DOWN}');
      await bench.key('{ENTER}', '— choisir le corps');
      await bench.listen(2500, 'après la sélection');
      await bench.key('{ESC}', '— fermer ce qui est ouvert');
      await bench.key('{TAB}', '— où le focus est-il reparti ?');
    },
  },

  {
    name: 'fiche',
    async run({ bench, page, locale }) {
      bench.title(
        "Fiche d'information d'un corps : ouverture, lecture, fermeture"
      );
      await boot(page, { locale });
      // Un corps est choisi PAR LA SOURIS, pour partir de la situation réelle : la fiche est
      // ouverte et le focus est là où l'application l'a laissé.
      //
      // La fiche ne peut pas être focalisée par le DOM : `#body-info` ne porte pas
      // `tabindex="-1"`. Ce n'est pas un détail du banc, c'est LA raison mécanique pour
      // laquelle l'application ne peut pas y envoyer le focus après une sélection (défaut D4).
      await page.evaluate(() =>
        document.querySelector('#orbit-mars, [data-body="mars"]')?.click()
      );
      await page.waitForTimeout(2500);
      await focusVia(bench, page, '#body-info', 'la fiche (tentative)');
      await bench.key(
        '{TAB}',
        '— combien de touches pour atteindre la fiche ?'
      );
      for (let i = 0; i < 9; i += 1) await bench.key('{TAB}');
      await bench.key('{ESC}', '— fermer la fiche');
      await bench.key('{TAB}', '— où le focus est-il reparti ?');
    },
  },

  {
    name: 'reglages',
    async run({ bench, page, locale }) {
      bench.title("Réglages d'affichage : les six sections et le tableau");
      await boot(page, { locale });
      await focusVia(
        bench,
        page,
        '#settings-trigger',
        'le déclencheur des réglages'
      );
      await bench.key('{ENTER}', '— ouvre les réglages');
      for (let i = 0; i < 14; i += 1) await bench.key('{TAB}');
      await bench.key('{ESC}', '— fermer');
      await bench.key('{TAB}', '— où le focus est-il reparti ?');
    },
  },

  {
    name: 'evenements',
    async run({ bench, page, locale }) {
      bench.title('Panneau des événements astronomiques');
      await boot(page, { locale });
      await focusVia(
        bench,
        page,
        '#events-trigger',
        'le déclencheur des événements'
      );
      await bench.key('{ENTER}', '— ouvre le panneau');
      for (let i = 0; i < 6; i += 1) await bench.key('{TAB}');
      await bench.key('{ENTER}', '— activer une ligne (voyage dans le temps)');
      await bench.listen(3000, 'la date a changé : est-ce annoncé ?');
      await bench.key('{ESC}');
    },
  },

  {
    name: 'visite',
    async run({ bench, page, locale }) {
      bench.title('Visite guidée du premier passage');
      await boot(page, { locale, firstVisit: true });
      await bench.listen(3000, "à l'ouverture de la visite, sans rien toucher");
      for (let i = 0; i < 6; i += 1)
        await bench.key('{TAB}', '— piège à focus ?');
      await bench.key('{ESC}', '— fermer la visite');
      await bench.key('{TAB}', '— où le focus est-il reparti ?');
    },
  },
];
