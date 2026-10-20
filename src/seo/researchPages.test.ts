import { describe, expect, it } from 'vitest';
import { formatPermalinkDate } from '@/core/permalink';
import { LOCALES } from '@/i18n/locales';
import { citationSection } from './citation';
import { docPath, RESEARCH_SLUG } from './documentPage';
import {
  RESEARCH_LINKED_SLUGS,
  researchExampleHref,
  researchPage,
} from './researchPages';

/**
 * LA PORTE « RECHERCHE » (lot 63, pas 3) : une page d'entrée. Ce qu'elle affirme se confronte au
 * code : chaque lien interne est une page que le build génère, l'ancre de citation existe dans la
 * page vers laquelle elle pointe, et l'adresse d'exemple est celle que l'application écrit.
 */
const inputs = {
  origin: 'https://galaxy.adrianguichard.dev',
  repository: 'https://github.com/Addey34/galaxy-3d',
  updated: '2026-10-20',
};

describe.each(LOCALES)('page « recherche » en %s', (locale) => {
  const page = researchPage(inputs, locale);

  it('porte le chemin de sa langue', () => {
    expect(page.slug).toBe(RESEARCH_SLUG);
    expect(page.canonical).toBe(
      `${inputs.origin}${docPath(RESEARCH_SLUG, locale)}`
    );
  });

  it('ne laisse aucun emplacement vide, tiret cadratin ni chiffre écrit à la main', () => {
    expect(page.body).not.toMatch(/\{[a-zA-Z]+\}/);
    expect(page.body + page.title + page.description).not.toContain('—');
    // Aucun nombre dans le texte : ce qui est mesuré se lit sur les pages vers lesquelles on renvoie.
    const text = page.body
      .replace(/<[^>]+>/g, ' ')
      .replace(inputs.origin, '')
      .replace(researchExampleHref(locale), '')
      // La définition du niveau de référence d'une planète géante, pas une mesure.
      .replace('1 bar', '');
    expect(text).not.toMatch(/\d/);
  });

  it('renvoie à chaque famille de documents, dans la langue de la page', () => {
    for (const slug of RESEARCH_LINKED_SLUGS)
      expect(page.body, slug).toContain(`href="${docPath(slug, locale)}`);
  });

  it('pointe l’ancre de citation d’une page qui la porte', () => {
    const cited = citationSection(
      {
        title: 't',
        authors: ['A, B.'],
        version: '1',
        released: '2026-01-01',
        doi: '10.5281/zenodo.1',
        repository: inputs.repository,
        url: inputs.origin,
      },
      locale
    );
    expect(cited).toContain('id="citation"');
    expect(page.body).toContain(
      `href="${docPath('methodology', locale)}#citation"`
    );
  });

  it('écrit l’adresse d’exemple comme l’application écrit un lien partagé', () => {
    const href = researchExampleHref(locale);
    expect(href).toMatch(/^\/([a-z-]+\/)?earth\/\?date=/);
    expect(href).toContain(
      `date=${formatPermalinkDate(new Date(Date.UTC(2016, 5, 21, 12)))}`
    );
    expect(page.body).toContain(`href="${href}"`);
  });
});
