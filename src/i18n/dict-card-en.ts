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
  'deep.card.designation': 'Designation',
  'deep.card.messier': 'Messier',
  'deep.card.constellation': 'Constellation',
  'deep.card.ra': 'Right ascension (J2000)',
  'deep.card.dec': 'Declination (J2000)',
  'deep.card.vmag': 'Visual magnitude',
  'deep.card.size': 'Apparent size',
  'deep.card.unknown': 'not published',
  'deep.card.source':
    'OpenNGC, read on {date}, licence {license}. Only the direction of the object is placed on the sky: the catalogue gives no usable distance, so none is drawn or shown.',
  'deep.card.opened': 'Deep-sky object {name}',
  'deep.unit.arcmin': '{v} arcminutes',
  'deep.search.label': 'Find a deep-sky object',
  'deep.search.placeholder': 'M 31, NGC 224, Andromeda',
  'deep.type.G': 'External galaxy',
  'deep.type.OCl': 'Open cluster',
  'deep.type.ClN': 'Cluster with nebulosity',
  'deep.type.GCl': 'Globular cluster',
  'deep.type.Neb': 'Nebula',
  'deep.type.HII': 'HII region',
  'deep.type.PN': 'Planetary nebula',
  'deep.type.RfN': 'Reflection nebula',
  'deep.type.SNR': 'Supernova remnant',
  'nb.card.kind': 'Star near the Sun',
  'nb.card.members': 'Stars in this system',
  'nb.card.distance': 'Distance from the Sun',
  'nb.card.distanceValue': '{ly} light-years',
  'nb.card.distanceError': '{ly} ± {err} light-years',
  'nb.card.au': 'In astronomical units',
  'nb.card.auValue': '{au} AU',
  'nb.card.scale': 'If Earth were 1 cm from the Sun',
  'nb.card.scaleValue': '{km} km away',
  'nb.card.light': 'Its light takes',
  'nb.card.lightValue': '{years} years to reach us',
  'nb.card.motion': 'Proper motion',
  'nb.card.motionValue': '{v} arcseconds per year',
  'nb.card.rv': 'Radial velocity',
  'nb.card.rvApproaching': '{v} km/s, approaching',
  'nb.card.rvReceding': '{v} km/s, receding',
  'nb.card.spectral': 'Spectral type',
  'nb.card.vmag': 'Visual magnitude',
  'nb.card.unknown': 'not published',
  'nb.card.origin.gaia': 'Distance and motion: Gaia DR3, source {id}.',
  'nb.card.origin.hyg':
    'Distance and motion: HYG v4.4 (Hipparcos and Gliese); no uncertainty is published.',
  'nb.card.hint':
    'The marker shows the real direction of the star. The star itself is not drawn at its distance: the scene stops at the Solar System.',
  'nb.card.source':
    'Sources: Gaia DR3 (ESA) and HYG v4.4 ({license}). Positions are those of J2000.0; the marker follows the proper motion to the date of the scene.',
  'nb.card.opened': 'Nearby star {name}',
  'nb.unit.ly': 'ly',
  'nb.search.label': 'Find a nearby star',
  'nb.search.placeholder': 'Proxima, Sirius, Barnard',
  'st.title': 'Solar neighbourhood in 3D',
  'st.back': 'Back to the Solar System',
  'st.reset': 'Reset the view',
  'st.open': 'See in the solar neighbourhood',
  'st.scale':
    '1 unit = 1 parsec = 3.26 light-years. One circle per parsec around the Sun, in the galactic plane.',
  'st.ring': '{pc} pc · {ly} ly',
  'st.sun': 'Sun',
  'st.centre': 'Galactic centre (direction)',
  'st.symbolic':
    'Points are symbols of a constant size: the real size of a star is not drawn. The colour follows the spectral type.',
  'st.frame':
    'Galactic frame: x toward the galactic centre, z toward the north galactic pole. Positions are those of the scene date, moved in a straight line from the J2000 catalogue values.',
  'st.help':
    'Drag to rotate, scroll or pinch to zoom, right-drag or two fingers to move. Keyboard: arrow keys rotate, plus and minus zoom, Home resets, Escape goes back.',
  'st.list': 'Stars of the neighbourhood',
  'st.listItem': '{name}, {ly} light-years',
  'st.selected': 'Selected star',
  'st.noSelection': 'Select a star to see its distance and its position.',
  'st.distSun': 'Distance from the Sun (published)',
  'st.distAtDate': 'Distance from the Sun at this date',
  'st.position': 'Position (x, y, z)',
  'st.positionValue': '{x}, {y}, {z} pc',
  'st.timeLabel': 'Years from the scene date',
  'st.timeNow': 'The scene date',
  'st.timeValue': '{years} years, year {year}',
  'st.timeLimit':
    'Straight-line motion, limited to 10,000 years either side of J2000: beyond that the approximation is not defensible.',
  'st.noRadial':
    'No radial velocity is published for this star: its motion toward or away from the Sun is not included.',
  'st.opened': 'Solar neighbourhood in 3D. {n} star systems around the Sun.',
  'st.closed': 'Back to the Solar System.',
  'st.selectedAnnounce': '{name}, {ly} light-years from the Sun.',
  'st.unavailable':
    'The 3D view is not available: the graphics context is not responding.',
  'st.unknownStar':
    'The link names a star that is not among the nearby stars. The view is open with no star selected.',
  'st.dataUnavailable':
    'The 3D view is not available: the file of nearby stars could not be read.',
  'st.fieldAu': 'Field width at the Sun: {au} AU',
  'st.fieldLy': 'Field width at the Sun: {ly} ly ({pc} pc)',
  'st.ringAu': '{au} AU',
  'st.stageAu':
    'Inside the Solar System: the unit is the astronomical unit (AU), the mean Earth–Sun distance, {km} million km. Orange circles: 1, 10, 100… AU, in the plane of the planets.',
  'st.stageLy':
    'Between the stars: the unit is the light-year (1 parsec = {ly} light-years = {au} AU). Blue circles: one per parsec, in the galactic plane.',
  'st.stageNote':
    'A change of scale, not a journey: the Sun stays at the centre and only the field widens, in a single galactic frame. No speed is implied.',
  'st.skip': 'Skip the transition',
  'sv.visit.start': 'Guided visit',
  'sv.visit.region': 'Guided visit of the Sun’s neighbours',
  'sv.visit.progress': 'Stop {n} of {total}',
  'sv.visit.prev': 'Previous stop',
  'sv.visit.next': 'Next stop',
  'sv.visit.finish': 'Finish the visit',
  'sv.visit.leave': 'Leave the visit and explore freely',
  'sv.visit.resume': 'Resume the visit (stop {n} of {total})',
  'sv.visit.end': 'End the visit',
  'sv.visit.paused':
    'The visit is paused. The stars, the time slider and the camera are yours.',
  'sv.visit.data': 'This star in the data',
  'sv.visit.fact.pm': 'Proper motion',
  'sv.visit.fact.pmValue': '{pm} mas/yr',
  'sv.visit.fact.rv': 'Radial velocity',
  'sv.visit.fact.rvValue': '{rv} km/s',
  'sv.visit.fact.planets': 'Planets listed by the archive',
  'sv.visit.fact.none': 'none',
  'sv.visit.reading': 'How to read this stop',
  'sv.visit.reading.measured':
    'Measured: position, proper motion, radial velocity and spectral type (Gaia DR3, or HYG where Gaia is unsure).',
  'sv.visit.reading.catalogued':
    'Catalogued: the planets of the NASA Exoplanet Archive (snapshot of {date}), with the status the archive gives them.',
  'sv.visit.reading.calculated':
    'Calculated: the position at another year, from a straight-line motion. It is not a measurement.',
  'sv.visit.reading.illustrative':
    'Illustrative: the dots are symbols. No planet, texture or surface is drawn.',
  'sv.visit.reading.unknown':
    'Unknown here: the radius, mass and age of these stars are not in this view’s data.',
  'sv.visit.approaching': 'is approaching the Sun',
  'sv.visit.receding': 'is moving away from the Sun',
  'sv.visit.unknown':
    'That guided visit does not exist: the view opens without it.',
  'sv.visit.opened': 'Guided visit started. Stop {n} of {total}: {title}.',
  'sv.visit.stop': 'Stop {n} of {total}: {title}.',
  'sv.visit.left': 'Visit paused. You can explore freely.',
  'sv.visit.finished': 'Visit finished. You can keep exploring.',
  'sv.visit.noArchive':
    'The exoplanet archive could not be read: planet counts are not shown.',
  'sv.visit.archive.none':
    'The NASA Exoplanet Archive lists no planet for this star.',
  'sv.visit.archive.one':
    'The NASA Exoplanet Archive lists {n} planet for this star, with the status the archive gives it.',
  'sv.visit.archive.many':
    'The NASA Exoplanet Archive lists {n} planets for this star, with the status the archive gives them.',
  'sv.visit.archive.loading':
    'The planet count from the NASA Exoplanet Archive is still loading.',
  'sv.visit.archive.unavailable':
    'The NASA Exoplanet Archive could not be read: no planet count is given here, and a missing count does not mean zero planets.',
  'st.transitionStart':
    'Changing scale: from the Solar System, in astronomical units, to the neighbourhood, in light-years.',
  'exo.card.unknown': 'not published',
  'exo.card.period': 'Orbital period',
  'exo.card.radius': 'Radius',
  'exo.card.axis': 'Semi-major axis',
  'exo.card.year': 'Discovered',
  'exo.card.method': 'Method',
  'exo.card.planets.one': '{count} known planet',
  'exo.card.planets.other': '{count} known planets',
  'exo.card.distance': '{ly} light-years away',
  'exo.card.distanceUnknown': 'Distance not published',
  'exo.card.source':
    'NASA Exoplanet Archive, read on {date}. The planets are not drawn: only their host star is placed on the sky. For a planet found by radial velocity, the radius is usually calculated by the archive from the mass, not measured.',
  'exo.card.opened': 'System {name}, {count} known planets',
  'exo.unit.days': '{v} days',
  'exo.unit.earthRadii': '{v} Earth radii',
  'exo.unit.au': '{v} AU',
  'exo.search.label': 'Find a planetary system',
  'exo.search.placeholder': 'Host star name',
  'exo.method.transit': 'Transit',
  'exo.method.radialVelocity': 'Radial velocity',
  'exo.method.imaging': 'Direct imaging',
  'exo.method.microlensing': 'Microlensing',
  'exo.method.transitTiming': 'Transit timing variations',
  'exo.method.eclipseTiming': 'Eclipse timing variations',
  'exo.method.orbitalBrightness': 'Orbital brightness modulation',
  'exo.method.pulsarTiming': 'Pulsar timing',
  'exo.method.pulsationTiming': 'Pulsation timing variations',
  'exo.method.astrometry': 'Astrometry',
  'exo.method.diskKinematics': 'Disk kinematics',
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
  'place.marker.hint':
    'View turned toward this place. Move closer to see names on the surface.',
  'place.marker.announce':
    '{place}, {body}: the view is turned toward this place. Move closer to see names on the surface.',
  'bi.places.count':
    '{observed} observed of {evaluated} evaluated in the published ODE dataset.',
  'bi.places.countNamed': '{named} named in the IAU catalogue.',
  'bi.places.search': 'Named formation',
  'bi.places.hint':
    'Type the name of a formation to see which orbiters imaged it.',
  'bi.places.unknown': 'No formation of this body has that name.',
  'bi.places.none':
    'No footprint published by the Orbital Data Explorer touches this formation.',
  'bi.places.notEvaluated':
    'This formation was not evaluated in the ODE dataset currently published.',
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
  'bi.cities.name.strasbourg-bdtopo': 'Strasbourg',
  'bi.cities.name.montpellier-bdtopo': 'Montpellier',
  'bi.cities.name.rennes-bdtopo': 'Rennes',
  'bi.cities.name.grenoble-bdtopo': 'Grenoble',
  'bi.cities.name.toulon-bdtopo': 'Toulon',
  'bi.cities.name.dijon-bdtopo': 'Dijon',
  'bi.cities.name.angers-bdtopo': 'Angers',
  'bi.cities.name.reims-bdtopo': 'Reims',
  'bi.cities.name.nimes-bdtopo': 'Nîmes',
  'bi.cities.name.saintetienne-bdtopo': 'Saint-Étienne',
  'bi.cities.name.newyork-opendata': 'New York',
  'bi.cities.name.london-overture': 'London',
  'bi.cities.name.amsterdam-3dbag': 'Amsterdam',
  'bi.cities.name.rotterdam-3dbag': 'Rotterdam',
  'bi.cities.name.denhaag-3dbag': 'The Hague',
  'bi.cities.name.utrecht-3dbag': 'Utrecht',
  'bi.cities.name.eindhoven-3dbag': 'Eindhoven',
  'bi.cities.name.chicago-overture': 'Chicago',
  'bi.cities.name.singapore-overture': 'Singapore',
  'bi.cities.name.sydney-overture': 'Sydney',
  'bi.cities.name.paris-bdtopo': 'Paris',
  'bi.cities.name.berlin-lod2': 'Berlin',
  'bi.cities.name.nairobi-overture': 'Nairobi',
  'bi.places.note':
    'Footprints read in NASA’s Orbital Data Explorer (PDS Geosciences Node), products created up to {date}. A product whose footprint also covers the antipode of the formation, such as a global map, is not counted.',
  'inspect.title': 'Weather at a point',
  'inspect.hint.pick':
    'Click or tap the globe, or enter coordinates, to read the layers that are on.',
  'inspect.hint.noLayers':
    'No inspectable layer is on. Turn on a model layer (temperature, pressure, humidity, rain, clouds or wind) in the weather panel. The inspector never turns one on for you.',
  'inspect.hint.images':
    'Satellite and NASA GIBS layers are images: they are not read here.',
  'inspect.lat': 'Latitude',
  'inspect.lon': 'Longitude',
  'inspect.go': 'Read this point',
  'inspect.center': 'Use the center of the view',
  'inspect.offGlobe': 'The center of the view is not on the globe.',
  'inspect.badCoords':
    'Enter a latitude from −90 to 90 and a longitude from −180 to 180.',
  'inspect.details': 'Source and date',
  'inspect.expand': 'Show the full card',
  'inspect.collapse': 'Show less',
  'inspect.about': 'About these values',
  'inspect.summary': 'Readings at this point',
  'inspect.caveat':
    'Values are interpolated from a model grid. They are not a measurement at this exact spot.',
  'inspect.selected': 'Point selected: {lat}, {lon}.',
  'inspect.var.temperature': 'Temperature (2 m)',
  'inspect.var.pressure': 'Sea-level pressure',
  'inspect.var.humidity': 'Relative humidity',
  'inspect.var.precipitation': 'Precipitation',
  'inspect.var.cloudCover': 'Cloud cover (model)',
  'inspect.var.wind': 'Wind (10 m)',
  'inspect.msg.missing': 'No value in the model at this point.',
  'inspect.msg.outOfCoverage': 'Outside the coverage of the grid.',
  'inspect.msg.stale':
    'Out of date: the loaded grid is for another time, so no value is shown.',
  'inspect.msg.staleError':
    'The update failed. The loaded grid is for another time, so no value is shown.',
  'inspect.msg.updating': 'Updating for the new date…',
  'inspect.msg.outOfRange': 'This date is outside the range of the model.',
  'inspect.msg.error': 'The data could not be loaded.',
  'inspect.msg.loading': 'Loading…',
  'inspect.wind.calm': 'Calm: no meaningful direction',
  'inspect.wind.from': 'Coming from: {dir} · {deg}°',
  'inspect.dir.N': 'N',
  'inspect.dir.NE': 'NE',
  'inspect.dir.E': 'E',
  'inspect.dir.SE': 'SE',
  'inspect.dir.S': 'S',
  'inspect.dir.SW': 'SW',
  'inspect.dir.W': 'W',
  'inspect.dir.NW': 'NW',
  'inspect.precip.rate': 'Instantaneous rate (GFS)',
  'inspect.precip.accumulation': 'Accumulated over the previous hour',
  'inspect.precip.none': 'No precipitation',
  'inspect.meta.source': 'Source',
  'inspect.meta.nature': 'Nature',
  'inspect.meta.effective': 'Valid for',
  'inspect.meta.requested': 'Requested hour',
  'inspect.meta.offset': '{h} h from the requested hour',
  'inspect.meta.grid': 'Grid',
  'inspect.meta.gridValue': '{step}° grid, interpolated',
  'craft.button': 'Inspect in 3D',
  'craft.issButton': 'Inspect the ISS in 3D',
  'craft.noModel':
    'No reliable 3D model of this probe is available here: nothing is drawn rather than an invented shape.',
  'craft.title': '{name}: 3D inspection',
  'craft.close': 'Close the inspection',
  'craft.reset': 'Reset the view',
  'craft.loading': 'Loading the 3D model…',
  'craft.failed': 'The 3D model could not be loaded. The scene is unchanged.',
  'craft.unavailable':
    'The 3D inspection is not available: the graphics context is not responding.',
  'craft.help':
    'Drag or use the arrow keys to turn the model. Scroll, pinch, or use + and - to zoom. Home resets the view, Escape closes it.',
  'craft.scale':
    'Presentation scale: the craft is shown enlarged here so it can be inspected. In the astronomical scene it is never enlarged.',
  'craft.fidelity':
    'Representative model from NASA’s 3D Resources collection. Its proportions and details are those of the file: this project has not checked them against engineering drawings.',
  'craft.rights':
    'NASA states that content used to render 3D models is generally not subject to copyright in the United States (NASA Images and Media Usage Guidelines, read on 2026-11-23). No endorsement by NASA is implied.',
  'craft.parts': 'Parts named in the file',
  'craft.partsNone':
    'This model is a single block: its file does not name separate parts.',
  'craft.instruments': 'Instruments declared in the PDS archive',
  'craft.instrumentsNote':
    'The list comes from the PDS context registry, not from the 3D model: the model does not say where each instrument sits.',
  'craft.provenance': 'Provenance',
  'craft.source': 'Source file',
  'craft.credit': 'Credit: {credit}',
  'craft.file': '{kb} KB, {tris} triangles, SHA-256 {hash}…',
  'craft.opened': 'Inspecting {name} in 3D.',
  'craft.closed': 'Back to the previous view.',
  'craft.partOn': '{part} highlighted.',
  'craft.partOff': 'Highlight removed.',
  'sat.kind': 'Object in orbit',
  'sat.group.stations': 'Group: space stations',
  'sat.group.visual': 'Group: brightest objects',
  'sat.unknown': 'not published',
  'sat.norad': 'NORAD catalogue number',
  'sat.designator': 'International designator (COSPAR)',
  'sat.period': 'Orbital period',
  'sat.minutes': '{n} min',
  'sat.altitudes': 'Altitude, perigee to apogee',
  'sat.altitudesValue': '{perigee} to {apogee} km',
  'sat.inclination': 'Inclination',
  'sat.eccentricity': 'Eccentricity',
  'sat.epoch': 'Epoch of the elements',
  'sat.validity': 'Elements valid',
  'sat.validityValue': 'from {from} to {to}',
  'sat.altitude': 'Altitude now (SGP4)',
  'sat.km': '{n} km',
  'sat.speed': 'Speed now (SGP4)',
  'sat.kmPerS': '{n} km/s',
  'sat.over': 'Over (SGP4)',
  'sat.outside':
    'At the date of the scene these elements are out of validity: the object is not drawn rather than drawn in the wrong place.',
  'sat.model.iss':
    'The ISS has a 3D model (NASA 3D Resources). It is shown enlarged in the inspection only; in space it stays a point.',
  'sat.model.none':
    'No 3D model for this object: it stays a point rather than an invented shape.',
  'sat.source':
    'Elements from CelesTrak (18th Space Defense Squadron), read on {date} UTC by the Galaxy data service and propagated with SGP4. The error grows by a few kilometres per day around the epoch. Altitude, speed and position are computed, not measured.',
  'sat.opened': '{name}: satellite card opened.',
  'sat.search.label': 'Find a satellite',
  'sat.search.placeholder': 'Type a name, e.g. ISS',
  'sat.follow': 'Follow this object',
  'sat.unfollow': 'Stop following',
  'sat.following':
    '{name}: the camera follows the object. Turn, zoom, or stop following at any time.',
  'sat.followChip': 'Following {name}',
  'sat.followEnded': '{name}: following stopped.',
  'sat.followEndedOutside':
    '{name}: following stopped, the elements are out of validity at this date.',
  'sat.followEndedNoSolution':
    '{name}: following stopped, SGP4 has no position for this date.',
  'sat.path':
    'Orbit path: one period ahead of the scene date, computed by SGP4 from the elements. It is not measured, and no past path is drawn. The arrows show the direction of travel.',
  'sat.pathTruncated': 'The path stops where the elements stop being valid.',
  'sx.open': 'Explore this system',
  'sx.unavailable': 'The system exploration could not be loaded.',
  'sx.title': 'The {name} system',
  'sx.back': 'Back to the neighbourhood',
  'sx.reset': 'Whole system',
  'sx.compare': 'Compare with the Solar System',
  'sx.scale':
    'One unit is one astronomical unit (the Earth-Sun distance). Orbits are drawn face-on.',
  'sx.field': 'Field of view: {au} AU across',
  'sx.help':
    'Drag to turn, scroll or pinch to zoom, tap a star or an orbit. Keyboard: arrows turn, + and - zoom, Home shows the whole system, Escape returns to the neighbourhood. The list gives the same access.',
  'sx.list': 'In this system',
  'sx.listStar': '{name} (star)',
  'sx.listPlanet': '{name} (planet)',
  'sx.listPlanetNoOrbit': '{name} (planet, orbit not drawn)',
  'sx.opened':
    'System {name} open: {stars} stars in the catalogue, {planets} catalogued planets.',
  'sx.selected': '{name} selected',
  'sx.closed': 'Back to the solar neighbourhood.',
  'sx.archiveUnavailable':
    'The planet archive could not be read: only the stars are shown.',
  'sx.doc.noPlanets':
    'No orbit to draw: the archive lists no planet for this system (snapshot of {date}). That does not mean it has none.',
  'sx.doc.noAxis':
    'No orbit to draw: its planets have neither a semi-major axis nor a stellar mass to derive one. Their facts are in the list.',
  'sx.missingHosts':
    'Recognised in the sky layer but absent from the detailed snapshot: {hosts}.',
  'sx.star.separation': 'Projected separation from {name}',
  'sx.star.separationValue':
    '{au} AU (derived from the catalogue positions: a minimum, the distance along the line of sight is unknown)',
  'sx.star.teff': 'Effective temperature',
  'sx.star.radius': 'Radius',
  'sx.star.mass': 'Mass',
  'sx.star.noHost': 'No planet of the archive is attributed to this star.',
  'sx.star.hostOf':
    'NASA Exoplanet Archive: host "{host}", {count} catalogued planets drawn or listed here.',
  'sx.star.trueSize':
    'The star is drawn at its published radius; its point keeps a constant size on screen so it can be found from afar.',
  'sx.star.archiveStars':
    'The archive counts {n} stars in this system; the neighbourhood catalogue groups {m} here (a companion more than one arcminute away is its own marker).',
  'sx.planet.star': 'Host star',
  'sx.planet.eccentricity': 'Eccentricity',
  'sx.planet.eccZero': '0 (published; often fixed at zero by the fit)',
  'sx.planet.eccUnknown':
    'not published: the orbit is a dashed circle at its semi-major axis',
  'sx.planet.range': 'Distance to the star',
  'sx.planet.rangeValue': 'from {q} to {Q} AU',
  'sx.planet.inclination': 'Inclination',
  'sx.planet.mass': 'Mass',
  'sx.planet.noOrbit':
    'Neither a semi-major axis nor a stellar mass to derive one: the orbit is not drawn.',
  'sx.planet.position':
    'Where the planet is on its orbit is not known: its name marks the orbit, not the planet.',
  'sx.planet.radiusCalculated':
    'Its radius was not measured: the archive calculates it from the mass.',
  'sx.planet.controversial': 'The archive flags this planet as controversial.',
  'sx.planet.circumbinary':
    'The archive lists it as circumbinary (orbiting two stars).',
  'sx.tag.calculated': 'calculated by the archive',
  'sx.tag.derived': "derived here, Kepler's third law",
  'sx.tag.minimum': 'minimum mass, m sin i',
  'sx.tag.trueMass': 'mass',
  'sx.unit.kelvin': '{v} K',
  'sx.unit.solarRadii': '{v} solar radii',
  'sx.unit.solarMasses': '{v} solar masses',
  'sx.unit.earthMasses': '{v} Earth masses',
  'sx.unit.degrees': '{v}°',
  'sx.table.title': 'Compare the planets',
  'sx.table.planet': 'Planet',
  'sx.table.caption':
    "Period in days, semi-major axis in AU, mass in Earth masses, radius in Earth radii. † calculated by the archive; ‡ derived here (Kepler's third law); ≥ minimum mass (m sin i); a dash: not published.",
  'sx.compare.note':
    'Grey dashed circles: the orbits of the Solar System planets at the same scale (semi-major axes, NSSDCA), centred on {name}.',
  'sx.compare.ring': '{name} (Solar System)',
  'sx.read.title': 'How to read this view',
  'sx.read.measured':
    'Measured: star positions, distances and motion (Gaia DR3 or HYG), and the projected separation between two stars of the system.',
  'sx.read.catalogued':
    'Catalogued: the planets and their orbits, from the NASA Exoplanet Archive (snapshot of {date}). Each value says when the archive calculated it instead of taking it from a publication.',
  'sx.read.derived':
    "Derived here: a semi-major axis computed from the period and the stellar mass (Kepler's third law), marked as such.",
  'sx.read.illustrative':
    'Illustrative: orbits are drawn face-on because their orientation on the sky is not published (the node never is, the tilt rarely); a band runs from the closest to the farthest distance to the star; a dashed circle means the eccentricity is not published; colours only tell the orbits apart.',
  'sx.read.unknown':
    'Unknown: where each planet is on its orbit, how the orbits are tilted, the distance between the stars along the line of sight. Nothing is drawn for them.',
  'sx.sources':
    'Stars: neighbourhood catalogue (Gaia DR3 or HYG). Planets and host star: NASA Exoplanet Archive, table pscomppars, snapshot of {date}.',
  'sx.sourcesStars': 'Stars: neighbourhood catalogue (Gaia DR3 or HYG).',
  'sx.star.spectral': 'Spectral type (neighbourhood catalogue)',
  'sx.star.spectralArchive': 'Spectral type (archive)',
  'sx.backSky': 'Back to the sky',
  'sx.closedSky': 'Back to the sky.',
  'sx.unknownHost':
    'This planetary system is not in the sky catalogue: the exploration does not open.',
  'sx.star.distanceArchive': 'Distance from the Sun (archive)',
  'sx.star.originArchive':
    'Star known from the NASA Exoplanet Archive only (it is not in the neighbourhood catalogue): its other stars, if any, are not placed, since the archive gives their number, not their positions.',
  'sx.star.circumbinary':
    'At least one planet orbits a PAIR of stars here (circumbinary in the archive): its orbit is drawn around the centre of the system, and no single star is drawn there, since the positions of the two stars are not in the data.',
  'sx.star.archiveStarsSky': 'The archive counts {n} stars in this system.',
  'sx.helpSky':
    'Drag to turn, scroll or pinch to zoom, tap a star or an orbit. Keyboard: arrows turn, + and - zoom, Home shows the whole system, Escape returns to the sky. The list gives the same access.',
  'sx.read.measuredSky':
    'Published: the distance of the system and the parameters of its host star, as the archive gives them.',
  'sx.sourcesSky':
    'Star and planets: NASA Exoplanet Archive, table pscomppars, snapshot of {date}.',
  'obs.label': 'Continue observing',
  'obs.tour': 'Guided tour: {title}',
  'obs.tourPlace': 'Guided tour: {title} ({place})',
  'obs.orbit': '{probe}, in orbit from {date}',
  'obs.contact': '{probe}, contact with the body on {date}',
  'obs.flyby': '{probe}, flyby on {date}',
  'obs.mission': '{probe}, mission declared for this body',
  'obs.missionFrom': '{probe}, at this body from {date}',
  'obs.bodyOrbit': '{body}: orbit insertion on {date}',
  'obs.bodyContact': '{body}: contact on {date}',
  'obs.bodyFlyby': '{body}: closest approach on {date}',
  'obs.bodyMission': '{body}: mission target',
  'obs.bodyMissionFrom': '{body}: at this body from {date}',
  'obs.inspect': 'Inspect {probe} in 3D',
  'obs.event': 'Next event: {event}, {date}',
  'obs.satellites': 'Show the satellites in orbit',
  'obs.neighbourhood': 'Leave for the solar neighbourhood',
  'obs.back': 'Back to {body}, {date}',
  'obs.note':
    'Each link comes from a measurement or a registry shipped with Galaxy.',
  'ed.title': 'Observations of the atmosphere',
  'ed.info':
    'Hubble (OPAL), observed on {date}, from a source map {px} px wide; {share} of the surface is completed with measured mean colours, without invented detail.',
  'ed.scene':
    'Scene date: {date}. Nothing is interpolated between two observations, and the planet’s rotation phase is not dated: the longitudes of its features are not those of the scene.',
  'ed.limits':
    'Comparing observations: the producer stretches each one’s colours separately, and coverage and resolution differ, so part of what changes comes from the processing, not from the planet.',
  'ed.compare': 'Compare with {date}',
  'ed.loading': 'Loading the observation of {date}…',
  'ed.unavailable':
    'The observation of {date} could not be loaded: the one of {shown} stays on screen.',
  'vol.heading': 'Explore farther',
  'vol.scaleButton': '{pc} pc',
  'vol.scaleLabel':
    '{pc} pc: show the stars up to {pc} parsecs ({ly} light-years)',
  'vol.neighbourhoodOnly':
    'The 61 stars within 5 pc. Choose a larger scale to load the Gaia catalogue of nearby stars.',
  'vol.loading': 'Loading the stars up to {pc} pc…',
  'vol.loaded':
    '{count} stars shown up to {pc} pc, beyond the 5 pc neighbourhood.',
  'vol.failed':
    'The stars beyond 5 pc could not all be loaded: the view stays at {pc} pc.',
  'vol.coverage':
    'Gaia Catalogue of Nearby Stars (Gaia EDR3, 2021): the objects whose median distance is within 100 pc. It is not every star: the faintest objects are missing, and the brightest, too bright for Gaia, come from Hipparcos.',
  'vol.filter': 'Show',
  'vol.filter.all': 'All the stars',
  'vol.filter.whiteDwarfs': 'Probable white dwarfs',
  'vol.filter.exoplanetHosts': 'Exoplanet hosts',
  'vol.filter.radialVelocity': 'With a published radial velocity',
  'vol.search': 'Find a named star',
  'vol.searchPlaceholder': 'Vega, 51 Peg, HD 10700…',
  'vol.searchNone': 'No named star matches.',
  'vol.gaiaName': 'Gaia DR3 {id}',
  'vol.unnamed': 'Star no. {n} of the volume',
  'vol.distanceGcns':
    '{pc} pc ({ly} ly): median of the GCNS distance distribution, 68 % between {lo} and {hi} pc',
  'vol.distanceRel': '{pc} pc ({ly} ly), ±{pct} % (GCNS)',
  'vol.distancePlain': '{pc} pc ({ly} ly)',
  'vol.distanceHyg': '{pc} pc ({ly} ly), from the Hipparcos parallax',
  'vol.distanceSimbad': '{pc} pc ({ly} ly), from the parallax listed by SIMBAD',
  'vol.magnitude': 'Apparent magnitude',
  'vol.magG': 'G = {m} (Gaia)',
  'vol.magV': 'V = {m} (Hipparcos)',
  'vol.absMagnitude': 'Absolute magnitude',
  'vol.absMagValue': '{m}, computed from the distance, without extinction',
  'vol.colour': 'Colour index',
  'vol.colourBpRp': 'BP−RP = {c} (Gaia)',
  'vol.colourBV': 'B−V = {c} (Hipparcos)',
  'vol.notPublished': 'not published by the source',
  'vol.parallax': 'Parallax',
  'vol.parallaxValue': '{p} ± {e} mas',
  'vol.parallaxPlain': '{p} mas',
  'vol.tangential': 'Speed across the line of sight',
  'vol.tangentialValue':
    '{v} km/s, computed from the proper motion and the distance',
  'vol.radial': 'Radial velocity',
  'vol.radialValue': '{v} ± {e} km/s (published)',
  'vol.radialPlain': '{v} km/s (published)',
  'vol.quality': 'Astrometry',
  'vol.qualityValue':
    'RUWE {ruwe}; reliable with a probability of {p} % (GCNS)',
  'vol.whiteDwarf': 'White dwarf',
  'vol.whiteDwarfValue': 'probability {p} % (GCNS)',
  'vol.exoplanets': 'Exoplanets',
  'vol.exoplanetsValue':
    '{count} known around {host} (NASA Exoplanet Archive, matched by the Gaia DR3 number)',
  'vol.origin.gcns': 'Gaia DR3 {id}, in the Gaia Catalogue of Nearby Stars.',
  'vol.origin.hyg':
    'Too bright for Gaia, listed by the GCNS as missing from EDR3: Hipparcos values (HYG v4.4).',
  'vol.origin.simbad':
    'Missing from Gaia EDR3 (GCNS list) and not found in Hipparcos: position and parallax from SIMBAD only; magnitude, colour and motion are not available here.',
  'vol.noRadial':
    'No radial velocity is published: when time moves, the motion shown is across the line of sight only.',
  'vol.noMotion':
    'This star does not move with time here: its motion is not in the source.',
  'vol.symbolic':
    'Beyond 5 pc, each star is a small point: its brightness follows its absolute magnitude and its colour is indicative (from the colour index), never a spectral type.',
  'vol.unknownStar': 'The star of this link is not in the stellar volume.',
  'ed.announce': 'Observation of {date} shown',
};

export type CardMessageKey = keyof typeof cardEn;
