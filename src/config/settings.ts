/**
 * Barrel de configuration — ré-exporte les deux sources de vérité pour compatibilité :
 *   - `engine.ts` : réglages moteur (rendu, perf/LOD, caméra, éclairage, shaders, textures).
 *   - `bodies.ts` : catalogue des corps célestes (`CELESTIAL_CONFIG`).
 *
 * Les nouveaux imports peuvent viser directement `config/engine` ou `config/bodies`.
 */
export * from './engine';
export * from './bodies';
