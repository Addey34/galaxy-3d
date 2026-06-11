/**
 * Horloge de simulation avec gestion du time-travel et de la vitesse.
 *
 * L'horloge tourne toujours en temps réel (les deux modes Éducatif et Explo
 * partagent cet axe temporel) :
 *     simDate = baseRealTime + offsetMs + (now - baseRealTime) × timeScale
 *
 *   timeScale=1 → temps réel (planètes à leur vraie position maintenant)
 *   timeScale=3 → 3× plus rapide que le temps réel
 *
 * Toutes les méthodes de navigation (addDays…) partent de la date SIMULÉE
 * actuelle pour éviter les sauts quand timeScale > 1.
 */

const MS_PER_DAY = 86_400_000;

export class SimulationClock {
  private _date: Date = new Date();

  // Invariant (l'horloge tourne toujours ainsi, quel que soit le mode educ/explo) :
  //   simDate = _baseRealTime + _offsetMs + (now - _baseRealTime) × _timeScale
  private _baseRealTime = Date.now();
  private _offsetMs     = 0;
  private _timeScale    = 1;

  syncToRealTime(): void {
    const now = Date.now();
    this._date = new Date(
      this._baseRealTime + this._offsetMs + (now - this._baseRealTime) * this._timeScale
    );
  }

  /**
   * Change la vitesse de simulation sans saut de date.
   * Appeler avant de changer la vitesse dans AnimationSystem.
   */
  setTimeScale(scale: number): void {
    const now = Date.now();
    // Préserver la date actuelle : recalculer offsetMs pour la nouvelle base
    this._offsetMs     = this._date.getTime() - now;
    this._baseRealTime = now;
    this._timeScale    = scale;
    this.syncToRealTime();
  }

  // ── Navigation temporelle ─────────────────────────────────────────────────

  /** Déplace la date simulée vers une cible en recalculant l'offset. */
  private _jumpTo(target: Date): void {
    const now = Date.now();
    const realElapsed = now - this._baseRealTime;
    // target = baseRealTime + newOffset + realElapsed * timeScale
    this._offsetMs = target.getTime() - this._baseRealTime - realElapsed * this._timeScale;
    this.syncToRealTime();
  }

  addDays(days: number): void {
    this._jumpTo(new Date(this._date.getTime() + days * MS_PER_DAY));
  }

  addMonths(months: number): void {
    const d = new Date(this._date);
    d.setMonth(d.getMonth() + months);
    this._jumpTo(d);
  }

  addYears(years: number): void {
    this.addMonths(years * 12);
  }

  addHours(hours: number): void {
    this._jumpTo(new Date(this._date.getTime() + hours * 3_600_000));
  }

  addMinutes(minutes: number): void {
    this._jumpTo(new Date(this._date.getTime() + minutes * 60_000));
  }

  addSeconds(seconds: number): void {
    this._jumpTo(new Date(this._date.getTime() + seconds * 1_000));
  }

  resetOffset(): void {
    this._baseRealTime = Date.now();
    this._offsetMs     = 0;
    this.syncToRealTime();
  }

  // ── Getters ───────────────────────────────────────────────────────────────

  get date(): Date      { return this._date; }
  get offsetDays(): number { return this._offsetMs / MS_PER_DAY; }
  get timeScale(): number  { return this._timeScale; }
}
