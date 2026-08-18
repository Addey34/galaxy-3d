import { describe, expect, it } from 'vitest';
import { createBackoff } from './retryBackoff';

describe('createBackoff', () => {
  it('allows retry initially', () => {
    const b = createBackoff();
    expect(b.shouldRetry(0)).toBe(true);
  });

  it('blocks retries until retryAt after a failure', () => {
    const b = createBackoff({ baseMs: 1000, maxMs: 8000 });
    b.noteFailure(0);
    expect(b.shouldRetry(500)).toBe(false); // avant le délai
    expect(b.shouldRetry(999)).toBe(false);
    expect(b.shouldRetry(1000)).toBe(true); // pile au délai → autorisé
  });

  it('doubles the delay on successive failures, bounded by maxMs', () => {
    const b = createBackoff({ baseMs: 1000, maxMs: 3000 });
    b.noteFailure(0); // délai 1000 → retryAt 1000, prochain délai 2000
    b.noteFailure(1000); // délai 2000 → retryAt 3000, prochain délai borné à 3000
    expect(b.shouldRetry(2999)).toBe(false);
    expect(b.shouldRetry(3000)).toBe(true);
    b.noteFailure(3000); // délai borné 3000 → retryAt 6000
    expect(b.shouldRetry(5999)).toBe(false);
    expect(b.shouldRetry(6000)).toBe(true);
  });

  it('resets the delay on success', () => {
    const b = createBackoff({ baseMs: 1000, maxMs: 8000 });
    b.noteFailure(0);
    b.noteFailure(1000); // délai monté à 2000
    b.noteSuccess(); // réarme
    expect(b.shouldRetry(0)).toBe(true);
    b.noteFailure(10_000); // repart du baseMs
    expect(b.shouldRetry(10_999)).toBe(false);
    expect(b.shouldRetry(11_000)).toBe(true);
  });
});
