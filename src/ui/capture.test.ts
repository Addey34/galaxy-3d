import { describe, expect, it } from 'vitest';
import { buildCartoucheText } from './capture';

describe('buildCartoucheText', () => {
  const date = new Date('2026-08-28T12:00:00Z');

  it('uses the given body label verbatim as the title', () => {
    const { title } = buildCartoucheText('Mars', date, null);
    expect(title).toBe('Mars');
  });

  it('omits the distance when null (educ mode or no target)', () => {
    const { subtitle } = buildCartoucheText('Mars', date, null);
    expect(subtitle).not.toContain('·');
    expect(subtitle.length).toBeGreaterThan(0);
  });

  it('includes a formatted distance when provided', () => {
    const { subtitle } = buildCartoucheText('Mars', date, 225_000_000);
    expect(subtitle).toContain('·');
  });

  it('produces a deterministic, non-empty date string for a fixed date', () => {
    const a = buildCartoucheText('Overview', date, null);
    const b = buildCartoucheText('Overview', date, null);
    expect(a.subtitle).toBe(b.subtitle);
    expect(a.subtitle.length).toBeGreaterThan(0);
  });
});
