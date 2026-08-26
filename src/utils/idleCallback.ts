/**
 * `requestIdleCallback` avec repli `setTimeout` — Safari (desktop et iOS) ne l'implémente
 * toujours pas. Utilisé pour repousser un travail non critique (ex. texture d'un corps
 * secondaire) après la rafale d'initialisation, sans bloquer le premier rendu.
 */
export function whenIdle(callback: () => void, timeoutMs = 2000): void {
  const ric = (
    globalThis as unknown as {
      requestIdleCallback?: (
        cb: () => void,
        opts?: { timeout: number }
      ) => void;
    }
  ).requestIdleCallback;
  if (typeof ric === 'function') {
    ric(callback, { timeout: timeoutMs });
  } else {
    setTimeout(callback, 0);
  }
}
