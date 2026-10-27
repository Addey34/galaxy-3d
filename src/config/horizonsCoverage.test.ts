import { describe, expect, it } from 'vitest';
import { isOutsideCoverageText } from '../../scripts/horizons-relative.mjs';

/**
 * HORIZONS DIT « PAS SERVI » DE TROIS FAÇONS, et le générateur doit les lire toutes comme une fin de
 * couverture, pas comme une panne. La troisième est celle de Didymos (920065803) fin octobre 2026,
 * relevée telle quelle dans la réponse de l'API : sans elle, `flybys:generate --check` et
 * `orbits:generate --check` plantaient sur Hera au lieu d'écarter la fenêtre.
 */
describe('isOutsideCoverageText', () => {
  it.each([
    ['sonde sans table', 'Insufficient ephemeris data has been loaded'],
    ['cible sans éphéméride', 'No ephemeris for target "-91"'],
    [
      'centre absent du fichier',
      'API VERSION: 1.2\n\n Center code   920065803 not in indicated file. Inform JPL.\n',
    ],
  ])('lit « %s » comme hors couverture', (_label, text) => {
    expect(isOutsideCoverageText(text)).toBe(true);
  });

  it('ne prend pas une vraie table, ni une erreur de requête, pour une fin de couverture', () => {
    expect(isOutsideCoverageText('$$SOE\n2461000.5, 1, 2, 3\n$$EOE')).toBe(
      false
    );
    expect(isOutsideCoverageText('ERROR: Unknown command parameter')).toBe(
      false
    );
  });
});
