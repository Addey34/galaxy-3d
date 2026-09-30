import { describe, expect, it } from 'vitest';

import {
  derivedSources,
  exitCodeFor,
  judgeResponse,
  markerFor,
  type SourceResult,
} from '../../scripts/check-source-health.mjs';

/**
 * LE GUETTEUR DES SOURCES, CONFRONTÉ À CE QUE LES SOURCES SERVENT VRAIMENT (lot 28).
 *
 * Trois lots ont été bloqués par une source muette, et les trois fois c'est un sondage à la main
 * qui l'a révélé. Un guetteur qui se tromperait de verdict serait pire que pas de guetteur : dire
 * « morte » d'une source vivante finit par le faire ignorer, et dire « vivante » d'une page
 * d'erreur est exactement le défaut qu'il existe pour supprimer.
 *
 * Les fragments ci-dessous sont COPIÉS de réponses réelles, obtenues le 2026-09-29.
 */

/** Début exact de la page « Errors and Messages » que le NSSDCA sert en HTTP 200. */
const NSSDCA_ERROR_PAGE =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" ' +
  '"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">' +
  '<html xmlns="http://www.w3.org/1999/xhtml"><head>' +
  '<title>NASA - NSSDCA - Master Catalog - Errors and Messages</title>';

/** Ce que porte une fiche RÉELLEMENT servie, et rien d'autre ne le porte. */
const NSSDCA_REAL_PAGE =
  '<html><body><b>NSSDCA/COSPAR ID:</b> 2004-030A ... MESSENGER</body></html>';

const CASSINI =
  'https://nssdc.gsfc.nasa.gov/nmc/spacecraft/display.action?id=1997-061A';

describe('santé des sources : le verdict d’une réponse', () => {
  it('dit MUETTE d’une page d’erreur servie en 200, ce qu’aucun contrôle de statut n’attrape', () => {
    const result = judgeResponse({
      url: CASSINI,
      body: NSSDCA_ERROR_PAGE,
      status: 200,
    });
    expect(result.verdict).toBe('muette');
    expect(result.expected).toBe('NSSDCA/COSPAR ID');
    expect(result.status).toBe(200);
  });

  it('dit VIVANTE d’une fiche réellement servie', () => {
    expect(
      judgeResponse({ url: CASSINI, body: NSSDCA_REAL_PAGE, status: 200 })
        .verdict
    ).toBe('vivante');
  });

  it('dit DÉTOURNÉE, et non muette, d’un portail intercalé', () => {
    // Nature renvoie vers son fournisseur d'identité, qui pose un cookie puis rebondit en
    // JavaScript. La dire muette l'accuserait d'avoir perdu son article, ce qui est faux.
    const result = judgeResponse({
      url: 'https://www.nature.com/articles/nature10550',
      finalUrl:
        'https://idp.nature.com/transit?redirect_uri=https%3A%2F%2Fwww.nature.com%2Farticles%2Fnature10550',
      body: '<!DOCTYPE html><html lang="en"><head><meta http-equiv="Content-Security-Policy"',
      status: 200,
    });
    expect(result.verdict).toBe('détournée');
    expect(result.finalUrl).toContain('idp.nature.com');
  });

  it('DÉRIVE le marqueur de l’URL quand elle le porte', () => {
    // arXiv : l'identifiant de l'article. Rien à maintenir, et un article retiré serait vu.
    expect(
      judgeResponse({
        url: 'https://arxiv.org/abs/2211.07987',
        body: 'Astrophysics > ... arXiv:2211.07987 ... submitted',
      }).verdict
    ).toBe('vivante');
    expect(
      judgeResponse({
        url: 'https://arxiv.org/abs/2211.07987',
        body: 'Sorry, the article you requested was not found.',
      }).verdict
    ).toBe('muette');
    // NASA Science : le dernier segment du chemin est le sujet de la page.
    expect(
      judgeResponse({
        url: 'https://science.nasa.gov/saturn/moons/enceladus/',
        body: '<h1>Enceladus</h1> Because Enceladus reflects so much sunlight',
      }).verdict
    ).toBe('vivante');
  });

  /**
   * LE REGISTRE DU PDS REND 200 AVEC ZÉRO RÉSULTAT quand la requête ne correspond à rien, et ces
   * 60 octets ont l'air d'une réponse parfaitement normale. C'est la même classe de piège que la
   * page d'erreur du NSSDCA servie en 200, et que le `like` de cette API qui rend zéro là où `eq`
   * rend un résultat : une requête qui rend zéro n'est pas une absence. Les deux corps ci-dessous
   * sont COPIÉS de réponses réelles, obtenues le 2026-09-30.
   */
  it('dit MUETTE de la réponse à zéro résultat du PDS, qui est un HTTP 200 de 60 octets', () => {
    const url =
      'https://pds.nasa.gov/api/search/1/classes/context?q=pds:Investigation.pds:type eq "Mission"';
    expect(
      judgeResponse({
        url,
        body: '{"summary":{"hits":0,"properties":[],"facets":[]},"data":[]}',
        status: 200,
      }).verdict
    ).toBe('muette');
    expect(
      judgeResponse({
        url,
        body:
          '{"summary":{"hits":112,"properties":["lid","pds:Investigation.pds:name"],' +
          '"facets":[]},"data":[{"id":"urn:esa:psa:context:investigation:mission.em16::1.6"',
        status: 200,
      }).verdict
    ).toBe('vivante');
  });

  it('dit SANS MARQUEUR d’un hôte qu’aucune règle ne couvre, au lieu de le croire vivant', () => {
    expect(
      judgeResponse({ url: 'https://example.test/x', body: 'peu importe' })
        .verdict
    ).toBe('sans-marqueur');
  });
});

describe('santé des sources : ce que le code de sortie commande', () => {
  const of = (verdicts: SourceResult['verdict'][]): SourceResult[] =>
    verdicts.map((verdict, i) => ({ url: `https://x.test/${i}`, verdict }));

  it('sort en 1 pour une source muette, et en 1 même si d’autres vont bien', () => {
    expect(exitCodeFor(of(['vivante', 'muette', 'vivante']))).toBe(1);
  });

  it('sort en 2 quand il n’a PAS PU mesurer : ce n’est pas « tout va bien »', () => {
    expect(exitCodeFor(of(['vivante', 'non-mesurée']))).toBe(2);
    expect(exitCodeFor(of(['vivante', 'détournée']))).toBe(2);
    expect(exitCodeFor(of(['vivante', 'sans-marqueur']))).toBe(2);
  });

  it('ne sort en 0 que si TOUT est vivant', () => {
    expect(exitCodeFor(of(['vivante', 'vivante']))).toBe(0);
    expect(exitCodeFor([])).toBe(0);
  });
});

describe('santé des sources : la liste se DÉRIVE du dépôt', () => {
  const sources = derivedSources();

  it('couvre le relevé des faits ET les capabilities des jeux de tuiles', () => {
    expect(sources.length).toBeGreaterThan(50);
    expect(
      sources.filter((u) => u.startsWith('https://trek.nasa.gov/tiles/')).length
    ).toBeGreaterThan(0);
    expect(
      sources.some((u) =>
        u.startsWith('https://nssdc.gsfc.nasa.gov/nmc/spacecraft/')
      )
    ).toBe(true);
  });

  it('sonde l’API du SBDB, pas la page qui ne dit rien au serveur', () => {
    // Les 22 adresses `sbdb_lookup.html#/?sstr=` du relevé désignent UNE page : un fragment
    // n'est jamais envoyé au serveur. La dépendance réelle est l'API.
    expect(sources).toContain(
      'https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=1&phys-par=1'
    );
    expect(
      sources.some((u) => u.includes('sbdb_lookup.html')),
      'la page SPA ne doit pas être sondée : elle répondrait « vivante » quoi qu’il arrive'
    ).toBe(false);
  });

  it('a un marqueur DÉCLARÉ pour chaque source, sans quoi elle serait sautée en silence', () => {
    // C'est la garde qui compte : ajouter une source au projet l'ajoute à cette liste
    // automatiquement, et si personne ne lui donne de marqueur le guetteur ne dirait rien
    // d'elle. Le silence d'un guetteur ressemble exactement à « tout va bien ».
    const orphans = sources.filter((url) => markerFor(url) === undefined);
    expect(orphans, `sources sans marqueur : ${orphans.join(', ')}`).toEqual(
      []
    );
  });
});
