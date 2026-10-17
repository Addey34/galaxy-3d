/**
 * QUELLES TEXTURES SONT DES DONNÉES ET NON DES COULEURS. Module pur, lu par `TextureSystem` (qui
 * TÉLÉVERSE) et par `celestialTextures` (qui POSE la texture sur un matériau).
 *
 * Une carte de normales, de relief, de déplacement ou de rugosité porte des nombres : elle doit
 * arriver au GPU sans conversion sRGB. Mesuré le 2026-10-17 (lot 54) : un palier chargé APRÈS le
 * branchement du moteur de rendu était téléversé aussitôt en sRGB, puis déclaré brut sans être
 * retéléversé ; le GPU « linéarisait » donc les normales 8k et la carte de déplacement de la Terre
 * (écart de 73 sur 255 avec une lecture brute, 0 une fois retéléversées comme déclarées).
 */
export const DATA_TEXTURE_KEYS: ReadonlySet<string> = new Set([
  'normalMap',
  'bump',
  'displacement',
  'spec',
  'specularMap',
]);

/** Vrai si la texture de cette clé porte des données plutôt que des couleurs. */
export function isDataTexture(textureKey: string): boolean {
  return DATA_TEXTURE_KEYS.has(textureKey);
}
