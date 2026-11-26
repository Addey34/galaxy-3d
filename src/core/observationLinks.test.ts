import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import tourCatalogue from 'virtual:tour-catalogue';

import craft from '@/registry/craft/models.json';
import {
  bodyLinks,
  probeLinks,
  type ObservationData,
} from './observationLinks';
import type { SearchIndexFile } from './search';

const index = JSON.parse(
  readFileSync('public/assets/search/index.json', 'utf8')
) as SearchIndexFile;

const data: ObservationData = {
  index,
  tours: tourCatalogue,
  craft: (craft as { models: { id: string; targets: string[] }[] }).models,
};

describe('les relations, lues dans les fichiers livrés', () => {
  it('Lune → la visite Apollo 11, qui plonge vers la Station Tranquillité', () => {
    const tour = bodyLinks('moon', data).find(
      (l) => l.kind === 'tour' && l.tour === 'moon-tranquillity'
    );
    expect(tour).toEqual({
      kind: 'tour',
      tour: 'moon-tranquillity',
      place: 'Mare Tranquillitatis',
    });
  });

  it('Pluton → New Horizons (survol mesuré), avec son modèle 3D, et la visite New Horizons', () => {
    const links = bodyLinks('pluto', data);
    const nh = links.find(
      (l) => l.kind === 'probe' && l.probe === 'new-horizons'
    );
    expect(nh).toMatchObject({ relation: 'flyby', model: 'new-horizons' });
    expect(
      links.some((l) => l.kind === 'tour' && l.tour === 'new-horizons-pluto')
    ).toBe(true);
  });

  it('Mars → les sondes, la mise en orbite avant le survol avant la simple mission déclarée', () => {
    const probes = bodyLinks('mars', data).filter((l) => l.kind === 'probe');
    expect(probes.length).toBeGreaterThan(1);
    const ranks = probes.map((p) =>
      p.kind === 'probe'
        ? ['orbit', 'contact', 'flyby', 'mission'].indexOf(p.relation)
        : -1
    );
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    expect(probes[0]).toMatchObject({ relation: 'orbit' });
  });

  it('Saturne → Cassini une seule fois, par sa relation la plus forte (mise en orbite), pas trois', () => {
    const cassini = bodyLinks('saturn', data).filter(
      (l) => l.kind === 'probe' && l.probe === 'cassini'
    );
    expect(cassini).toHaveLength(1);
    expect(cassini[0]).toMatchObject({ relation: 'orbit' });
  });

  it('Terre → satellites ; Soleil → voisinage solaire ; aucun des deux ailleurs', () => {
    expect(bodyLinks('earth', data).some((l) => l.kind === 'satellites')).toBe(
      true
    );
    expect(bodyLinks('sun', data).some((l) => l.kind === 'neighbourhood')).toBe(
      true
    );
    expect(bodyLinks('mars', data).some((l) => l.kind === 'satellites')).toBe(
      false
    );
    expect(
      bodyLinks('mars', data).some((l) => l.kind === 'neighbourhood')
    ).toBe(false);
  });

  it('Voyager 2 → les quatre planètes géantes qu’il a survolées, dans l’ordre des dates', () => {
    const bodies = probeLinks('voyager2', data)
      .filter((l) => l.kind === 'body' && l.relation === 'flyby')
      .map((l) => (l.kind === 'body' ? l.body : ''));
    expect(bodies).toEqual(['jupiter', 'saturn', 'uranus', 'neptune']);
  });

  it('aucune relation sans preuve : un corps sans ligne nulle part n’a ni sonde ni visite', () => {
    const links = bodyLinks('sedna', { ...data, tours: [] });
    expect(links.filter((l) => l.kind === 'probe')).toEqual([]);
  });

  it('chaque sonde reliée est une sonde du catalogue, chaque modèle un modèle du registre', () => {
    const models = new Set(data.craft.map((m) => m.id));
    for (const body of ['mars', 'jupiter', 'saturn', 'pluto', 'earth', 'venus'])
      for (const l of bodyLinks(body, data))
        if (l.kind === 'probe' && l.model)
          expect(models.has(l.model)).toBe(true);
  });

  it('sans index (panne), les visites et les couches restent, les sondes disparaissent', () => {
    const links = bodyLinks('moon', { ...data, index: null });
    expect(links.some((l) => l.kind === 'tour')).toBe(true);
    expect(links.some((l) => l.kind === 'probe')).toBe(false);
  });
});
