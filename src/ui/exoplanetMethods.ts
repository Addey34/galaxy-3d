/**
 * Les méthodes de découverte de la NASA Exoplanet Archive et la clé de phrase de chacune. Partagé par la
 * fiche d'un système du ciel (`ui/exoplanetCard`) et l'exploration d'un système (`ui/systemExplorer`) :
 * une seule table, aucun des deux morceaux n'emporte l'autre.
 */
/** Méthodes de découverte de l'archive : la clé de phrase de chacune ; une inconnue reste en l'état. */
export const METHOD_KEYS: Readonly<Record<string, string>> = {
  Transit: 'exo.method.transit',
  'Radial Velocity': 'exo.method.radialVelocity',
  Imaging: 'exo.method.imaging',
  Microlensing: 'exo.method.microlensing',
  'Transit Timing Variations': 'exo.method.transitTiming',
  'Eclipse Timing Variations': 'exo.method.eclipseTiming',
  'Orbital Brightness Modulation': 'exo.method.orbitalBrightness',
  'Pulsar Timing': 'exo.method.pulsarTiming',
  'Pulsation Timing Variations': 'exo.method.pulsationTiming',
  Astrometry: 'exo.method.astrometry',
  'Disk Kinematics': 'exo.method.diskKinematics',
};
