import { LOGGER_SETTINGS } from '@/config/engine';

/**
 * Logger minimaliste à niveaux, coloré dans la console du navigateur.
 *
 * Sauf `error`, tous les niveaux ne s'affichent que si `LOGGER_SETTINGS.debug` est
 * activé : la console reste propre en production tout en laissant remonter les erreurs.
 * Exposé en classe statique (pas d'instance à gérer) — `Logger.info(...)`, etc.
 */
class Logger {
  /** Quand false, seuls les messages `error` sont émis. Piloté par la config. */
  static DEBUG = LOGGER_SETTINGS.debug;

  /** Codes ANSI de couleur par niveau (rendus par la console du navigateur). */
  private static readonly colors = {
    reset: '\x1b[0m',
    gray: '\x1b[90m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
  };

  /** Heure locale lisible, préfixée à chaque message. */
  private static timestamp(): string {
    return new Date().toLocaleTimeString();
  }

  /** Cœur de l'affichage : applique le filtre DEBUG, la couleur et le préfixe [heure][NIVEAU]. */
  private static format(level: string, color: string, ...msg: unknown[]): void {
    if (!this.DEBUG && level !== 'error') return;
    console.log(
      `${color}[${this.timestamp()}][${level.toUpperCase()}]${this.colors.reset}`,
      ...msg
    );
  }

  static info(...msg: unknown[]): void {
    this.format('info', this.colors.blue, ...msg);
  }
  static debug(...msg: unknown[]): void {
    this.format('debug', this.colors.gray, ...msg);
  }
  static warn(...msg: unknown[]): void {
    this.format('warn', this.colors.yellow, ...msg);
  }
  static error(...msg: unknown[]): void {
    this.format('error', this.colors.red, ...msg);
  }
  static success(...msg: unknown[]): void {
    this.format('success', this.colors.green, ...msg);
  }

  /** Ouvre un groupe console repliable (no-op hors mode debug). */
  static group(label: string): void {
    if (!this.DEBUG) return;
    console.group(`${this.colors.blue}[${label}]${this.colors.reset}`);
  }

  /** Ferme le groupe console ouvert par `group()`. */
  static groupEnd(): void {
    if (!this.DEBUG) return;
    console.groupEnd();
  }
}

export default Logger;
