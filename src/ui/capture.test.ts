import { describe, expect, it } from 'vitest';
import { buildCartoucheText, buildCreditText, wrapText } from './capture';

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

describe('buildCreditText', () => {
  it('joins the credits once each, in order, and drops blanks', () => {
    expect(
      buildCreditText([
        'IGN, BD ORTHO',
        '',
        '  ',
        '© IGN, BD TOPO',
        'IGN, BD ORTHO',
      ])
    ).toBe('IGN, BD ORTHO · © IGN, BD TOPO');
  });
  it('collapses inner whitespace', () => {
    expect(buildCreditText(['NASA \n  GIBS'])).toBe('NASA GIBS');
  });
  it('is empty when nothing is credited', () => {
    expect(buildCreditText([])).toBe('');
  });
});

describe('wrapText', () => {
  const measure = (line: string): number => line.length;
  it('wraps at the width without cutting a word', () => {
    expect(wrapText('aaa bbb ccc ddd', 7, measure)).toEqual([
      'aaa bbb',
      'ccc ddd',
    ]);
  });
  it('keeps a word longer than the width on its own line', () => {
    expect(wrapText('x abcdefghij y', 5, measure)).toEqual([
      'x',
      'abcdefghij',
      'y',
    ]);
  });
  it('returns no line for an empty text', () => {
    expect(wrapText('', 10, measure)).toEqual([]);
  });
});
