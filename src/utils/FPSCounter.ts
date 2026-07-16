/**
 * Compteur d'images par seconde affiché en surimpression (coin haut-droit).
 *
 * Recalcule la moyenne une fois par seconde plutôt qu'à chaque frame, pour un
 * affichage stable et un coût négligeable. Crée son propre élément DOM au `init()`.
 */
export class FPSCounter {
  private frameCount = 0;
  private lastFpsUpdate = 0;
  private fps = 0;
  private fpsCounter: HTMLElement | null = null;

  /** Crée et insère l'élément d'affichage dans le `<body>`. */
  init(): void {
    const element = document.createElement('div');
    element.id = 'fps-counter';
    Object.assign(element.style, {
      position: 'fixed',
      top: '1rem',
      right: '1rem',
      color: 'rgba(255, 255, 255, 0.55)',
      fontFamily: "'SF Mono', 'Cascadia Code', monospace",
      fontSize: '0.72rem',
      letterSpacing: '0.04em',
      backgroundColor: 'rgba(4, 6, 18, 0.55)',
      border: '1px solid rgba(255, 255, 255, 0.10)',
      padding: '0.25rem 0.55rem',
      borderRadius: '0.45rem',
      backdropFilter: 'blur(8px)',
      pointerEvents: 'none',
      zIndex: '100',
    });
    document.body.appendChild(element);
    this.fpsCounter = element;
  }

  /**
   * À appeler une fois par frame avec l'horodatage courant (`performance.now()`).
   * Met à jour l'affichage au plus une fois par seconde.
   */
  update(now: number): void {
    this.frameCount++;
    if (now - this.lastFpsUpdate >= 1000) {
      this.fps = Math.round(
        (this.frameCount * 1000) / (now - this.lastFpsUpdate)
      );
      if (this.fpsCounter) this.fpsCounter.textContent = `FPS: ${this.fps}`;
      this.frameCount = 0;
      this.lastFpsUpdate = now;
    }
  }

  /** Remet à zéro le comptage (ex. après une pause). */
  reset(): void {
    this.frameCount = 0;
    this.lastFpsUpdate = performance.now();
  }

  /** Retire l'élément d'affichage du DOM. */
  dispose(): void {
    this.fpsCounter?.parentNode?.removeChild(this.fpsCounter);
  }
}
