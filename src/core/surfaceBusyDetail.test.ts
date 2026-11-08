import { describe, expect, it } from 'vitest';
import {
  formatBusyDetail,
  isBusyDetailConsistent,
  parseBusyDetail,
  type BusyDetail,
} from './surfaceBusyDetail';

const SAMPLE: BusyDetail = {
  busy: 22,
  pending: 3,
  queued: 2,
  held: 17,
  fading: 0,
  missing: 5,
  heldAgeS: 12,
};

describe('surfaceBusyDetail', () => {
  it('écrit une ligne compacte et la relit à l’identique', () => {
    expect(formatBusyDetail(SAMPLE)).toBe('b22p3q2h17f0m5a12');
    expect(parseBusyDetail(formatBusyDetail(SAMPLE))).toEqual(SAMPLE);
  });

  it('relit un fondu négatif (compteur périmé) au lieu de le masquer', () => {
    const stale: BusyDetail = { ...SAMPLE, busy: 4, held: 3, fading: -1 };
    const text = formatBusyDetail({ ...stale, pending: 1, queued: 1 });
    expect(parseBusyDetail(text)?.fading).toBe(-1);
  });

  it('refuse un format inconnu', () => {
    expect(parseBusyDetail('')).toBeNull();
    expect(parseBusyDetail('b22p3')).toBeNull();
    expect(parseBusyDetail('x22p3q2h17f0m5a12')).toBeNull();
  });

  it('vérifie que les parties retrouvent le total', () => {
    expect(isBusyDetailConsistent(SAMPLE)).toBe(true);
    expect(isBusyDetailConsistent({ ...SAMPLE, busy: 23 })).toBe(false);
    // Un fondu négatif n'est jamais cohérent, même si la somme tombe juste.
    expect(
      isBusyDetailConsistent({
        busy: 4,
        pending: 1,
        queued: 1,
        held: 3,
        fading: -1,
        missing: 0,
        heldAgeS: 0,
      })
    ).toBe(false);
  });
});
