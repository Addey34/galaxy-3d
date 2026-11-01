/**
 * DICTIONNAIRE ANGLAIS DES BLOCS HORS DÉMARRAGE (lot 52, piste C) : les phrases que seuls lisent
 * les blocs de fiche (`ui/cardBlocks`), la recherche typée (`ui/paletteSearch`) et le rideau
 * avant/après (`components/surface/compareCurtain`). Elles pesaient 6 712 octets du démarrage en
 * anglais, et autant dans le dictionnaire de la langue active.
 *
 * Chargé par `./deferredMessages.ts` avec ces morceaux, puis lu par `t()` comme le reste.
 * `CardMessageKey` est dérivé de CET objet : une clé manquante dans une autre langue est une
 * erreur de compilation, comme pour `dict-en.ts`.
 */

export const cardEn = {
  'search.group.dataset': 'Data layers',
  'search.group.place': 'Places',
  'search.group.mission': 'Missions',
  'search.group.instrument': 'Instruments',
  'search.group.discovery': 'Discoveries',
  'search.group.flyby': 'Flybys',
  'search.group.orbitInsertion': 'Orbit insertions',
  'search.group.perihelion': 'Perihelia',
  'search.group.perijove': 'Perijoves',
  'search.group.contact': 'Contacts',
  'search.missionPage': 'mission page',
  'surface.compare.slider': 'Before and after curtain',
  'surface.compare.valuetext':
    '{before} left of the line, {after} right of it, line at {percent} % of the width',
  // LE BLOC « DÉCOUVERTE » (lot 44, ligne 22.10). Aucune phrase ne genre le corps : « this body »
  // et non un pronom, parce que la Lune, Titan et Pluton n'ont pas le même genre en français.
  'bi.discovery.according': '{source}, read on {date}',
  'bi.discovery.prehistoric': 'Since prehistoric times',
  'bi.discovery.ancient': 'Since ancient times',
  'bi.discovery.ancientObservations':
    'Ancient observations going back more than two thousand years',
  'bi.discovery.predictedReturn': 'Predicted return, observed on {date}',
  'bi.discovery.notYetKnown':
    'At the date of the scene, this body was not yet known.',
  'bi.discovery.known':
    'At the date of the scene, this body was already known.',
  'bi.discovery.onTheDay': 'The date of the scene is the day of its discovery.',
  'bi.discovery.withinYear':
    'The date of the scene falls in the year of its discovery, and the source does not give the day.',
  'bi.discovery.withinDates':
    'The date of the scene falls between the published dates: the answer depends on the source.',
  'bi.discovery.moonsKnown':
    'Moons already seen at this date: {count} of the {total} the JPL lists today',
  'bi.discovery.moonsKnownRange':
    'Moons already seen at this date: between {min} and {max} of the {total} the JPL lists today',
  'bi.discovery.moonsKnownOne':
    'Moons already seen at this date: {count} of the only one the JPL lists today',
  'bi.discovery.moonsKnownRangeOne':
    'Moons already seen at this date: between {min} and {max} of the only one the JPL lists today',
  'bi.discovery.moonsNext': 'Next discovery: {year} ({names})',
  'bi.discovery.moonsMore': '{names} and {count} more',
  'bi.discovery.moonsNote':
    'This count only includes the moons the JPL table lists today, read on {date}: a moon announced then refuted is not in it, so this is not what was believed at the time.',
  'bi.discovery.moonsNoteSbdb':
    'This count only includes the satellites the JPL Small-Body Database confirms today, read on {date}: a satellite announced then refuted is not in it, so this is not what was believed at the time.',
  'bi.discovery.moonsUnconfirmed':
    'Not counted, because the database lists them as unconfirmed: {names}.',
  'bi.discovery.names':
    'Surface names the IAU had made official at this date: {count} of {total}',
  'bi.discovery.namesRange':
    'Surface names the IAU had made official at this date: between {min} and {max} of {total}',
  'bi.discovery.lettered':
    'Lettered designations such as “Copernicus A” made official at this date: {count} of {total}',
  'bi.discovery.letteredRange':
    'Lettered designations such as “Copernicus A” made official at this date: between {min} and {max} of {total}',
  'bi.discovery.namesNext': 'Next adoption: {date}, {count} more',
  'bi.discovery.namesNote':
    'Adoption dates from the IAU Gazetteer of Planetary Nomenclature, read on {date}: the date a name became official, not the date the feature was first seen or named.',
  'bi.discovery.refutedThatYear':
    'In {year}, the year of the scene, {who} reports a possible satellite of this body; the source does not give the day.',
  'bi.discovery.refutedReported':
    'At this date, a possible satellite of this body had already been reported: from {year} by {who}, then several more times by other observers, including {others}.',
  'bi.discovery.refutedSearched':
    'A survey submitted on {date} found none, down to about {radius} in radius.',
  'bi.atmosphere.label': 'Measured profile (Galileo probe)',
  'bi.atmosphere.labelNone': 'Measured atmospheric profile',
  'bi.atmosphere.labelTitan': 'Measured profile (Huygens probe)',
  'bi.atmosphere.altitudeSurface': 'Above the ground',
  'bi.atmosphere.ground': 'Ground',
  'bi.atmosphere.localTitan':
    'A single place on Titan, latitude {min}° to {max}°, descended on {date}. The last row is the first reading at ground level; the readings that followed range from {low} to {high} K.',
  'bi.atmosphere.site': 'Latitude read from: {title}, DOI {doi}.',
  'bi.atmosphere.altitude': 'Above 1 bar',
  'bi.atmosphere.pressure': 'Pressure',
  'bi.atmosphere.temperature': 'Temperature',
  'bi.atmosphere.local':
    'One point of the globe, latitude {min}° to {max}°, entered on {date}. The team’s article places it near the edge of a 5-µm hot spot in the north equatorial belt.',
  'bi.atmosphere.adjusted':
    'From {altitude} down, the team fitted the dry adiabat to the data: those rows are not measured points.',
  'bi.atmosphere.citation':
    '{authors} ({year}), {title}, NASA Planetary Data System, DOI {doi}. {reference} Read on {date}.',
  'bi.atmosphere.absent':
    'No temperature and pressure profile of the lower atmosphere is published as data in the NASA Planetary Data System for this planet: {count} collections read on {date}, none of them one.',
  // Missions déclarées sur un corps (voir core/missions.ts et config/missions.ts). Le choix des
  // mots est l'honnêteté de ce bloc : le PDS déclare des CIBLES, ce qui n'est pas un relevé
  // d'observations, et son `start_date` est le début du PROJET et non un lancement (Voyager y
  // commence en 1972, cinq ans avant le décollage de Voyager 1).
  'bi.missions.countAtDate': '{count}, of which {active} at this date',
  'bi.missions.countAllAtDate': '{count}, all at this date',
  'bi.missions.none':
    'No mission in this archive declares this body as a target.',
  'bi.missions.span': '{from} to {to}',
  'bi.missions.spanUndeclared': 'dates not declared',
  'bi.missions.spanEndOnly': 'until {to}, start not declared',
  'bi.missions.spanOpen': 'from {from}, end not declared',
  'bi.missions.atDate': 'had begun at the date of the scene',
  'bi.missions.note':
    'What the PDS archive declares for each mission: the interval of its data and the bodies it takes as targets, read on {date}. A declared target is not a record of observation, and the start is the start of the project, not the launch.',
  // LE BLOC « INSTRUMENTS » D'UNE SONDE (lot 42). « Investigations » et non « phases » : mesuré
  // le 2026-09-30, la SECONDE investigation de Voyager 2 est la campagne d'observation de la
  // collision de Shoemaker-Levy 9 sur Jupiter, qui n'est pas une phase de Voyager 2.
  'bi.instruments.investigations': 'Investigations it appears in',
  'bi.instruments.hostEmpty': '(no instrument declared)',
  // NE NOMME NI NE GENRE RIEN, et c'est voulu : « this mission » serait faux pour le JWST, qui est
  // un observatoire, et un pronom français forcerait un genre que les deux sondes concernées ne
  // partagent pas (« la sonde » Parker, « le télescope » Webb). La phrase dit ce qui est MESURÉ.
  'bi.instruments.absent':
    'The PDS archive declares no investigation here, and therefore no instrument.',
  'bi.instruments.absentNote': 'Read in the PDS archive on {date}.',
  'bi.instruments.note':
    'What the PDS archive declares this spacecraft carries, read on {date}. Each name is the one the archive publishes, and the identifier below it is its citation.',
  'bi.places.count': '{observed} of {total} named',
  'bi.places.search': 'Named formation',
  'bi.places.hint':
    'Type the name of a formation to see which orbiters imaged it.',
  'bi.places.unknown': 'No formation of this body has that name.',
  'bi.places.none':
    'No footprint published by the Orbital Data Explorer touches this formation.',
  'bi.places.unavailable':
    'The observations of this formation could not be loaded.',
  'bi.places.observations': 'Observations: {count}, {span}',
  'bi.places.observationsUndated': 'Observations: {count}, dates not published',
  'bi.places.firstLabel': 'First observation (PDS label)',
  'bi.places.announce': '{name}, instruments: {count}',
  'bi.places.uncovered':
    'Footprints of individual observations were found, in NASA’s Orbital Data Explorer, only for these bodies: {bodies}. No public footprint service was found for this body.',
  'bi.cities.label': '3D cities',
  'bi.cities.hint':
    'Cities whose buildings are drawn in 3D when you come close. Pick one to fly down to it.',
  'bi.cities.go': 'Fly down to {city}',
  'bi.cities.diving': 'Flying down to {city}',
  'bi.cities.name.lyon-bdtopo': 'Lyon',
  'bi.cities.name.marseille-bdtopo': 'Marseille',
  'bi.cities.name.toulouse-bdtopo': 'Toulouse',
  'bi.cities.name.nice-bdtopo': 'Nice',
  'bi.cities.name.bordeaux-bdtopo': 'Bordeaux',
  'bi.cities.name.lille-bdtopo': 'Lille',
  'bi.cities.name.nantes-bdtopo': 'Nantes',
  'bi.cities.name.paris-bdtopo': 'Paris',
  'bi.cities.name.berlin-lod2': 'Berlin',
  'bi.cities.name.nairobi-overture': 'Nairobi',
  'bi.places.note':
    'Footprints read in NASA’s Orbital Data Explorer (PDS Geosciences Node), products created up to {date}. A product whose footprint also covers the antipode of the formation, such as a global map, is not counted.',
};

export type CardMessageKey = keyof typeof cardEn;
