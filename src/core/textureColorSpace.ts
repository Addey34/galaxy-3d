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
const DATA_TEXTURE_KEYS: ReadonlySet<string> = new Set([
  'normalMap',
  'bump',
  'displacement',
  'spec',
  'specularMap',
]);

/**
 * LES CARTES À UN SEUL CANAL, téléversées en R8 (un octet par texel au lieu de quatre). Mesuré le
 * 2026-10-17 (lot 54) : le masque spéculaire 8k et la carte de déplacement de la Terre sont
 * EXACTEMENT en niveaux de gris (R = V = B partout) ; le masque 8k passait de 171 à 43 Mio. Leurs
 * lecteurs lisent le canal ROUGE (`layerConfig.ts`), le seul qu'un R8 possède. Une texture livrée
 * sous ces clés doit rester en niveaux de gris : `src/config/singleChannelTextures.test.ts`.
 */
export const SINGLE_CHANNEL_KEYS: ReadonlySet<string> = new Set([
  'spec',
  'specularMap',
  'displacement',
]);

/** Vrai si la texture de cette clé se téléverse sur un seul canal. */
export function isSingleChannel(textureKey: string): boolean {
  return SINGLE_CHANNEL_KEYS.has(textureKey);
}

/** Vrai si la texture de cette clé porte des données plutôt que des couleurs. */
export function isDataTexture(textureKey: string): boolean {
  return DATA_TEXTURE_KEYS.has(textureKey);
}
