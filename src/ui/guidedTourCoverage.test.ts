import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOUR_TARGETS } from './guidedTour';

/**
 * LA VISITE DOIT SUIVRE LE DOCK.
 *
 * Défaut réel, signalé par l'utilisateur : la visite guidée s'arrêtait au partage et sautait la
 * capture d'image et le retour d'avis. Ces boutons ont été ajoutés au dock après l'écriture de
 * la visite, et rien ne reliait les deux. Un visiteur à qui l'on présente huit commandes sur
 * douze en déduit que le dock ne mérite pas d'être exploré — et les deux oubliées étaient
 * justement celles qui font revenir (partager une image, donner son avis).
 *
 * Ce test lit `index.html` et exige que CHAQUE commande y soit soit visitée, soit écartée
 * explicitement avec sa raison. Ajouter un bouton sans y penser fait donc échouer le test, avec
 * son identifiant dans le message.
 */

const INDEX_HTML = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');

/**
 * Commandes délibérément hors visite. Chaque exemption porte sa raison : c'est ce qui empêche
 * la liste de devenir une décharge où l'on pousse ce qu'on n'a pas envie de traiter.
 */
const DELIBERATELY_SKIPPED: Record<string, string> = {
  'play-pause-btn':
    'déjà couvert par l’étape du panneau de temps, qui le contient',
  'body-search-trigger':
    'déjà couvert par l’étape de navigation (dock--top-left), qui le contient',
  'fullscreen-btn': 'commande évidente et sans état, elle n’apprend rien',
  'kofi-btn':
    'lien de don : une visite de découverte n’est pas un tunnel de paiement',
  'webxr-btn':
    'masqué tant qu’aucun runtime VR ne répond, donc absent pour la quasi-totalité des visiteurs',
  'smallbody-filters-trigger':
    'réservé au mode Exploration, alors que la visite se déroule en Éducatif',
};

describe('couverture de la visite guidée', () => {
  const controls = [
    ...new Set(
      [...INDEX_HTML.matchAll(/id="([a-z-]*-(?:btn|trigger))"/g)].map(
        (m) => m[1]!
      )
    ),
  ];

  it('trouve bien les commandes du dock dans index.html', () => {
    // Sans cette borne, un changement de nommage viderait la liste et tout le reste passerait.
    expect(controls.length).toBeGreaterThan(10);
    expect(controls).toContain('capture-btn');
    expect(controls).toContain('feedback-btn');
  });

  it.each([
    ...new Set(
      [...INDEX_HTML.matchAll(/id="([a-z-]*-(?:btn|trigger))"/g)].map(
        (m) => m[1]!
      )
    ),
  ])('%s est visité ou écarté avec une raison', (id) => {
    const visited = TOUR_TARGETS.some(
      (target) => target === `#${id}` || target.startsWith('.')
    );
    const skipped = Object.prototype.hasOwnProperty.call(
      DELIBERATELY_SKIPPED,
      id
    );
    expect(
      visited || skipped,
      `#${id} n’est ni dans la visite guidée ni dans la liste des exemptions. Ajouter une étape, ou l’écarter en écrivant POURQUOI dans DELIBERATELY_SKIPPED.`
    ).toBe(true);
  });

  it('vise des éléments qui existent vraiment', () => {
    // Une cible disparue ne casse pas la visite (elle saute l'étape en silence), donc rien ne
    // signalerait un identifiant renommé — la visite se viderait progressivement.
    for (const target of TOUR_TARGETS) {
      if (target.startsWith('.')) continue; // sélecteur de classe : conteneur du dock
      const id = target.slice(1);
      expect(
        INDEX_HTML.includes(`id="${id}"`),
        `la visite vise ${target}, absent de index.html`
      ).toBe(true);
    }
  });

  it('n’écarte rien qui n’existe plus', () => {
    // Une exemption orpheline masquerait un futur bouton qui reprendrait le même identifiant.
    for (const id of Object.keys(DELIBERATELY_SKIPPED))
      expect(controls, `exemption orpheline : ${id}`).toContain(id);
  });
});
