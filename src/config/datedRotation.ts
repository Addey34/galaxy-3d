import { Body } from 'astronomy-engine';

/**
 * Les corps dont la PHASE de rotation propre est dérivée de la date (modèle IAU : pôle et angle de
 * méridien W), et non intégrée depuis le chargement.
 *
 * Pourquoi une liste. La phase n'est juste que si la carte du corps suit la convention de l'UAI
 * (longitude 0 au centre de la carte, Est vers la droite, méridien origine = celui du modèle de
 * rotation). Cela se MESURE par corps (`textureOrientation.test.ts` : témoins nommés lus au
 * gazetteer) ; l'activer pour un corps non vérifié le ferait pivoter d'un angle inconnu. La Lune
 * (Mare Crisium, Tycho) et Mars (Syrtis Major) ont leur témoin ; la Terre a sa propre voie, par
 * le temps sidéral (`OrbitalMechanics.syncEarthSurfaceRotation`).
 *
 * Mercure et les corps suivants sont des manques écrits, pas des oublis : même mécanisme, à
 * ouvrir corps par corps dès qu'un témoin de longitude les tient (règle de parité du dépôt).
 * Le critère est la classification (`astroBody`), jamais un nom.
 */
export const DATED_ROTATION_BODIES: ReadonlySet<Body> = new Set([
  Body.Moon,
  Body.Mars,
]);
