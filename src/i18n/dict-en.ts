/**
 * DICTIONNAIRE ANGLAIS — et la source de vérité des CLÉS.
 *
 * L'anglais est le seul dictionnaire chargé statiquement : c'est le repli de `t()`, donc le
 * sortir du démarrage ferait apparaître des clés brutes le temps qu'un autre arrive. Les trois
 * autres langues sont chargées à la demande (cf. `./locales`).
 *
 * `MessageKey` est dérivé de CET objet, et c'est ce qui tient la parité des quatre langues :
 * une clé manquante ou en trop dans une autre langue est une erreur de COMPILATION, pas un test
 * qu'on pourrait oublier d'écrire. Avant le lot 20 cette parité n'était tenue par rien.
 *
 * Les descriptions et noms des corps ne vivent PAS ici : ils restent dans le catalogue
 * (`config/bodies.ts`, champ `LocalizedText`) — le catalogue est la source unique du contenu.
 */

export const en = {
  // ── Écran de chargement ──
  // Titre de l'onglet, tenu à jour pendant la navigation (cf. ui/documentTitle). La version
  // anglaise reprend mot pour mot celle que `src/seo` écrit dans les pages statiques, pour
  // qu'un rechargement ne change rien de visible.
  'title.body': '{name} in 3D: live position and orbit',
  'title.instrument': '{name} in 3D: live position and trajectory',
  // Pages d'éclipse (`/eclipse/2026-08-12/`) : une clé par combinaison type × astre que le
  // calcul produit réellement — `src/seo/titleParity.test.ts` le vérifie sur les 53 éclipses.
  'title.eclipse.solar.total': 'Total solar eclipse of {date} in 3D',
  'title.eclipse.solar.annular': 'Annular solar eclipse of {date} in 3D',
  'title.eclipse.solar.partial': 'Partial solar eclipse of {date} in 3D',
  'title.eclipse.lunar.total': 'Total lunar eclipse of {date} in 3D',
  'title.eclipse.lunar.partial': 'Partial lunar eclipse of {date} in 3D',
  'title.eclipse.lunar.penumbral': 'Penumbral lunar eclipse of {date} in 3D',
  // Le NOM d'une éclipse sans sa date : les pages statiques par langue en ont besoin
  // (`seo/eclipseLandingPage`), et le déduire du titre en coupant « of … » ne marchait
  // qu'en anglais.
  'eclipse.name.solar.total': 'Total solar eclipse',
  'eclipse.name.solar.annular': 'Annular solar eclipse',
  'eclipse.name.solar.partial': 'Partial solar eclipse',
  'eclipse.name.lunar.total': 'Total lunar eclipse',
  'eclipse.name.lunar.partial': 'Partial lunar eclipse',
  'eclipse.name.lunar.penumbral': 'Penumbral lunar eclipse',
  'title.overview': 'Galaxy: Real-Time Interactive 3D Solar System',
  'loader.init': 'Initializing...',
  'loader.core': 'Loading core components…',
  'loader.scene': 'Building scene…',
  'loader.lighting': 'Setting up lighting…',
  'loader.bodies': 'Creating celestial bodies…',
  'loader.finalize': 'Finalizing…',
  'loader.starting': 'Starting…',
  'loader.loadingBody': 'Loading {body}…',
  'loader.creatingBody': 'Creating {body}...',
  'loader.ephemerides': 'Ephemeris data loaded',
  'loader.ready': 'Ready for launch',
  'loader.stage.core': 'Core',
  'loader.stage.data': 'Data',
  'loader.stage.scene': 'Scene',
  'loader.stage.bodies': 'Bodies',
  'loader.stage.orbit': 'Orbits',
  'loader.stage.ready': 'Ready',
  'loader.texturesDone': 'Textures loaded',
  // ── Accessibilité : ce que SEUL un lecteur d'écran entend (lot 19) ──
  // Aucun de ces textes n'est affiché. Ils viennent de la passe NVDA décrite dans
  // `docs/private/LECTEUR_ECRAN_LOT19.md`, où chaque silence a été mesuré avant d'être
  // comblé. `a11y.pageHeading` reprend MOT POUR MOT le `<h1>` statique d'`index.html`, que
  // les robots lisent et que `src/seo/bodyLandingPage.ts` remplace :
  // `src/seo/headingParity.test.ts` le vérifie.
  'a11y.pageHeading':
    'Galaxy: Real-Time Interactive 3D Solar System. Explore the Planets, Moons and Dwarf Planets',
  'a11y.scene': 'Solar system, interactive 3D view',
  'a11y.navigation': 'Body navigation',
  'a11y.loading': 'Loading the solar system, please wait.',
  'a11y.loadingProgress': 'Loading progress',
  'a11y.ready': 'Solar system loaded and ready.',
  'a11y.loadFailed': 'The solar system could not be loaded.',
  'a11y.bodySelected': '{name} selected. Information panel opened.',
  'a11y.dateChanged': 'Date set to {date}.',
  'a11y.searchResults': '{count} bodies match.',
  'a11y.searchResultsOne': 'One body matches.',
  'a11y.searchResultsNone': 'No body matches.',
  'a11y.paletteResults': 'Search results',
  'a11y.tourPlayer': 'Guided tour in progress',
  'error.title': 'Application Error',
  'error.retry': 'Retry',
  'error.contextLost': 'Reconnecting the 3D view…',
  'error.contextLostTimeout':
    'The 3D view could not reconnect. Reload the page.',

  // ── Éphémérides manquantes (lot 15) ──
  // Le bandeau n'existe que lorsqu'un fichier manque VRAIMENT : rien à l'écran veut dire
  // que les 64 sont arrivés. Les nombres sont écrits sans accord de pluriel (« 63 sur 64 »),
  // le compte pouvant valoir 1 et le dictionnaire n'ayant pas de formes plurielles.
  'ephemeris.notice.title': 'Reduced precision',
  'ephemeris.notice.partial':
    'Precise ephemerides received: {loaded} of {declared}. The other bodies are placed by a less precise source, named on the info card of each body.',
  'ephemeris.notice.none':
    'No precise ephemeris could be loaded. Every body is placed by a less precise source, named on its info card.',
  'ephemeris.notice.spacecraft':
    'Spacecraft left without any position: {count}.',
  'ephemeris.notice.retry': 'Load the missing files',
  'ephemeris.notice.retrying': 'Loading the missing files…',
  'ephemeris.notice.recovered': 'All ephemerides are loaded.',
  'ephemeris.notice.dismiss': 'Dismiss this message',
  'ephemeris.notice.aria': 'Ephemeris loading',

  // ── Navigation ──
  'nav.overview': 'Overview',
  'nav.bodies': 'Bodies',
  'nav.search': 'Search a body',
  'dock.tools.aria': 'Tools',
  'speed.aria': 'Simulation speed',
  // Plafond de vitesse mesuré (lot 17, phase 17D) : la date reste exacte, et c'est le curseur
  // qui renonce. La note n'apparaît que lorsque le lien ne soutient PAS la vitesse demandée.
  'speed.limited': 'limited by your connection',
  'ephemeris.notice.waitingTitle': 'The date is waiting for its data',
  'ephemeris.notice.waiting':
    'Your connection is slower than the requested playback speed. Nothing wrong is shown: the date advances as the bytes arrive.',
  // Hors ligne (lot 17, phase 17E). Chaque nombre affiché est LU dans le magasin de
  // l'appareil, jamais mémorisé après un téléchargement : un cache peut être purgé par le
  // navigateur sous la pression du quota, et l'appareil partirait en classe en ayant oublié.
  'offline.hint':
    'Download every ephemeris file so the app can place the bodies at any date without a network. Nothing is downloaded until you ask.',
  'offline.reading': 'Checking what this device already holds…',
  'offline.unavailable':
    'This browser keeps no storage for the app, so offline use cannot be prepared here.',
  'offline.noManifest':
    'The ephemeris index has not arrived, so there is nothing to prepare yet.',
  'offline.partial':
    'This device holds {files} of {total} files. Preparing the rest downloads about {size} MB.',
  'offline.ready':
    'All {files} files are on this device ({size} MB). Dates work without a network.',
  'offline.prepare': 'Prepare offline use',
  'offline.cancel': 'Stop the download',
  'offline.progress': 'Downloading: {done} of {total} files.',
  'offline.started': 'Offline preparation started.',
  'offline.forget': 'Free {size} MB',
  'nav.searchPlaceholder': 'Search a body…',
  'nav.paletteAria': 'Search and select a body',
  'nav.group.star': 'Star',
  'nav.group.planet': 'Planets',
  'nav.group.moon': 'Moons',
  'nav.group.dwarf': 'Dwarf planets',
  'nav.group.other': 'Small bodies',
  'nav.group.spacecraft': 'Spacecraft',
  'nav.group.interstellar': 'Interstellar objects',
  'nav.kind.moon': 'moon',
  'nav.kind.dwarf': 'dwarf',
  'nav.unavailable': 'No position at this date',
  'nav.kind.spacecraft': 'probe',
  'nav.kind.interstellar': 'interstellar',
  'surface.close': 'Close',
  'bi.trigger.aria': 'Body information',
  'settings.trigger.aria': 'Display settings',
  'time.expand': 'Time settings',
  'events.title': 'Astronomical events',
  'events.open': 'Astronomical events',
  'events.close': 'Close astronomical events',
  'events.empty': 'No upcoming event found',
  'events.newMoon': 'New Moon',
  'events.firstQuarter': 'First Quarter',
  'events.fullMoon': 'Full Moon',
  'events.thirdQuarter': 'Third Quarter',
  'events.solarEclipse': 'Solar eclipse',
  'events.lunarEclipse': 'Lunar eclipse',
  'events.marchEquinox': 'March equinox',
  'events.juneSolstice': 'June solstice',
  'events.septemberEquinox': 'September equinox',
  'events.decemberSolstice': 'December solstice',
  'events.perihelion': 'Perihelion (Earth closest to Sun)',
  'events.aphelion': 'Aphelion (Earth farthest from Sun)',
  'events.opposition': 'Opposition (closest, visible all night)',
  'events.conjunction': 'Inferior conjunction (passes between Earth and Sun)',
  'events.kind.penumbral': 'penumbral',
  'events.kind.partial': 'partial',
  'events.kind.annular': 'annular',
  'events.kind.total': 'total',
  'events.tip.peak': 'Peak visible near {lat}, {lon}',
  'events.tip.obscuration': '{percent}% obscured at maximum',
  'events.tip.goto': 'Click to travel to this date',

  // ── Bascule de mode ──
  'mode.group': 'View mode',
  'mode.educ': 'Educ.',
  'mode.explo': 'Explo.',
  'mode.educ.title': 'Educational view, circular orbits',
  'mode.explo.title': 'Exploration mode, true scale',
  'zoom.optical': 'Optical zoom (FOV)',

  // ── Qualité graphique (perf adaptative) ──
  'quality.heading': 'Graphics quality',
  'quality.auto': 'Auto',
  'quality.auto.hint': 'Match this device',
  'quality.low': 'Low',
  'quality.low.hint': 'Smoothest on weak GPUs',
  'quality.medium': 'Medium',
  'quality.medium.hint': 'Balanced',
  'quality.high': 'High',
  'quality.high.hint': 'Best looking',
  'quality.reloadNote': 'Some options apply on next reload.',

  // ── Lecture / temps ──
  'playback.playpause': 'Play / Pause',
  'playback.play': 'Resume simulation',
  'playback.pause': 'Pause simulation',
  'time.historicGroup': 'Date in the Julian calendar',
  'time.histDay': 'Day',
  'time.histMonth': 'Month',
  'time.histYear': 'Year',
  'time.histEra': 'Era',
  'time.eraAD': 'AD',
  'time.eraBC': 'BC',
  'time.julianCalendar': 'Julian calendar',
  'time.today': 'Back to now',
  'time.group': 'Time controls',
  'time.wheelTime': 'Wheel: ±1 h  ·  Click: pick the time',
  'time.wheelDate': 'Wheel: ±1 day  ·  Click: pick the date',

  // ── Aide & crédits ──
  'help.btn.title': 'Help, tips & credits',
  'help.btn.aria': 'Help, tips and credits',
  'feedback.btn.title': 'Suggestions and bug reports',
  'feedback.btn.aria': 'Suggestions and bug reports',
  'kofi.btn.title': 'Buy me a coffee',
  'kofi.btn.aria': 'Support this project on Ko-fi',
  'share.btn.title': 'Share this view',
  'share.btn.aria': 'Share this view',
  'share.copied': 'Link copied',
  'share.failed': 'Copy failed',
  'capture.btn.title': 'Capture this view',
  'capture.btn.aria': 'Capture this view',
  'capture.success': 'Image downloaded',
  'capture.failed': 'Capture failed',
  'webxr.btn.enter.title': 'Enter VR',
  'webxr.btn.enter.aria': 'Enter virtual reality',
  'webxr.btn.exit.title': 'Exit VR',
  'webxr.btn.exit.aria': 'Exit virtual reality',
  'help.dialog.aria': 'Help and credits',
  'help.title': 'Navigation',
  'help.tip.drag.key': 'Drag',
  'help.tip.drag.text': 'orbit the view',
  'help.tip.zoom.key': 'Scroll · pinch',
  'help.tip.zoom.text': 'zoom in / out',
  'help.tip.click.key': 'Click a body',
  'help.tip.click.text': 'or its label to travel to it',
  'help.tip.mode.key': 'Educ · Explo',
  'help.tip.mode.text': 'compressed overview vs true-scale voyage',
  'help.tip.time.key': 'Clock · date',
  'help.tip.time.text': 'scroll to time-travel, tap to pick',
  'credits.textures': 'Textures',
  'credits.fictional': 'Illustrative surfaces',
  'credits.fictional.list':
    'Bodies never mapped globally have an illustrative texture, not a scientific map; the body card says so, and Sources lists them.',
  'weather.attribution.prefix': 'Weather data:',
  'weather.attribution.modified': 'resampled into map textures',
  'credits.models': '3D shape models',
  'credits.data': 'Data',
  'credits.privacy': 'Privacy',
  'credits.methodology': 'Methodology',
  'credits.methodology.href': '/methodology/',
  'credits.sources': 'Sources',
  'credits.sources.href': '/sources/',
  'lang.label': 'Language',
  // Annoncé dans la langue d'ARRIVÉE, donc lu dans le dictionnaire qui vient d'être chargé.
  'lang.changed': 'Interface language: {language}.',
  // ── Guided tour (first visit) ──
  'tour.start': 'Start quick tour',
  'tour.previous': 'Previous',
  'tour.next': 'Next',
  'tour.finish': 'Finish',
  'tour.close': 'Close tour',
  'tour.progress': 'Step {current} of {total}',
  'tour.step.navigation.title': '1. Navigate',
  'tour.step.navigation.text':
    'Choose a planet in the top bar or drag the scene.',
  'tour.step.mode.title': '2. Choose your view',
  'tour.step.mode.text':
    'Educational stays simple while Exploration shows the true scale.',
  'tour.step.time.title': '3. Change time',
  'tour.step.time.text':
    'Use the date and speed controls to move through time.',
  'tour.step.expand.title': '4. Unfold the clock',
  'tour.step.expand.text':
    'Click the clock to unfold the advanced date and speed settings.',
  'tour.step.info.title': '5. Inspect a target',
  'tour.step.info.text':
    'After selecting a body, open its information panel from the target button.',
  'tour.step.settings.title': '6. Adjust display',
  'tour.step.settings.text':
    'Open display settings to show or hide labels, objects and orbits, group by group or one object at a time.',
  'tour.step.weather.title': '7. Explore weather',
  'tour.step.weather.text':
    'Open weather layers to see clouds, rain, wind and surface data on Earth.',
  'tour.step.events.title': '8. Watch the sky',
  'tour.step.events.text':
    'Check upcoming astronomical events and select an event for details.',
  'tour.step.share.title': '9. Share a view',
  'tour.step.share.text':
    'Set up a view, then share its link. Whoever opens it lands on the exact same scene.',
  'tour.step.capture.title': '10. Take a picture',
  'tour.step.capture.text':
    'Hide every control and save the view as an image, with the date and the body written on it.',
  'tour.step.feedback.title': '11. Send feedback',
  'tour.step.feedback.text':
    'Report a problem or suggest an idea. Suggestions are public, and you can vote on other people’s.',
  'tour.step.help.title': '12. Find help',
  'tour.step.help.text': 'Check the help page for more information.',

  // ── Tours guidés scénarisés ──
  'tours.start': 'Scripted tours',
  'tours.pause': 'Pause',
  'tours.resume': 'Resume',
  'tours.next': 'Next',
  'tours.close': 'Close',
  'tours.progress': 'Step {current} of {total}',
  'tours.outline': 'Tour "{title}", {count} parts: {beats}',
  'tours.status.flyingTo': 'Flying to {body}…',
  'tours.status.jumping': 'Jumping through time…',
  'tours.status.speeding': 'Speeding up time…',

  // ── Nudge visite guidée (premier passage en Explo) ──
  'exploNudge.text': 'Try a guided tour to see exploration mode’s best side.',
  'exploNudge.action': 'Show me',
  'exploNudge.dismiss': 'Dismiss',

  // ── Badge d'échelle permanent (vue d'ensemble Explo, aucune cible) ──
  'exploScale.fact.earth': 'Sunlight takes about 8 minutes to reach Earth.',
  'exploScale.fact.jupiter':
    'Sunlight takes about 43 minutes to reach Jupiter.',
  'exploScale.fact.neptune': 'Sunlight takes about 4 hours to reach Neptune.',
  'exploScale.fact.voyager':
    'Voyager 1, humanity’s farthest spacecraft, is already over 24 billion km from Earth.',

  // ── Surface « Réglages d'affichage » : un vocabulaire, trois colonnes (étiquette, objet,
  //    orbite), les mêmes mots dans le tableau, ses en-têtes et ses lignes de groupe ──
  'settings.title': 'Display settings',
  'settings.section.scene': 'In the scene',
  'settings.section.rendering': 'Rendering',
  'settings.section.reading': 'Accessibility and units',
  'settings.section.view': 'View',
  'settings.section.offline': 'Offline use',
  'settings.labelsToggle': 'Show every label',
  'settings.bodiesToggle': 'Show every object',
  'settings.orbitsToggle': 'Show every orbit and trajectory',
  'settings.tableHint':
    'A column header sets the whole column, a group row its group, a row one object. Spacecraft and interstellar objects start hidden.',
  'settings.tableCaption': 'What the scene shows, object by object',
  'settings.col.bodyName': 'Object',
  'settings.col.names': 'Label',
  'settings.col.bodies': 'Object',
  'settings.col.orbits': 'Orbit',
  'settings.row.name.aria': "Show {name}'s label",
  'settings.row.body.aria': 'Show {name}',
  'settings.row.orbit.aria': "Show {name}'s orbit",
  'settings.row.trajectory.aria': "Show {name}'s trajectory",
  'settings.group.name.aria': 'Show every label in {group}',
  'settings.group.body.aria': 'Show every object in {group}',
  'settings.group.orbit.aria': 'Show every orbit in {group}',
  'settings.exposure': 'Brightness (exposure)',
  'settings.colorblind': 'Color-blind friendly orbit colors',
  'settings.gazetteer': 'Surface feature names (IAU)',
  'settings.surfaceImagery': 'Stream high-resolution surface imagery',
  'surface.imagery.headline': '{title} at {resolution}/pixel',
  'surface.imagery.acquired': 'images from {from} to {to}',
  'surface.imagery.oversampled':
    'shown {factor}x larger than the published mosaic ({published} px/degree)',
  'surface.relief.headline': 'Relief {title} at {resolution}/pixel',
  'surface.relief.area': 'named area {name}',
  'surface.relief.acquired': 'heights measured from {from} to {to}',
  'settings.units': 'Imperial units (mi, °F)',

  // ── Champ d'astéroïdes et de comètes (NEO / comètes / TNO), section des Réglages ──
  'smallBodies.title': 'Asteroid and comet field',
  'smallBodies.exploOnly':
    'Drawn in Exploration mode, one dot per known orbit.',
  'smallBodies.mainBelt': 'Main belt',
  'smallBodies.neo': 'Near-Earth objects',
  'smallBodies.comet': 'Comets',
  'smallBodies.tno': 'Trans-Neptunian objects',
  'smallBodies.source':
    '{count} objects, JPL Small-Body Database, snapshot of {date}.',
  'smallBodies.sourceStale':
    '{count} objects, JPL Small-Body Database, snapshot of {date}. This snapshot is {months} months old: orbits refined since then, and objects catalogued since then, may be missing.',

  // ── Couches météo ──
  'weather.title': 'Weather layers',
  'weather.trigger.aria': 'Weather layers',
  'weather.dialog.aria': 'Weather layers',
  'weather.clouds': 'Clouds (NASA)',
  'weather.cloudsModel': 'Clouds (Open-Meteo)',
  'weather.precip': 'Rain (NASA IMERG)',
  'weather.precipModel': 'Rain (Open-Meteo)',
  'weather.wind': 'Wind',
  'weather.thermal': 'Air temperature (MERRA-2)',
  'weather.thermalModel': 'Air temperature (Open-Meteo)',
  'weather.clouds.note':
    "Real cloud cover from NASA satellite imagery (day's snapshot).",
  'weather.cloudsModel.note':
    'Modelled cloud cover (Open-Meteo): gap-free worldwide, supports past and forecast; pick this for live view and time travel.',
  'weather.precip.note':
    'Observed NASA IMERG V07 rain: its native alpha mask is preserved; no polar extrapolation is added.',
  'weather.precip.legendLo': 'Light',
  'weather.precip.legendHi': 'Intense',
  'weather.precipModel.note':
    'Modelled rainfall (Open-Meteo): gap-free worldwide, past + forecast. Dry areas stay transparent.',
  'weather.precipModel.lo': '0 mm/h',
  'weather.precipModel.hi': '20+ mm/h',
  'weather.thermalModel.note':
    'Modelled 2 m air temperature (Open-Meteo): gap-free worldwide, past (ERA5) + forecast.',
  'weather.thermalModel.lo': '−40 °C',
  'weather.thermalModel.hi': '+45 °C',
  'weather.pressureModel': 'Sea-level pressure (Open-Meteo)',
  'weather.pressureModel.note':
    'Sea-level pressure shown as smooth isobars in hPa.',
  'weather.pressureModel.lo': '960 hPa',
  'weather.pressureModel.hi': '1060 hPa',
  'weather.humidityModel': 'Relative humidity (Open-Meteo)',
  'weather.humidityModel.note':
    'Relative humidity at 2 m from Open-Meteo, in percent.',
  'weather.humidityModel.lo': '0 %',
  'weather.humidityModel.hi': '100 %',
  'weather.source.prefix': 'Source:',
  'weather.source.approx': 'nearest available',
  'weather.loading': 'Loading…',
  // Couche des événements terrestres (voir ui/earthEvents.ts).
  'earthEvents.title': 'Earth events',
  'earthEvents.dialog.aria': 'Earth events',
  'earthEvents.trigger.aria': 'Earth events',
  'earthEvents.quakes.label': 'Earthquakes (USGS)',
  'earthEvents.quakes.note':
    'Origin solutions of magnitude {magnitude} and above over the {days} days before the scene date, measured by seismometer networks. No earthquake exists in the future: a later scene gets the latest real window, and the gap is written below.',
  'earthEvents.natural.label': 'Natural events (NASA EONET)',
  'earthEvents.natural.note':
    'Reported events such as wildfires, volcanoes, storms, floods and ice over the {days} days before the scene date. EONET states that its metadata are intended for visualization and general information only, and should not be construed as official with regard to spatial or temporal extent: these are reports, not measurements.',
  'earthEvents.empty': 'No event in this window.',
  'earthEvents.ongoing': 'ongoing',
  'earthEvents.loading': 'Loading…',
  'earthEvents.attribution.prefix': 'Event data:',
  // Catégorie temporelle d'une donnée affichée (voir core/temporal.ts).
  'time.category.live': 'live',
  'time.category.observed': 'observed',
  'time.category.reported': 'reported',
  'time.category.reconstructed': 'reconstructed (model)',
  'time.category.predicted': 'predicted',
  'time.category.extrapolated': 'extrapolated',
  'time.category.unavailable': 'unavailable',
  'time.confidence.reduced': 'low confidence',
  'time.offset.scene': 'scene on {date}',
  // Provenance de la position d'un corps (voir core/positionProvenance.ts).
  'bi.position.label': 'Position at this date',
  'position.source.horizons': 'JPL Horizons ephemeris (precomputed)',
  'position.source.spk': 'JPL SPK kernel',
  'position.source.astronomy-engine': 'Astronomy Engine',
  'position.source.kepler': 'Keplerian orbital elements',
  'position.error':
    'Mean measured gap to JPL Horizons: {distance} ({from}–{to})',
  'position.error.none': 'Gap to JPL Horizons not measured at this date',
  'position.offset':
    'That is {times} times its diameter: at this date, the body is drawn away from its true place.',
  'weather.wind.note':
    'Wind flow (Open-Meteo): colour and speed follow wind strength.',
  'weather.thermal.note': 'Air temperature near the surface (MERRA-2 monthly):',

  // ── Divers ──
  'fullscreen.title': 'Fullscreen',

  // ── Fiche d'info (bodyInfo) ──
  'bi.live.label': 'Distance from you',
  'bi.more': 'Learn more',
  'bi.modelCredit': '3D shape model',
  'bi.colourCredit': 'Surface colour',
  // Le deux-points d'une ligne de crédit, AVEC sa typographie : le français met une espace
  // avant, l'anglais non. Le code écrivait « 3D shape model : … » dans les quatre langues,
  // c'est-à-dire une règle française appliquée à l'anglais.
  'bi.creditLine': '{label}: {value}',
  'bi.fictional': 'Illustrative surface',
  'bi.fictional.hint':
    'No spacecraft has resolved this surface, so the texture is illustrative, not a scientific map.',
  // Missions déclarées sur un corps (voir core/missions.ts et config/missions.ts). Le choix des
  // mots est l'honnêteté de ce bloc : le PDS déclare des CIBLES, ce qui n'est pas un relevé
  // d'observations, et son `start_date` est le début du PROJET et non un lancement (Voyager y
  // commence en 1972, cinq ans avant le décollage de Voyager 1).
  // LE BLOC « DÉCOUVERTE » (lot 44, ligne 22.10). Aucune phrase ne genre le corps : « this body »
  // et non un pronom, parce que la Lune, Titan et Pluton n'ont pas le même genre en français.
  'bi.discovery.label': 'Discovery',
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
    'A survey submitted on {date} found none, down to about {radius} km in radius.',
  'position.yearBeforeEra': '{year} BC',
  'bi.missions.label': 'Missions',
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
  'bi.instruments.label': 'Instruments',
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
  'bi.places.label': 'Observed formations',
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
  'bi.places.note':
    'Footprints read in NASA’s Orbital Data Explorer (PDS Geosciences Node), products created up to {date}. A product whose footprint also covers the antipode of the formation, such as a global map, is not counted.',
  'stat.radius': 'Radius',
  'stat.meanDistanceSun': 'Mean distance (Sun)',
  'stat.meanDistanceFrom': 'Mean distance ({parent})',
  'stat.mass': 'Mass',
  'stat.gravity': 'Gravity',
  'stat.meanTemperature': 'Mean temperature',
  'stat.siderealRotation': 'Sidereal rotation',
  'stat.meanTemperature1Bar': 'Mean temperature at 1 bar',
  'stat.effectiveTemperature': 'Effective temperature',
  'stat.surfaceTemperature': 'Surface temperature',
  'stat.siderealRotationAt16': 'Sidereal rotation (latitude 16°)',
  'stat.synodicRotation': 'Synodic rotation',
  'stat.rotationPeriod': 'Rotation period',
  'stat.year': 'Year',
  'stat.orbit': 'Orbit',
  'stat.knownMoons': 'Known moons',
  'stat.axialTilt': 'Axial tilt',
  'stat.launchDate': 'Launch date',
  'stat.launchVehicle': 'Launch vehicle',
  'stat.launchSite': 'Launch site',
  'stat.absoluteMagnitude': 'Absolute magnitude',
  'stat.eccentricity': 'Eccentricity',
  'stat.perihelion': 'Perihelion distance',
  'stat.firstObservation': 'First observation',
  'stat.unknown': 'No published value',
  'stat.unsourced': 'Not yet sourced',
  'stat.unknown.value': 'n/a',
  'bi.sources': 'Sources',
  'bi.source': 'source',
  'fact.method.measured': 'measured value',
  'fact.method.derived': 'derived value',
  'fact.method.illustrative': 'illustrative value',
  'fact.asOf': 'as of {date}',
  'fact.methods.measured': 'Measured values',
  'fact.methods.derived': 'Derived values',
  'fact.methods.illustrative': 'Illustrative values',
  'fact.accessed': 'read {date}',
  'fact.kind.preprint': 'preprint',
  'subtitle.star': 'Star of the Solar System',
  'subtitle.moon': 'Natural satellite',
  'subtitle.dwarf': 'Dwarf planet',
  'subtitle.asteroid': 'Asteroid',
  'subtitle.comet': 'Comet',
  'subtitle.spacecraft': 'Space probe',
  'subtitle.interstellar': 'Interstellar object',
  'subtitle.planet': 'Planet',
  // {ordinal} = « 3rd » (anglais) / « 3ᵉ » (français), calculé par bodyInfo.
  'subtitle.planetOrdinal': '{ordinal} planet from the Sun',

  // ── Unités & suffixes (fiche) ──
  'unit.light': 'light',
  'unit.day.short': 'd',
  // Unites en toutes lettres : les pages statiques par corps les emploient depuis le lot 20,
  // ou elles etaient ecrites en dur en anglais.
  'unit.hours': 'hours',
  'unit.days': 'days',
  'unit.year.short': 'yr',
  'unit.au': 'AU',
  'unit.million': 'M',
  'unit.billion': 'B',

  // ── Précisions de provenance (lot 35) ──
  // Ce que la source mesure exactement quand le libellé de la fiche est plus large, et la
  // raison d'une valeur non sourcée. Ces textes vivaient inlinés en QUATRE langues dans
  // `config/factSources.ts`, donc dans la clôture statique : 6 676 octets de source, 2 828
  // octets gzippés, payés par un visiteur qui n'en lit qu'un quart. Ici, chaque langue ne
  // voyage qu'avec son propre dictionnaire.
  'detail.equatorialRadius1Bar':
    'equatorial radius at the 1-bar pressure level',
  'detail.meanGravity1Bar': 'mean gravity at the 1-bar pressure level',
  'detail.equatorialGravity': 'gravity at the equator',
  'detail.temperature1Bar': 'mean temperature at the 1-bar pressure level',
  'detail.effectiveTemperature':
    'effective temperature, 5772 K, converted to °C',
  'detail.solarRotationAt16Degrees':
    'adopted period at 16° latitude: the Sun rotates faster at its equator than near its poles',
  'detail.obliquityToEcliptic': 'obliquity to the ecliptic',
  'detail.synchronousRotation':
    'synchronous rotation: equal to the orbital period',
  'detail.surfaceTemperature':
    'surface temperature as the source states it, not an average',
  'detail.massFromGM': 'mass = GM / G, with G from CODATA 2018',
  'detail.gravityFromGM': 'g = GM / R², for a sphere without rotation',
  'detail.radiusFromDiameter': 'half the published diameter',
  'detail.equatorialRadiusFromDiameter':
    'half the published equatorial diameter',
  'detail.volumetricRadiusFromDiameter':
    'half the published volume-equivalent diameter',
  'detail.itokawaPublishedMass':
    'published mass quoted in the database notes; the database GM of 2.1e-9 km³/s² does not match it',
  'detail.gravityFromSystemMass':
    'g = G·M / R² with the system mass, for a sphere without rotation',
  'detail.massFromDensity':
    'mass = published density × volume of the published radius',
  'detail.gravityFromMass': 'g = G·M / R², for a sphere without rotation',
  'detail.systemMass': 'mass of the whole system, satellite included',
  'detail.obliquityFromPole':
    'angle between the published spin pole and the orbit normal',
  'detail.osculatingSemiMajorAxis':
    'osculating semi-major axis at the epoch of the elements',
  'detail.keplerPeriod':
    'Kepler’s third law applied to the osculating semi-major axis',
  'detail.partialLightcurve':
    'lightcurve period that the source flags as based on less than full coverage',
  'detail.confirmedSatellites':
    'number of confirmed satellites listed by the database',
  'detail.nssdcaFactsInBrief':
    'mass as listed in the catalogue’s “Facts in Brief” for this spacecraft',
  'detail.firstObservationUsed':
    'first observation used by the published orbit solution',
  'detail.osculatingEccentricity':
    'osculating eccentricity of the published orbit solution; above 1, the orbit is open and the object leaves the Solar System',
  'detail.absoluteMagnitudeH':
    'absolute magnitude H: the brightness the object would have 1 AU from both the Sun and the observer, at zero phase angle',
  'detail.perihelionFromElements':
    'q = a (1 − e), from the published osculating elements',
  'detail.afterDartImpact':
    'the period after the DART impact of 26 September 2022 (11 h 55 min before)',
  'detail.separationAfterDartImpact':
    'the mean distance between the two centres just after the DART impact (1.189 km before)',
  'fact.notYetSourced':
    'Galaxy has not yet traced this value to a primary source (space agency, IAU, peer-reviewed article), so it is not shown.',
};

/** Toutes les clés d'interface de l'application. Dérivé, jamais listé à la main. */
export type MessageKey = keyof typeof en;
