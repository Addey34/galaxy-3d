import { describe, expect, it } from 'vitest';
import {
  QUALITY_PROFILES,
  QUALITY_STORAGE_KEY,
  isQualityMode,
  qualityProfile,
  readQualityMode,
  resolveQualityTier,
  writeQualityMode,
} from './qualityTier';

describe('qualityTier — parsing', () => {
  it('accepte les modes valides et rejette le reste', () => {
    for (const m of ['auto', 'low', 'medium', 'high']) {
      expect(isQualityMode(m)).toBe(true);
    }
    for (const m of ['ultra', '', null, undefined, 42, 'LOW']) {
      expect(isQualityMode(m)).toBe(false);
    }
  });
});

describe('qualityTier — résolution auto', () => {
  it('auto reproduit l ancien binaire IS_MOBILE (mobile→medium, desktop→high)', () => {
    expect(resolveQualityTier('auto', true)).toBe('medium');
    expect(resolveQualityTier('auto', false)).toBe('high');
  });

  it('un mode concret est renvoyé tel quel, quel que soit l appareil', () => {
    for (const isLow of [true, false]) {
      expect(resolveQualityTier('low', isLow)).toBe('low');
      expect(resolveQualityTier('medium', isLow)).toBe('medium');
      expect(resolveQualityTier('high', isLow)).toBe('high');
    }
  });
});

describe('qualityTier — profils', () => {
  it('les profils sont ordonnés (low ≤ medium ≤ high) sur chaque levier', () => {
    const low = qualityProfile('low');
    const med = qualityProfile('medium');
    const high = qualityProfile('high');
    expect(low.maxPixelRatio).toBeLessThanOrEqual(med.maxPixelRatio);
    expect(med.maxPixelRatio).toBeLessThanOrEqual(high.maxPixelRatio);
    expect(low.maxAnisotropy).toBeLessThanOrEqual(med.maxAnisotropy);
    expect(med.maxAnisotropy).toBeLessThanOrEqual(high.maxAnisotropy);
    expect(low.hiResSegments).toBeLessThanOrEqual(med.hiResSegments);
    expect(med.hiResSegments).toBeLessThanOrEqual(high.hiResSegments);
    expect(low.maxTextureQuality).toBe('2k');
    expect(med.maxTextureQuality).toBe('2k');
    expect(high.maxTextureQuality).toBe('8k');
  });

  it('seul high active antialiasing et bloom (leviers coûteux)', () => {
    expect(QUALITY_PROFILES.low.antialias).toBe(false);
    expect(QUALITY_PROFILES.medium.antialias).toBe(false);
    expect(QUALITY_PROFILES.high.antialias).toBe(true);
    expect(QUALITY_PROFILES.high.bloom).toBe(true);
  });

  it('high préserve exactement l ancien réglage desktop', () => {
    const high = qualityProfile('high');
    expect(high.maxPixelRatio).toBe(2);
    expect(high.antialias).toBe(true);
    expect(high.maxAnisotropy).toBe(16);
    expect(high.hiResSegments).toBe(256);
    expect(high.maxTextureQuality).toBe('8k');
  });
});

describe('qualityTier — persistance', () => {
  function memStorage(): Pick<Storage, 'getItem' | 'setItem'> & {
    map: Map<string, string>;
  } {
    const map = new Map<string, string>();
    return {
      map,
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, v),
    };
  }

  it('défaut auto quand rien n est stocké ou valeur invalide', () => {
    const s = memStorage();
    expect(readQualityMode(s)).toBe('auto');
    s.map.set(QUALITY_STORAGE_KEY, 'garbage');
    expect(readQualityMode(s)).toBe('auto');
  });

  it('round-trip write→read', () => {
    const s = memStorage();
    writeQualityMode('low', s);
    expect(readQualityMode(s)).toBe('low');
    writeQualityMode('high', s);
    expect(readQualityMode(s)).toBe('high');
  });
});
