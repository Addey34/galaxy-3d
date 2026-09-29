import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { ILLUSTRATIVE_SURFACES } from './catalog';
import { collectInventory } from '@/inventory/collect';

/**
 * UNE SURFACE INVENTÉE DOIT DIRE POURQUOI, ET QUAND ON L'A VÉRIFIÉ.
 *
 * Vingt-quatre corps portent une texture ILLUSTRATIVE : leurs pixels ne sont pas une mesure. La
 * règle de parité impose alors la seule chose qui rende cela honnête — une raison écrite, et une
 * DATE, parce qu'une absence de source n'est pas éternelle. Une mission passe, une mosaïque est
 * publiée, et la raison d'hier devient un mensonge d'aujourd'hui.
 *
 * Ce qui manquait avant le lot 34 : quatre fiches (Éris, Hauméa, Makémaké, Halley) portaient une
 * raison JUSTE mais sans date, donc invérifiable et sans péremption. Elles portent désormais la
 * vérification du 2026-09-29, faite avec TÉMOIN : l'identifiant `{corps}_image_mosaic` du
 * catalogue USGS rend exactement les 12 012 octets d'un identifiant qui n'a jamais existé, là où
 * deux contrôles positifs en rendent 15 048 et 14 953. Sans ce témoin, les vingt-quatre pages
 * répondaient HTTP 200 et huit marqueurs de téléchargement : j'ai failli annoncer vingt-quatre
 * découvertes qui n'existaient pas.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TEXTURES = join(ROOT, 'src/registry/products/textures');

interface TextureFiche {
  body: string;
  illustrative?: boolean;
  review?: { note?: string };
}

function fiches(): TextureFiche[] {
  return readdirSync(TEXTURES)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(TEXTURES, f), 'utf-8')));
}

const illustrative = fiches().filter((f) => f.illustrative === true);

/** La date de verification, telle qu'une raison l'ecrit. */
const REVIEW_DATE = /\b20\d\d-\d\d-\d\d\b/g;

/** Ce qu'une raison doit NOMMER. Lu dans les fiches livrees, jamais devine. */
const NAMED_SOURCES =
  /USGS|PDS|astrogeology|Solar System Scope|New Horizons|Voyager|Cassini|Dawn|SPHERE|Hubble|shape model/i;

describe('surfaces illustratives : une raison, et une date', () => {
  it('couvre exactement l’ensemble que l’application déclare', () => {
    // `ILLUSTRATIVE_SURFACES` pilote le badge « surface fictive » de la fiche d'info ; une fiche
    // marquée illustrative que l'application ne connaîtrait pas afficherait des pixels inventés
    // sans le dire, et l'inverse mettrait un badge sur une vraie mosaïque.
    expect(illustrative.map((f) => f.body).sort()).toEqual(
      [...ILLUSTRATIVE_SURFACES].sort()
    );
  });

  it('porte une raison ÉCRITE, pas un champ vide', () => {
    for (const fiche of illustrative)
      expect(
        (fiche.review?.note ?? '').length,
        `${fiche.body} : aucune raison écrite`
      ).toBeGreaterThan(40);
  });

  it('porte une DATE de vérification, parce qu’une absence de source périme', () => {
    for (const fiche of illustrative) {
      const note = fiche.review?.note ?? '';
      const date = /\b(20\d\d)-(\d\d)-(\d\d)\b/.exec(note);
      expect(
        date,
        `${fiche.body} : raison sans date de vérification`
      ).not.toBeNull();
      // Une date lisible, pas une suite de chiffres : le mois et le jour doivent exister.
      expect(Number(date![2]), fiche.body).toBeGreaterThanOrEqual(1);
      expect(Number(date![2]), fiche.body).toBeLessThanOrEqual(12);
      expect(Number(date![3]), fiche.body).toBeGreaterThanOrEqual(1);
      expect(Number(date![3]), fiche.body).toBeLessThanOrEqual(31);
    }
  });

  it('nomme ce qui a ete interroge, et pas seulement le constat', () => {
    // « Pas de mosaique » sans dire OU l'on a cherche n'est pas verifiable par le suivant. Le
    // vocabulaire ci-dessous a ete LU dans les vingt-quatre fiches, non devine : il couvre les
    // catalogues interroges (USGS, PDS), les missions dont l'imagerie a ete jugee insuffisante
    // (New Horizons, Voyager, Cassini, Dawn), les observations au sol qui ont servi de parametres
    // (VLT/SPHERE) et l'origine d'une texture reprise telle quelle (Solar System Scope).
    for (const fiche of illustrative)
      expect(
        NAMED_SOURCES.test(fiche.review?.note ?? ''),
        `${fiche.body} : la raison ne nomme aucune source interrogee`
      ).toBe(true);
  });

  it('publie cette date dans l’inventaire, la plus RECENTE de la fiche', () => {
    // L'inventaire listait ces vingt-quatre corps NUS — « aucune mosaique resolue publiee » sans
    // dire depuis quand, ce qui est exactement le defaut que `shapeModelGaps.ts` a ferme pour les
    // formes. Il porte desormais la date, DERIVEE de la fiche et jamais recopiee : ce test est le
    // croisement des deux.
    const rows = new Map(
      collectInventory(ROOT)
        .rows.filter((row) => row.illustrativeSurface)
        .map((row) => [row.id, row.illustrativeVerified])
    );
    expect([...rows.keys()].sort()).toEqual([...ILLUSTRATIVE_SURFACES].sort());
    for (const fiche of illustrative) {
      const dates = (fiche.review?.note ?? '').match(REVIEW_DATE) ?? [];
      expect(rows.get(fiche.body), fiche.body).toBe([...dates].sort().at(-1));
    }
  });
});
