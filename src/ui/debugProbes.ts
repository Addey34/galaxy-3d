/**
 * Les sondes de débogage activées par la query string, réunies en UN morceau chargé à la
 * demande (`MainSolarSystemApp`, sous `hasAnyDebugFlag()`).
 *
 * Chacune reste inerte sans son propre drapeau ; elles étaient pourtant importées
 * statiquement, donc payées par chaque visiteur au démarrage (14 ko bruts, mesurés le
 * 2026-10-14 sur une carte de sources du build). Les regrouper ici leur donne un seul morceau
 * et une seule raison dans `NON_BOOT_CHUNKS`.
 */
export { setupSolarDebug } from './solarDebug';
export { setupGeoDebug } from './geoDebug';
export { setupEarthDebug } from './earthDebug';
export { setupTerminatorProbe } from './terminatorProbe';
export { setupSurfaceProbe } from './surfaceProbe';
export { setupMeteoDebug } from './meteoDebug';
