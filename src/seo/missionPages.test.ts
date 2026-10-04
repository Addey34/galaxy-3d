import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { flattenBodies } from '@/config/catalog';
import { NAVIGABLE_TARGETS } from '@/config/navigable';
import missionIndex from '@/config/missionIndex.json';
import { messages } from '@/i18n/allDictionaries';
import { LOCALES, LOCALE_PATH } from '@/i18n/locales';
import { bodyLandingPages } from './bodyLandingPage';
import { docPath, renderDocPage } from './documentPage';
import {
  instrumentLandingPages,
  type InstrumentPageInputs,
} from './instrumentLandingPage';
import catalogueFile from './missionCatalogue.json';
import {
  CALIBRATION_TYPES,
  missionBodies,
  missionDescription,
  missionPages,
  missionsByBody,
  missionSlugsByLid,
  type MissionCatalogue,
  type MissionPageInputs,
} from './missionPages';

/**
 * LES PAGES DES MISSIONS (2026-10-04), confrontées au catalogue LIVRÉ et aux fichiers que
 * l'application lit déjà : le même générateur écrit les deux, et ce fichier vérifie qu'ils
 * disent la même chose.
 */
const ORIGIN = 'https://example.test';
const catalogue = catalogueFile as MissionCatalogue;
const ROOT = resolve(import.meta.dirname, '../..');

const spacecraftByMission = new Map<string, string[]>();
for (const file of readdirSync(resolve(ROOT, 'public/assets/instruments'))) {
  const archive = JSON.parse(
    readFileSync(resolve(ROOT, 'public/assets/instruments', file), 'utf8')
  ) as { investigations: { lid: string }[] };
  for (const investigation of archive.investigations) {
    const list = spacecraftByMission.get(investigation.lid) ?? [];
    list.push(file.replace(/\.json$/, ''));
    spacecraftByMission.set(investigation.lid, list);
  }
}
const inputs: MissionPageInputs = {
  catalogue,
  config: CELESTIAL_CONFIG,
  navigable: NAVIGABLE_TARGETS,
  spacecraftByMission,
  origin: ORIGIN,
};
const pagesOf = Object.fromEntries(
  LOCALES.map((locale) => [locale, missionPages(inputs, locale)])
);
const page = (slug: string, locale: (typeof LOCALES)[number] = 'en') =>
  pagesOf[locale]!.find((p) => p.slug === `missions/${slug}`)!;
/** Le texte RÉDIGÉ d'une page, sans la citation anglaise qui n'est pas de nous. */
const ownText = (body: string): string =>
  body.replace(/<blockquote[\s\S]*?<\/blockquote>/g, '');

describe('le catalogue des missions livré', () => {
  it('compte les mêmes missions que l’index que lit l’application', () => {
    expect(catalogue.missions.length).toBe(missionIndex.missions);
    expect(catalogue.retrieved).toBe(missionIndex.retrieved);
  });

  it('donne à chaque mission un chemin unique et une description', () => {
    const slugs = catalogue.missions.map((m) => m.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const mission of catalogue.missions) {
      expect(mission.slug).toMatch(/^[a-z0-9-]+$/);
      expect(mission.description.length, mission.slug).toBeGreaterThan(50);
    }
  });

  /**
   * LE MÊME GÉNÉRATEUR écrit les listes par corps de la fiche et ce catalogue. S'ils divergeaient,
   * la page d'un corps et sa fiche ne nommeraient pas les mêmes missions.
   */
  it('vise, corps par corps, exactement les missions que la fiche affiche', () => {
    const byBody = missionsByBody(catalogue);
    const lidOf = new Map(catalogue.missions.map((m) => [m.slug, m.lid]));
    for (const [body, entry] of Object.entries(missionIndex.bodies)) {
      const shipped =
        entry.count === 0
          ? []
          : (
              JSON.parse(
                readFileSync(
                  resolve(ROOT, 'public/assets/missions', `${body}.json`),
                  'utf8'
                )
              ) as { lid: string }[]
            ).map((m) => m.lid);
      const derived = (byBody.get(body) ?? []).map((m) =>
        lidOf.get(m.slug.replace('missions/', ''))
      );
      expect(new Set(derived), body).toEqual(new Set(shipped));
    }
  });
});

describe('la description citée', () => {
  it('rend telle quelle une description sans titre PDS3', () => {
    const juno = catalogue.missions.find((m) => m.slug === 'juno')!;
    expect(missionDescription(juno.description)).toEqual({
      text: juno.description,
      truncated: false,
    });
  });

  it('retire le titre souligné de BepiColombo, sans rien couper', () => {
    const { text, truncated } = missionDescription(
      catalogue.missions.find((m) => m.slug === 'bc')!.description
    );
    expect(truncated).toBe(false);
    expect(text.startsWith('BepiColombo is Europe')).toBe(true);
    expect(text).not.toContain('====');
  });

  it('arrête ExoMars 2016 avant son tableau aplati, et le dit', () => {
    const { text, truncated } = missionDescription(
      catalogue.missions.find((m) => m.slug === 'em16')!.description
    );
    expect(truncated).toBe(true);
    expect(text.startsWith('ExoMars 2016 was launched')).toBe(true);
    expect(text.endsWith('as of today.')).toBe(true);
    expect(text).not.toMatch(/Mission Phases|====/);
  });

  it('ne garde aucun soulignement dans les 112 citations', () => {
    for (const mission of catalogue.missions)
      expect(
        missionDescription(mission.description).text,
        mission.slug
      ).not.toMatch(/={4,}/);
  });
});

describe('les pages des missions', () => {
  for (const locale of LOCALES)
    it(`l’index et une page par mission, en ${locale}`, () => {
      const pages = pagesOf[locale]!;
      expect(pages.length).toBe(catalogue.missions.length + 1);
      expect(pages[0]!.slug).toBe('missions');
      for (const p of pages)
        expect(p.canonical).toBe(`${ORIGIN}${docPath(p.slug, locale)}`);
      // L'index relie chaque mission.
      for (const mission of catalogue.missions)
        expect(pages[0]!.body).toContain(
          `href="${docPath(`missions/${mission.slug}`, locale)}"`
        );
    });

  it('relie chaque cible du catalogue à une page de corps qui existe', () => {
    const bodies = new Set(flattenBodies(CELESTIAL_CONFIG).keys());
    for (const locale of LOCALES)
      for (const mission of catalogue.missions)
        for (const body of missionBodies(mission)) {
          expect(bodies.has(body), body).toBe(true);
          const prefix = LOCALE_PATH[locale] ? `/${LOCALE_PATH[locale]}` : '';
          expect(page(mission.slug, locale).body).toContain(
            `href="${prefix}/${body}/"`
          );
        }
  });

  it('relie les sondes que Galaxy suit, lues dans leur archive', () => {
    const voyager = page('voyager');
    expect(voyager.body).toContain('href="/voyager1/"');
    expect(voyager.body).toContain('href="/voyager2/"');
    expect(page('juno', 'fr').body).toContain('href="/fr/juno/"');
    // Témoin : une mission sans sonde suivie n'en annonce pas.
    expect(page('magellan').body).not.toContain(
      'Spacecraft of this mission that Galaxy follows'
    );
  });

  it('cite la description en anglais, marquée comme telle, dans chaque langue', () => {
    for (const locale of LOCALES) {
      const body = page('juno', locale).body;
      expect(body).toContain('<blockquote lang="en"');
      expect(body).toContain('Juno is a spacecraft that was launched');
    }
    expect(page('em16', 'fr').body).toContain(
      'La suite du texte publié est un tableau'
    );
    expect(page('juno', 'fr').body).not.toContain('La suite du texte publié');
  });

  it('dit le début du PROJET, et une fin non déclarée comme telle', () => {
    // Voyager : le projet commence en 1972, cinq ans avant le lancement, et ne déclare pas de fin.
    const voyager = page('voyager', 'fr').body;
    expect(voyager).toContain('Début du projet');
    expect(voyager).toContain('1 juillet 1972');
    expect(voyager).toContain('non déclarée');
    expect(voyager).not.toMatch(/lancée? le|en cours</);
  });

  /**
   * TROUVÉ EN REGARDANT l'index rendu, pas par un test : DART y ouvrait la liste au 1000-01-01,
   * la sentinelle de début de l'archive. Elle se lit « non déclaré », et va en FIN d'index.
   */
  it('ne publie jamais la sentinelle de début, et la range en fin d’index', () => {
    const dart = catalogue.missions.find(
      (m) => m.slug === 'double-asteroid-redirection-test'
    )!;
    expect(dart.start).toBeNull();
    for (const mission of catalogue.missions)
      expect(mission.start ?? '', mission.slug).not.toBe('1000-01-01');
    expect(page(dart.slug, 'fr').body).toContain(
      '<dt>Début du projet</dt><dd>non déclaré</dd>'
    );
    const index = pagesOf.en![0]!.body;
    expect(index).not.toContain('1000-01-01');
    const rows = [...index.matchAll(/<tr><th scope="row"><a href="([^"]+)"/g)];
    expect(rows.at(-1)![1]).toBe(`/missions/${dart.slug}/`);
  });

  it('écarte les cibles d’étalonnage en les comptant', () => {
    const next = catalogue.missions.find((m) => m.slug === 'next')!;
    const calibrations = next.targets.filter((t) =>
      CALIBRATION_TYPES.has(String(t.type))
    ).length;
    expect(calibrations).toBeGreaterThan(0);
    const body = page('next').body;
    expect(body).toContain(`${calibrations} calibration targets`);
    expect(body).not.toContain('NON SCIENCE');
    expect(body).toContain('9P/Tempel 1 (comet)');
  });

  it('dit quand aucune cible n’est dans le catalogue', () => {
    expect(page('lucy').body).toContain(
      'None of the targets this mission declares is in Galaxy'
    );
  });

  it('écrit quatre vraies versions, sans tiret cadratin dans le texte rédigé', () => {
    for (const slug of ['missions', 'missions/cassini-huygens']) {
      const titles = new Set(
        LOCALES.map((l) => pagesOf[l]!.find((p) => p.slug === slug)!.title)
      );
      expect(titles.size, slug).toBe(LOCALES.length);
    }
    for (const locale of LOCALES)
      for (const p of pagesOf[locale]!) {
        expect(ownText(p.body), p.slug).not.toContain('—');
        expect(p.title).not.toContain('—');
        expect(p.description).not.toContain('—');
      }
  });

  it('se rend en document complet, rubrique « Missions » marquée', () => {
    const image = { url: `${ORIGIN}/x.jpg`, width: '1', height: '1', alt: 'x' };
    const detail = renderDocPage(page('juno', 'es'), ORIGIN, image);
    expect(detail).toContain('<html lang="es">');
    expect(detail).toContain(
      `<link rel="canonical" href="${ORIGIN}/es/missions/juno/" />`
    );
    expect(detail).toContain(
      `hreflang="pt-BR" href="${ORIGIN}/pt-br/missions/juno/"`
    );
    // Dans la rubrique sans en être la page : marquée à l'œil, pas pour un lecteur d'écran.
    expect(detail).toContain(
      '<a class="doc-nav-link is-current" href="/es/missions/">Misiones</a>'
    );
    const index = renderDocPage(pagesOf.en![0]!, ORIGIN, image);
    expect(index).toContain(
      '<a class="doc-nav-link is-current" aria-current="page" href="/missions/">Missions</a>'
    );
  });
});

describe('les liens vers les missions depuis les autres pages', () => {
  const byBody = missionsByBody(catalogue);

  it('la page d’un corps relie ses missions, dans sa langue', () => {
    const saturn = (locale: (typeof LOCALES)[number]) =>
      bodyLandingPages(CELESTIAL_CONFIG, ORIGIN, locale, byBody).find(
        (p) => p.body === 'saturn'
      )!;
    expect(saturn('en').missions).toContainEqual({
      name: 'Cassini-Huygens',
      href: '/missions/cassini-huygens/',
    });
    expect(saturn('pt-BR').missions).toContainEqual({
      name: 'Cassini-Huygens',
      href: '/pt-br/missions/cassini-huygens/',
    });
    // Le titre du bloc est celui de la fiche.
    expect(messages.fr['bi.missions.label']).toBe('Missions');
    // Témoin : un corps qu'aucune mission ne vise n'a pas de liste.
    const eris = bodyLandingPages(CELESTIAL_CONFIG, ORIGIN, 'en', byBody).find(
      (p) => p.body === 'eris'
    )!;
    expect(eris.missions).toEqual([]);
  });

  it('la page d’une sonde relie ses investigations qui ont une page', () => {
    const juno = JSON.parse(
      readFileSync(resolve(ROOT, 'public/assets/instruments/juno.json'), 'utf8')
    ) as Parameters<
      typeof instrumentLandingPages
    >[1]['archives'] extends ReadonlyMap<string, infer A>
      ? A extends { archive: infer R }
        ? R
        : never
      : never;
    const probeInputs: InstrumentPageInputs = {
      archives: new Map([['juno', { status: 'declared', archive: juno }]]),
      archiveRetrieved: '2026-09-30',
      coverage: new Map(),
      missionPages: missionSlugsByLid(catalogue),
    };
    const pages = instrumentLandingPages(
      NAVIGABLE_TARGETS,
      probeInputs,
      ORIGIN,
      'fr'
    );
    expect(pages.find((p) => p.body === 'juno')!.extra).toContain(
      '<a href="/fr/missions/juno/">Juno</a>'
    );
  });
});
