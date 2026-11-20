import { describe, expect, it } from 'vitest';
import { createMarkerIntent } from './markerIntent';

const KEY = 'moon|Statio Tranquillitatis';

describe("l'intention du repère", () => {
  it("n'ouvre pas de relance sans demande préalable", () => {
    const intent = createMarkerIntent();
    expect(intent.request(KEY, true, false)).toBeNull();
  });

  it('une relance pendant le chargement ne prend pas la main et ne l’invalide pas', () => {
    const intent = createMarkerIntent();
    const first = intent.request(KEY, false, false);
    expect(first).not.toBeNull();
    expect(intent.request(KEY, true, false)).toBeNull();
    expect(intent.resolved(first as number)).toBe(true);
    expect(intent.status()).toBe('posed');
  });

  it('un abandon avant la réponse empêche la pose, et la relance ne la rouvre pas', () => {
    const intent = createMarkerIntent();
    const first = intent.request(KEY, false, false) as number;
    intent.abandon();
    expect(intent.resolved(first)).toBe(false);
    expect(intent.request(KEY, true, false)).toBeNull();
    expect(intent.status()).toBe('abandoned');
  });

  it('un échec autorise UNE relance du même lieu', () => {
    const intent = createMarkerIntent();
    const first = intent.request(KEY, false, false) as number;
    intent.rejected(first);
    expect(intent.status()).toBe('failed');
    expect(intent.request('mars|Olympus Mons', true, false)).toBeNull();
    expect(intent.request(KEY, true, false)).not.toBeNull();
    // La relance est en cours : une autre relance n'en ouvre pas une seconde.
    expect(intent.request(KEY, true, false)).toBeNull();
  });

  it('échec PUIS abandon : plus aucune relance sans nouvelle demande', () => {
    const intent = createMarkerIntent();
    const first = intent.request(KEY, false, false) as number;
    intent.rejected(first);
    intent.abandon();
    expect(intent.request(KEY, true, false)).toBeNull();
    // Une demande explicite, elle, rouvre la voie.
    expect(intent.request(KEY, false, false)).not.toBeNull();
  });

  it("un rejet ANCIEN du même lieu n'affecte pas l'intention plus récente", () => {
    const intent = createMarkerIntent();
    const old = intent.request(KEY, false, false) as number;
    const latest = intent.request(KEY, false, false) as number;
    expect(latest).not.toBe(old);
    intent.rejected(old);
    expect(intent.status()).toBe('pending');
    expect(intent.resolved(old)).toBe(false);
    expect(intent.resolved(latest)).toBe(true);
  });

  it('une demande neuve vers un lieu dont le repère est affiché ne rouvre rien', () => {
    const intent = createMarkerIntent();
    const first = intent.request(KEY, false, false) as number;
    intent.resolved(first);
    expect(intent.request(KEY, false, true)).toBeNull();
    // Repère retiré (geste de caméra, autre cible) : la demande neuve repose.
    expect(intent.request(KEY, false, false)).not.toBeNull();
  });
});
