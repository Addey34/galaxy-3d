import { describe, expect, it } from 'vitest';
import firebaseJson from '../../firebase.json';
import {
  connectHostsFromFirebase,
  LIVE_DATA_SERVICES,
} from '@/seo/sourcesPage';
import { GALAXY_DATA_ORIGIN } from '@/core/galaxyData';
import { SERVICE_ACCESS } from './serviceAccess';

/**
 * CHAQUE SERVICE QUE LE NAVIGATEUR PEUT JOINDRE EST CLASSÉ (lot 46). La CSP fait foi : c'est
 * elle qui décide ce qu'un navigateur a le droit de joindre.
 */
describe('la classification des services externes', () => {
  const csp = connectHostsFromFirebase(firebaseJson);

  it('couvre EXACTEMENT les hôtes de la CSP, ni plus ni moins', () => {
    expect(csp.length).toBeGreaterThanOrEqual(6);
    expect([...csp].sort()).toEqual(Object.keys(SERVICE_ACCESS).sort());
  });

  it('notre service est bien celui que le client interroge', () => {
    const own = Object.entries(SERVICE_ACCESS)
      .filter(([, s]) => s.access === 'own-service')
      .map(([host]) => host);
    expect(own.sort()).toEqual(
      [
        new URL(GALAXY_DATA_ORIGIN).host,
        'galaxy-static.galaxy-3d.workers.dev',
      ].sort()
    );
  });

  it('un service à quota par IP n’est jamais seul : notre service existe pour lui servir de voie principale', () => {
    const fallbacks = Object.values(SERVICE_ACCESS).filter(
      (s) => s.access === 'quota-fallback'
    );
    expect(fallbacks.length).toBeGreaterThan(0);
    for (const s of fallbacks) expect(s.why).toMatch(/[Rr]epli|au-delà/);
  });

  it('chaque hôte de la CSP est aussi publié sur /sources', () => {
    const published = new Set(LIVE_DATA_SERVICES.map((s) => s.host));
    for (const host of csp) expect(published.has(host), host).toBe(true);
  });
});
