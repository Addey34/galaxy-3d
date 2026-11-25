/** Les phrases des blocs hors démarrage, cf. `./dict-card-en.ts` (lot 52, piste C). */
import type { CardMessageKey } from './dict-card-en';

export const cardFr: Record<CardMessageKey, string> = {
  'search.group.dataset': 'Couches de données',
  'search.group.place': 'Lieux',
  'search.group.mission': 'Missions',
  'search.group.instrument': 'Instruments',
  'search.group.discovery': 'Découvertes',
  'search.group.flyby': 'Survols',
  'search.group.orbitInsertion': 'Mises en orbite',
  'search.group.perihelion': 'Périhélies',
  'search.group.perijove': 'Périjoves',
  'deep.card.designation': 'Désignation',
  'deep.card.messier': 'Messier',
  'deep.card.constellation': 'Constellation',
  'deep.card.ra': 'Ascension droite (J2000)',
  'deep.card.dec': 'Déclinaison (J2000)',
  'deep.card.vmag': 'Magnitude visuelle',
  'deep.card.size': 'Taille apparente',
  'deep.card.unknown': 'non publiée',
  'deep.card.source':
    'OpenNGC, lu le {date}, licence {license}. Seule la direction de l’objet est placée sur le ciel : le catalogue ne donne aucune distance exploitable, donc aucune n’est dessinée ni affichée.',
  'deep.card.opened': 'Objet du ciel profond {name}',
  'deep.unit.arcmin': '{v} minutes d’arc',
  'deep.search.label': 'Chercher un objet du ciel profond',
  'deep.search.placeholder': 'M 31, NGC 224, Andromède',
  'deep.type.G': 'Galaxie',
  'deep.type.OCl': 'Amas ouvert',
  'deep.type.ClN': 'Amas avec nébulosité',
  'deep.type.GCl': 'Amas globulaire',
  'deep.type.Neb': 'Nébuleuse',
  'deep.type.HII': 'Région H II',
  'deep.type.PN': 'Nébuleuse planétaire',
  'deep.type.RfN': 'Nébuleuse par réflexion',
  'deep.type.SNR': 'Rémanent de supernova',
  'nb.card.kind': 'Étoile proche du Soleil',
  'nb.card.members': 'Étoiles de ce système',
  'nb.card.distance': 'Distance au Soleil',
  'nb.card.distanceValue': '{ly} années-lumière',
  'nb.card.distanceError': '{ly} ± {err} années-lumière',
  'nb.card.au': 'En unités astronomiques',
  'nb.card.auValue': '{au} UA',
  'nb.card.scale': 'Si la Terre était à 1 cm du Soleil',
  'nb.card.scaleValue': 'à {km} km',
  'nb.card.light': 'Sa lumière met',
  'nb.card.lightValue': '{years} ans à nous parvenir',
  'nb.card.motion': 'Mouvement propre',
  'nb.card.motionValue': '{v} secondes d’arc par an',
  'nb.card.rv': 'Vitesse radiale',
  'nb.card.rvApproaching': '{v} km/s, elle se rapproche',
  'nb.card.rvReceding': '{v} km/s, elle s’éloigne',
  'nb.card.spectral': 'Type spectral',
  'nb.card.vmag': 'Magnitude visuelle',
  'nb.card.unknown': 'non publiée',
  'nb.card.origin.gaia': 'Distance et mouvement : Gaia DR3, source {id}.',
  'nb.card.origin.hyg':
    'Distance et mouvement : HYG v4.4 (Hipparcos et Gliese) ; aucune incertitude n’est publiée.',
  'nb.card.hint':
    'Le repère montre la direction réelle de l’étoile. L’étoile n’est pas dessinée à sa distance : la scène s’arrête au Système solaire.',
  'nb.card.source':
    'Sources : Gaia DR3 (ESA) et HYG v4.4 ({license}). Les positions sont celles de J2000,0 ; le repère suit le mouvement propre jusqu’à la date de la scène.',
  'nb.card.opened': 'Étoile voisine {name}',
  'nb.unit.ly': 'al',
  'nb.search.label': 'Trouver une étoile voisine',
  'nb.search.placeholder': 'Proxima, Sirius, étoile de Barnard',
  'st.title': 'Voisinage solaire en 3D',
  'st.back': 'Retour au Système solaire',
  'st.reset': 'Recentrer la vue',
  'st.open': 'Voir dans le voisinage solaire',
  'st.scale':
    '1 unité = 1 parsec = 3,26 années-lumière. Un cercle par parsec autour du Soleil, dans le plan galactique.',
  'st.ring': '{pc} pc · {ly} al',
  'st.sun': 'Soleil',
  'st.centre': 'Centre galactique (direction)',
  'st.symbolic':
    'Les points sont des symboles de taille constante : la taille réelle d’une étoile n’est pas dessinée. La couleur suit le type spectral.',
  'st.frame':
    'Repère galactique : x vers le centre galactique, z vers le pôle galactique nord. Les positions sont celles de la date de la scène, déplacées en ligne droite depuis les valeurs du catalogue à J2000.',
  'st.help':
    'Glisser pour tourner, molette ou pincement pour zoomer, clic droit ou deux doigts pour déplacer. Clavier : les flèches tournent, plus et moins zooment, Origine recentre, Échap revient.',
  'st.list': 'Étoiles du voisinage',
  'st.listItem': '{name}, {ly} années-lumière',
  'st.selected': 'Étoile choisie',
  'st.noSelection':
    'Choisissez une étoile pour voir sa distance et sa position.',
  'st.distSun': 'Distance au Soleil (publiée)',
  'st.distAtDate': 'Distance au Soleil à cette date',
  'st.position': 'Coordonnées (x, y, z)',
  'st.positionValue': '{x} ; {y} ; {z} pc',
  'st.timeLabel': 'Années depuis la date de la scène',
  'st.timeNow': 'La date de la scène',
  'st.timeValue': '{years} ans, année {year}',
  'st.timeLimit':
    'Mouvement rectiligne, limité à 10 000 ans de part et d’autre de J2000 : au-delà l’approximation n’est pas défendable.',
  'st.noRadial':
    'Aucune vitesse radiale n’est publiée pour cette étoile : son rapprochement ou son éloignement du Soleil n’est pas pris en compte.',
  'st.opened':
    'Voisinage solaire en 3D. {n} systèmes d’étoiles autour du Soleil.',
  'st.closed': 'Retour au Système solaire.',
  'st.selectedAnnounce': '{name}, à {ly} années-lumière du Soleil.',
  'st.unavailable':
    'La vue 3D n’est pas disponible : le contexte graphique ne répond pas.',
  'st.unknownStar':
    'Le lien désigne une étoile qui ne figure pas parmi les étoiles voisines. La vue est ouverte sans étoile choisie.',
  'st.dataUnavailable':
    'La vue 3D n’est pas disponible : le fichier des étoiles voisines n’a pas pu être lu.',
  'st.fieldAu': 'Largeur du champ au niveau du Soleil : {au} UA',
  'st.fieldLy': 'Largeur du champ au niveau du Soleil : {ly} al ({pc} pc)',
  'st.ringAu': '{au} UA',
  'st.stageAu':
    'Dans le Système solaire : l’unité est l’unité astronomique (UA), la distance moyenne Terre-Soleil, {km} millions de km. Cercles orangés : 1, 10, 100… UA, dans le plan des planètes.',
  'st.stageLy':
    'Entre les étoiles : l’unité est l’année-lumière (1 parsec = {ly} années-lumière = {au} UA). Cercles bleus : un par parsec, dans le plan galactique.',
  'st.stageNote':
    'Un changement d’échelle, pas un voyage : le Soleil reste au centre et seul le champ s’élargit, dans un repère galactique unique. Aucune vitesse n’est supposée.',
  'st.skip': 'Passer la transition',
  'sv.visit.start': 'Visite guidée',
  'sv.visit.region': 'Visite guidée des voisines du Soleil',
  'sv.visit.progress': 'Étape {n} sur {total}',
  'sv.visit.prev': 'Étape précédente',
  'sv.visit.next': 'Étape suivante',
  'sv.visit.finish': 'Terminer la visite',
  'sv.visit.leave': 'Quitter la visite et explorer librement',
  'sv.visit.resume': 'Reprendre la visite (étape {n} sur {total})',
  'sv.visit.end': 'Mettre fin à la visite',
  'sv.visit.paused':
    'La visite est en pause. Les étoiles, le curseur de temps et la caméra sont à vous.',
  'sv.visit.data': 'Cette étoile dans les données',
  'sv.visit.fact.pm': 'Mouvement propre',
  'sv.visit.fact.pmValue': '{pm} mas/an',
  'sv.visit.fact.rv': 'Vitesse radiale',
  'sv.visit.fact.rvValue': '{rv} km/s',
  'sv.visit.fact.planets': 'Planètes listées par l’archive',
  'sv.visit.fact.none': 'aucune',
  'sv.visit.reading': 'Comment lire cette étape',
  'sv.visit.reading.measured':
    'Mesuré : la position, le mouvement propre, la vitesse radiale et le type spectral (Gaia DR3, ou HYG là où Gaia n’est pas sûr).',
  'sv.visit.reading.catalogued':
    'Catalogué : les planètes de la NASA Exoplanet Archive (instantané du {date}), avec le statut que l’archive leur donne.',
  'sv.visit.reading.calculated':
    'Calculé : la position à une autre année, d’après un mouvement rectiligne. Ce n’est pas une mesure.',
  'sv.visit.reading.illustrative':
    'Illustratif : les points sont des symboles. Aucune planète, texture ni surface n’est dessinée.',
  'sv.visit.reading.unknown':
    'Inconnu ici : le rayon, la masse et l’âge de ces étoiles ne sont pas dans les données de cette vue.',
  'sv.visit.approaching': 's’approche du Soleil',
  'sv.visit.receding': 's’éloigne du Soleil',
  'sv.visit.unknown':
    'Cette visite guidée n’existe pas : la vue s’ouvre sans elle.',
  'sv.visit.opened':
    'Visite guidée commencée. Étape {n} sur {total} : {title}.',
  'sv.visit.stop': 'Étape {n} sur {total} : {title}.',
  'sv.visit.left': 'Visite en pause. Vous pouvez explorer librement.',
  'sv.visit.finished': 'Visite terminée. Vous pouvez continuer à explorer.',
  'sv.visit.noArchive':
    'L’archive d’exoplanètes n’a pas pu être lue : le nombre de planètes n’est pas affiché.',
  'sv.visit.archive.none':
    'La NASA Exoplanet Archive ne liste aucune planète pour cette étoile.',
  'sv.visit.archive.one':
    'La NASA Exoplanet Archive liste {n} planète pour cette étoile, avec le statut que l’archive lui donne.',
  'sv.visit.archive.many':
    'La NASA Exoplanet Archive liste {n} planètes pour cette étoile, avec le statut que l’archive leur donne.',
  'sv.visit.archive.loading':
    'Le nombre de planètes de la NASA Exoplanet Archive est encore en cours de chargement.',
  'sv.visit.archive.unavailable':
    'La NASA Exoplanet Archive n’a pas pu être lue : aucun nombre de planètes n’est donné ici, et un nombre absent ne veut pas dire zéro planète.',
  'st.transitionStart':
    'Changement d’échelle : du Système solaire, en unités astronomiques, au voisinage, en années-lumière.',
  'exo.card.unknown': 'non publiée',
  'exo.card.period': 'Période orbitale',
  'exo.card.radius': 'Rayon',
  'exo.card.axis': 'Demi-grand axe',
  'exo.card.year': 'Découverte',
  'exo.card.method': 'Méthode',
  'exo.card.planets.one': '{count} planète connue',
  'exo.card.planets.other': '{count} planètes connues',
  'exo.card.distance': 'à {ly} années-lumière',
  'exo.card.distanceUnknown': 'Distance non publiée',
  'exo.card.source':
    'NASA Exoplanet Archive, relevé du {date}. Les planètes ne sont pas dessinées : seule leur étoile hôte est placée sur le ciel. Pour une planète trouvée par vitesse radiale, le rayon est le plus souvent calculé par l’archive à partir de la masse, pas mesuré.',
  'exo.card.opened': 'Système {name}, {count} planètes connues',
  'exo.unit.days': '{v} jours',
  'exo.unit.earthRadii': '{v} rayons terrestres',
  'exo.unit.au': '{v} UA',
  'exo.search.label': 'Chercher un système planétaire',
  'exo.search.placeholder': 'Nom de l’étoile hôte',
  'exo.method.transit': 'Transit',
  'exo.method.radialVelocity': 'Vitesse radiale',
  'exo.method.imaging': 'Imagerie directe',
  'exo.method.microlensing': 'Microlentille',
  'exo.method.transitTiming': 'Variations des temps de transit',
  'exo.method.eclipseTiming': 'Variations des temps d’éclipse',
  'exo.method.orbitalBrightness': 'Modulation orbitale de luminosité',
  'exo.method.pulsarTiming': 'Chronométrage de pulsar',
  'exo.method.pulsationTiming': 'Variations des temps de pulsation',
  'exo.method.astrometry': 'Astrométrie',
  'exo.method.diskKinematics': 'Cinématique du disque',
  'search.group.contact': 'Contacts',
  'search.missionPage': 'page de la mission',
  'surface.compare.slider': 'Rideau avant/après',
  'surface.compare.valuetext':
    '{before} à gauche de la ligne, {after} à droite, ligne à {percent} % de la largeur',
  'bi.discovery.according': '{source}, lu le {date}',
  'bi.discovery.prehistoric': 'Depuis la préhistoire',
  'bi.discovery.ancient': 'Depuis l’Antiquité',
  'bi.discovery.ancientObservations':
    'Observations anciennes remontant à plus de deux mille ans',
  'bi.discovery.predictedReturn': 'Retour prédit, observé le {date}',
  'bi.discovery.notYetKnown':
    'À la date de la scène, ce corps n’était pas encore connu.',
  'bi.discovery.known': 'À la date de la scène, ce corps était déjà connu.',
  'bi.discovery.onTheDay': 'La date de la scène est le jour de sa découverte.',
  'bi.discovery.withinYear':
    'La date de la scène tombe dans l’année de sa découverte, dont la source ne donne pas le jour.',
  'bi.discovery.withinDates':
    'La date de la scène tombe entre les dates publiées : la réponse dépend de la source.',
  'bi.discovery.moonsKnown':
    'Lunes déjà vues à cette date : {count} sur les {total} que recense aujourd’hui le JPL',
  'bi.discovery.moonsKnownRange':
    'Lunes déjà vues à cette date : entre {min} et {max} sur les {total} que recense aujourd’hui le JPL',
  'bi.discovery.moonsKnownOne':
    'Lunes déjà vues à cette date : {count} sur la seule que recense aujourd’hui le JPL',
  'bi.discovery.moonsKnownRangeOne':
    'Lunes déjà vues à cette date : entre {min} et {max} sur la seule que recense aujourd’hui le JPL',
  'bi.discovery.moonsNext': 'Découverte suivante : {year} ({names})',
  'bi.discovery.moonsMore': '{names} et {count} autres',
  'bi.discovery.moonsNote':
    'Ce compte ne retient que les lunes que la table du JPL recense aujourd’hui, lue le {date} : une lune annoncée puis réfutée n’y figure pas, donc ce n’est pas ce que l’on croyait à l’époque.',
  'bi.discovery.moonsNoteSbdb':
    'Ce compte ne retient que les satellites que la JPL Small-Body Database confirme aujourd’hui, lue le {date} : un satellite annoncé puis réfuté n’y figure pas, donc ce n’est pas ce que l’on croyait à l’époque.',
  'bi.discovery.moonsUnconfirmed':
    'Non comptés, parce que la base les dit non confirmés : {names}.',
  'bi.discovery.names':
    'Noms de surface que l’UAI avait rendus officiels à cette date : {count} sur {total}',
  'bi.discovery.namesRange':
    'Noms de surface que l’UAI avait rendus officiels à cette date : entre {min} et {max} sur {total}',
  'bi.discovery.lettered':
    'Désignations lettrées comme « Copernicus A » rendues officielles à cette date : {count} sur {total}',
  'bi.discovery.letteredRange':
    'Désignations lettrées comme « Copernicus A » rendues officielles à cette date : entre {min} et {max} sur {total}',
  'bi.discovery.namesNext': 'Adoption suivante : {date}, {count} de plus',
  'bi.discovery.namesNote':
    'Dates d’adoption du Gazetteer of Planetary Nomenclature de l’UAI, lu le {date} : la date à laquelle un nom est devenu officiel, pas celle où la formation a été vue ou nommée pour la première fois.',
  'bi.discovery.refutedThatYear':
    'En {year}, l’année de la scène, {who} signale un possible satellite de ce corps ; la source ne donne pas le jour.',
  'bi.discovery.refutedReported':
    'À cette date, un possible satellite de ce corps avait déjà été signalé : dès {year} par {who}, puis plusieurs fois par d’autres observateurs, dont {others}.',
  'bi.discovery.refutedSearched':
    'Une recherche déposée le {date} n’en a trouvé aucun, jusqu’à environ {radius} de rayon.',
  'bi.atmosphere.label': 'Profil mesuré (sonde Galileo)',
  'bi.atmosphere.labelNone': 'Profil mesuré de l’atmosphère',
  'bi.atmosphere.labelTitan': 'Profil mesuré (sonde Huygens)',
  'bi.atmosphere.altitudeSurface': 'Au-dessus du sol',
  'bi.atmosphere.ground': 'Sol',
  'bi.atmosphere.localTitan':
    'Un seul lieu de Titan, latitude {min}° à {max}°, traversé le {date} en descente. La dernière ligne est la première lecture au niveau du sol ; les lectures suivantes vont de {low} à {high} K.',
  'bi.atmosphere.site': 'Latitude lue dans : {title}, DOI {doi}.',
  'bi.atmosphere.altitude': 'Au-dessus de 1 bar',
  'bi.atmosphere.pressure': 'Pression',
  'bi.atmosphere.temperature': 'Température',
  'bi.atmosphere.local':
    'Un seul point du globe, latitude {min}° à {max}°, traversé le {date}. L’article de l’équipe le situe au bord d’une tache chaude à 5 µm de la bande équatoriale nord.',
  'bi.atmosphere.adjusted':
    'À partir de {altitude}, l’équipe a ajusté l’adiabatique sèche aux données : ces lignes ne sont pas des points mesurés.',
  'bi.atmosphere.citation':
    '{authors} ({year}), {title}, NASA Planetary Data System, DOI {doi}. {reference} Lu le {date}.',
  'bi.atmosphere.absent':
    'Aucun profil de température et de pression de la basse atmosphère n’est publié en données au Planetary Data System de la NASA pour cette planète : {count} collections lues le {date}, aucune n’en est un.',
  'bi.missions.countAtDate': '{count}, dont {active} à cette date',
  'bi.missions.countAllAtDate': '{count}, toutes à cette date',
  'bi.missions.none':
    'Aucune mission de cette archive ne déclare ce corps parmi ses cibles.',
  'bi.missions.span': 'du {from} au {to}',
  'bi.missions.spanUndeclared': 'dates non déclarées',
  'bi.missions.spanEndOnly': 'jusqu’au {to}, début non déclaré',
  'bi.missions.spanOpen': 'depuis le {from}, fin non déclarée',
  'bi.missions.atDate': 'avait commencé à la date de la scène',
  'bi.missions.note':
    'Ce que l’archive du PDS déclare pour chaque mission : l’intervalle de ses données et les corps qu’elle prend pour cibles, lu le {date}. Une cible déclarée n’est pas un relevé d’observations, et le début est celui du projet, pas le lancement.',
  'bi.instruments.investigations': 'Investigations où elle figure',
  'bi.instruments.hostEmpty': '(aucun instrument déclaré)',
  'bi.instruments.absent':
    'L’archive du PDS ne déclare ici aucune investigation, et donc aucun instrument.',
  'bi.instruments.absentNote': 'Lu dans l’archive du PDS le {date}.',
  'bi.instruments.note':
    'Ce que l’archive du PDS déclare que cette sonde embarque, lu le {date}. Chaque nom est celui que l’archive publie, et l’identifiant sous lui en est la citation.',
  'place.marker.hint':
    'Vue tournée vers ce lieu. Approchez-vous pour voir les noms de la surface.',
  'place.marker.announce':
    '{place}, {body} : la vue est tournée vers ce lieu. Approchez-vous pour voir les noms de la surface.',
  'bi.places.count':
    '{observed} observées sur {evaluated} évaluées dans le jeu ODE publié.',
  'bi.places.countNamed': '{named} nommées dans le catalogue UAI.',
  'bi.places.search': 'Formation nommée',
  'bi.places.hint':
    'Saisissez le nom d’une formation pour voir quels orbiteurs l’ont observée.',
  'bi.places.unknown': 'Aucune formation de ce corps ne porte ce nom.',
  'bi.places.none':
    'Aucune empreinte publiée par l’Orbital Data Explorer ne touche cette formation.',
  'bi.places.notEvaluated':
    'Cette formation n’a pas été évaluée dans le jeu de données ODE actuellement publié.',
  'bi.places.unavailable':
    'Les observations de cette formation n’ont pas pu être chargées.',
  'bi.places.observations': 'Observations : {count}, {span}',
  'bi.places.observationsUndated': 'Observations : {count}, dates non publiées',
  'bi.places.firstLabel': 'Première observation (étiquette PDS)',
  'bi.places.announce': '{name}, instruments : {count}',
  'bi.places.uncovered':
    'Les empreintes des observations n’ont été trouvées, dans l’Orbital Data Explorer de la NASA, que pour ces corps : {bodies}. Aucun service public d’empreintes n’a été trouvé pour ce corps.',
  'bi.cities.label': 'Villes en 3D',
  'bi.cities.hint':
    'Villes dont les bâtiments sont dessinés en 3D quand on s’approche. Choisissez-en une pour y plonger.',
  'bi.cities.go': 'Plonger sur {city}',
  'bi.cities.diving': 'Plongée sur {city}',
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
  'bi.cities.name.london-overture': 'Londres',
  'bi.cities.name.amsterdam-3dbag': 'Amsterdam',
  'bi.cities.name.rotterdam-3dbag': 'Rotterdam',
  'bi.cities.name.denhaag-3dbag': 'La Haye',
  'bi.cities.name.utrecht-3dbag': 'Utrecht',
  'bi.cities.name.eindhoven-3dbag': 'Eindhoven',
  'bi.cities.name.chicago-overture': 'Chicago',
  'bi.cities.name.singapore-overture': 'Singapour',
  'bi.cities.name.sydney-overture': 'Sydney',
  'bi.cities.name.paris-bdtopo': 'Paris',
  'bi.cities.name.berlin-lod2': 'Berlin',
  'bi.cities.name.nairobi-overture': 'Nairobi',
  'bi.places.note':
    'Empreintes lues dans l’Orbital Data Explorer de la NASA (PDS Geosciences Node), produits créés jusqu’au {date}. Un produit dont l’empreinte couvre aussi l’antipode de la formation, comme une carte globale, n’est pas compté.',
  'inspect.title': 'Météo en un point',
  'inspect.hint.pick':
    'Cliquez ou touchez le globe, ou saisissez des coordonnées, pour lire les couches actives.',
  'inspect.hint.noLayers':
    'Aucune couche inspectable n’est active. Activez une couche de modèle (température, pression, humidité, pluie, nuages ou vent) dans le panneau météo. L’inspecteur n’en active jamais une pour vous.',
  'inspect.hint.images':
    'Les couches satellite et NASA GIBS sont des images : elles ne sont pas lues ici.',
  'inspect.lat': 'Latitude',
  'inspect.lon': 'Longitude',
  'inspect.go': 'Lire ce point',
  'inspect.center': 'Utiliser le centre de la vue',
  'inspect.offGlobe': 'Le centre de la vue n’est pas sur le globe.',
  'inspect.badCoords':
    'Saisissez une latitude de −90 à 90 et une longitude de −180 à 180.',
  'inspect.details': 'Source et date',
  'inspect.expand': 'Afficher la carte complète',
  'inspect.collapse': 'Réduire',
  'inspect.about': 'À propos de ces valeurs',
  'inspect.summary': 'Lectures en ce point',
  'inspect.caveat':
    'Les valeurs sont interpolées depuis une grille de modèle. Ce n’est pas une mesure à cet endroit précis.',
  'inspect.selected': 'Point choisi : {lat}, {lon}.',
  'inspect.var.temperature': 'Température (2 m)',
  'inspect.var.pressure': 'Pression au niveau de la mer',
  'inspect.var.humidity': 'Humidité relative',
  'inspect.var.precipitation': 'Précipitations',
  'inspect.var.cloudCover': 'Couverture nuageuse (modèle)',
  'inspect.var.wind': 'Vent (10 m)',
  'inspect.msg.missing': 'Aucune valeur dans le modèle en ce point.',
  'inspect.msg.outOfCoverage': 'Hors de la couverture de la grille.',
  'inspect.msg.stale':
    'Périmé : la grille chargée décrit une autre heure, aucune valeur n’est donc affichée.',
  'inspect.msg.staleError':
    'La mise à jour a échoué. La grille chargée décrit une autre heure, aucune valeur n’est donc affichée.',
  'inspect.msg.updating': 'Mise à jour pour la nouvelle date…',
  'inspect.msg.outOfRange': 'Cette date est hors de la plage du modèle.',
  'inspect.msg.error': 'Les données n’ont pas pu être chargées.',
  'inspect.msg.loading': 'Chargement…',
  'inspect.wind.calm': 'Calme : pas de direction significative',
  'inspect.wind.from': 'Provenance : {dir} · {deg}°',
  'inspect.dir.N': 'N',
  'inspect.dir.NE': 'NE',
  'inspect.dir.E': 'E',
  'inspect.dir.SE': 'SE',
  'inspect.dir.S': 'S',
  'inspect.dir.SW': 'SO',
  'inspect.dir.W': 'O',
  'inspect.dir.NW': 'NO',
  'inspect.precip.rate': 'Taux instantané (GFS)',
  'inspect.precip.accumulation': 'Cumul sur l’heure précédente',
  'inspect.precip.none': 'Aucune précipitation',
  'inspect.meta.source': 'Source',
  'inspect.meta.nature': 'Nature',
  'inspect.meta.effective': 'Valable pour',
  'inspect.meta.requested': 'Heure demandée',
  'inspect.meta.offset': '{h} h par rapport à l’heure demandée',
  'inspect.meta.grid': 'Grille',
  'inspect.meta.gridValue': 'grille de {step}°, interpolée',
  'craft.button': 'Inspecter en 3D',
  'craft.issButton': 'Inspecter l’ISS en 3D',
  'craft.noModel':
    'Aucun modèle 3D fiable de cette sonde n’est disponible ici : rien n’est dessiné plutôt qu’une forme inventée.',
  'craft.title': '{name} : inspection en 3D',
  'craft.close': 'Fermer l’inspection',
  'craft.reset': 'Réinitialiser la vue',
  'craft.loading': 'Chargement du modèle 3D…',
  'craft.failed':
    'Le modèle 3D n’a pas pu être chargé. La scène est inchangée.',
  'craft.unavailable':
    'L’inspection en 3D n’est pas disponible : le contexte graphique ne répond pas.',
  'craft.help':
    'Glissez ou utilisez les flèches pour tourner le modèle. Molette, pincement ou touches + et - pour zoomer. Origine réinitialise la vue, Échap la ferme.',
  'craft.scale':
    'Échelle de présentation : l’engin est montré agrandi ici pour pouvoir être inspecté. Dans la scène astronomique, il n’est jamais agrandi.',
  'craft.fidelity':
    'Modèle représentatif de la collection 3D Resources de la NASA. Ses proportions et ses détails sont ceux du fichier : ce projet ne les a pas vérifiés sur des plans d’ingénierie.',
  'craft.rights':
    'La NASA indique que les contenus servant à rendre des modèles 3D ne sont généralement pas soumis au droit d’auteur aux États-Unis (NASA Images and Media Usage Guidelines, lu le 2026-11-23). Aucun soutien de la NASA n’est suggéré.',
  'craft.parts': 'Pièces nommées dans le fichier',
  'craft.partsNone':
    'Ce modèle est un seul bloc : son fichier ne nomme pas de pièces séparées.',
  'craft.instruments': 'Instruments déclarés dans l’archive PDS',
  'craft.instrumentsNote':
    'La liste vient du registre de contexte du PDS, pas du modèle 3D : le modèle ne dit pas où se trouve chaque instrument.',
  'craft.provenance': 'Provenance',
  'craft.source': 'Fichier source',
  'craft.credit': 'Crédit : {credit}',
  'craft.file': '{kb} ko, {tris} triangles, SHA-256 {hash}…',
  'craft.opened': 'Inspection de {name} en 3D.',
  'craft.closed': 'Retour à la vue précédente.',
  'craft.partOn': '{part} mise en évidence.',
  'craft.partOff': 'Mise en évidence retirée.',
  'sat.kind': 'Objet en orbite',
  'sat.group.stations': 'Groupe : stations spatiales',
  'sat.group.visual': 'Groupe : objets les plus brillants',
  'sat.unknown': 'non publié',
  'sat.norad': 'Numéro de catalogue NORAD',
  'sat.designator': 'Désignation internationale (COSPAR)',
  'sat.period': 'Période orbitale',
  'sat.minutes': '{n} min',
  'sat.altitudes': 'Altitude, du périgée à l’apogée',
  'sat.altitudesValue': '{perigee} à {apogee} km',
  'sat.inclination': 'Inclinaison',
  'sat.eccentricity': 'Excentricité',
  'sat.epoch': 'Époque des éléments',
  'sat.validity': 'Éléments valables',
  'sat.validityValue': 'du {from} au {to}',
  'sat.altitude': 'Altitude maintenant (SGP4)',
  'sat.km': '{n} km',
  'sat.speed': 'Vitesse maintenant (SGP4)',
  'sat.kmPerS': '{n} km/s',
  'sat.over': 'Au-dessus de (SGP4)',
  'sat.outside':
    'À la date de la scène, ces éléments sont hors de leur validité : l’objet n’est pas dessiné plutôt que dessiné au mauvais endroit.',
  'sat.model.iss':
    'L’ISS a un modèle 3D (NASA 3D Resources). Il n’est agrandi que dans l’inspection ; dans l’espace elle reste un point.',
  'sat.model.none':
    'Pas de modèle 3D pour cet objet : il reste un point plutôt qu’une forme inventée.',
  'sat.source':
    'Éléments de CelesTrak (18th Space Defense Squadron), lus le {date} UTC par le service de données de Galaxy et propagés par SGP4. L’erreur croît de quelques kilomètres par jour autour de l’époque. Altitude, vitesse et position sont calculées, pas mesurées.',
  'sat.opened': '{name} : fiche du satellite ouverte.',
  'sat.search.label': 'Trouver un satellite',
  'sat.search.placeholder': 'Saisir un nom, par exemple ISS',
  'sat.follow': 'Suivre cet objet',
  'sat.unfollow': 'Arrêter le suivi',
  'sat.following':
    "{name} : la caméra suit l'objet. Tournez, zoomez ou arrêtez le suivi à tout moment.",
  'sat.followChip': 'Suivi de {name}',
  'sat.followEnded': '{name} : suivi arrêté.',
  'sat.followEndedOutside':
    '{name} : suivi arrêté, les éléments ne sont plus valables à cette date.',
  'sat.followEndedNoSolution':
    "{name} : suivi arrêté, SGP4 n'a pas de position pour cette date.",
  'sat.path':
    "Trace de l'orbite : une période en avant de la date de la scène, calculée par SGP4 à partir des éléments. Elle n'est pas mesurée, et aucune trace du passé n'est dessinée. Les flèches montrent le sens du déplacement.",
  'sat.pathTruncated':
    "La trace s'arrête là où les éléments cessent d'être valables.",
  'sx.open': 'Explorer ce système',
  'sx.unavailable': "L'exploration du système n'a pas pu être chargée.",
  'sx.title': 'Le système {name}',
  'sx.back': 'Retour au voisinage',
  'sx.reset': 'Tout le système',
  'sx.compare': 'Comparer au Système solaire',
  'sx.scale':
    'Une unité vaut une unité astronomique (la distance Terre-Soleil). Les orbites sont dessinées de face.',
  'sx.field': 'Champ de vue : {au} UA de large',
  'sx.help':
    'Glisser pour tourner, molette ou pincement pour zoomer, toucher une étoile ou une orbite. Clavier : flèches pour tourner, + et - pour zoomer, Origine pour tout le système, Échap pour revenir au voisinage. La liste donne le même accès.',
  'sx.list': 'Dans ce système',
  'sx.listStar': '{name} (étoile)',
  'sx.listPlanet': '{name} (planète)',
  'sx.listPlanetNoOrbit': '{name} (planète, orbite non dessinée)',
  'sx.opened':
    'Système {name} ouvert : {stars} étoiles au catalogue, {planets} planètes cataloguées.',
  'sx.selected': '{name} choisie',
  'sx.closed': 'Retour au voisinage solaire.',
  'sx.archiveUnavailable':
    "L'archive des planètes n'a pas pu être lue : seules les étoiles sont montrées.",
  'sx.doc.noPlanets':
    "Aucune orbite à dessiner : l'archive ne liste aucune planète pour ce système (instantané du {date}). Cela ne veut pas dire qu'il n'en a pas.",
  'sx.doc.noAxis':
    "Aucune orbite à dessiner : ses planètes n'ont ni demi-grand axe ni masse d'étoile pour en dériver un. Leurs données sont dans la liste.",
  'sx.missingHosts':
    "Reconnus dans la couche du ciel mais absents de l'instantané détaillé : {hosts}.",
  'sx.star.separation': 'Séparation projetée avec {name}',
  'sx.star.separationValue':
    '{au} UA (dérivée des positions du catalogue : un minimum, la distance le long de la ligne de visée est inconnue)',
  'sx.star.teff': 'Température effective',
  'sx.star.radius': 'Rayon',
  'sx.star.mass': 'Masse',
  'sx.star.noHost':
    "Aucune planète de l'archive n'est attribuée à cette étoile.",
  'sx.star.hostOf':
    'NASA Exoplanet Archive : hôte « {host} », {count} planètes cataloguées dessinées ou listées ici.',
  'sx.star.trueSize':
    "L'étoile est dessinée à son rayon publié ; son point garde une taille constante à l'écran pour la retrouver de loin.",
  'sx.star.archiveStars':
    "L'archive compte {n} étoiles dans ce système ; le catalogue du voisinage en regroupe {m} ici (une compagne à plus d'une minute d'arc a son propre repère).",
  'sx.planet.star': 'Étoile hôte',
  'sx.planet.eccentricity': 'Excentricité',
  'sx.planet.eccZero': "0 (publiée ; souvent fixée à zéro par l'ajustement)",
  'sx.planet.eccUnknown':
    "non publiée : l'orbite est un cercle en tirets à son demi-grand axe",
  'sx.planet.range': "Distance à l'étoile",
  'sx.planet.rangeValue': 'de {q} à {Q} UA',
  'sx.planet.inclination': 'Inclinaison',
  'sx.planet.mass': 'Masse',
  'sx.planet.noOrbit':
    "Ni demi-grand axe ni masse d'étoile pour en dériver un : l'orbite n'est pas dessinée.",
  'sx.planet.position':
    "La position de la planète sur son orbite n'est pas connue : son nom marque l'orbite, pas la planète.",
  'sx.planet.radiusCalculated':
    "Son rayon n'a pas été mesuré : l'archive le calcule à partir de la masse.",
  'sx.planet.controversial': "L'archive signale cette planète comme contestée.",
  'sx.planet.circumbinary':
    "L'archive la classe comme circumbinaire (en orbite autour de deux étoiles).",
  'sx.tag.calculated': "valeur calculée par l'archive",
  'sx.tag.derived': 'valeur dérivée ici, troisième loi de Kepler',
  'sx.tag.minimum': 'masse minimale, m sin i',
  'sx.tag.trueMass': 'masse',
  'sx.unit.kelvin': '{v} K',
  'sx.unit.solarRadii': '{v} rayons solaires',
  'sx.unit.solarMasses': '{v} masses solaires',
  'sx.unit.earthMasses': '{v} masses terrestres',
  'sx.unit.degrees': '{v}°',
  'sx.table.title': 'Comparer les planètes',
  'sx.table.planet': 'Planète',
  'sx.table.caption':
    'Période en jours, demi-grand axe en UA, masse en masses terrestres, rayon en rayons terrestres. † calculé par l’archive ; ‡ dérivé ici (troisième loi de Kepler) ; ≥ masse minimale (m sin i) ; un tiret : non publié.',
  'sx.compare.note':
    'Cercles gris en tirets : les orbites des planètes du Système solaire à la même échelle (demi-grands axes, NSSDCA), centrées sur {name}.',
  'sx.compare.ring': '{name} (Système solaire)',
  'sx.read.title': 'Comment lire cette vue',
  'sx.read.measured':
    'Mesuré : la position, la distance et le mouvement des étoiles (Gaia DR3 ou HYG), et la séparation projetée entre deux étoiles du système.',
  'sx.read.catalogued':
    "Catalogué : les planètes et leurs orbites, de la NASA Exoplanet Archive (instantané du {date}). Chaque valeur dit quand l'archive l'a calculée au lieu de la tirer d'une publication.",
  'sx.read.derived':
    "Dérivé ici : un demi-grand axe calculé à partir de la période et de la masse de l'étoile (troisième loi de Kepler), signalé comme tel.",
  'sx.read.illustrative':
    "Illustratif : les orbites sont dessinées de face car leur orientation sur le ciel n'est pas publiée (le nœud jamais, l'inclinaison rarement) ; une bande va de la plus petite à la plus grande distance à l'étoile ; un cercle en tirets signifie une excentricité non publiée ; les couleurs ne servent qu'à distinguer les orbites.",
  'sx.read.unknown':
    "Inconnu : la position de chaque planète sur son orbite, l'inclinaison des orbites, la distance entre les étoiles le long de la ligne de visée. Rien n'est dessiné pour cela.",
  'sx.sources':
    'Étoiles : catalogue du voisinage (Gaia DR3 ou HYG). Planètes et étoile hôte : NASA Exoplanet Archive, table pscomppars, instantané du {date}.',
  'sx.sourcesStars': 'Étoiles : catalogue du voisinage (Gaia DR3 ou HYG).',
  'sx.star.spectral': 'Type spectral (catalogue du voisinage)',
  'sx.star.spectralArchive': 'Type spectral (archive)',
  'sx.backSky': 'Retour au ciel',
  'sx.closedSky': 'Retour au ciel.',
  'sx.unknownHost':
    "Ce système planétaire n'est pas dans le catalogue du ciel : l'exploration ne s'ouvre pas.",
  'sx.star.distanceArchive': 'Distance au Soleil (archive)',
  'sx.star.originArchive':
    "Étoile connue de la seule NASA Exoplanet Archive (elle n'est pas dans le catalogue du voisinage) : ses autres étoiles, s'il y en a, ne sont pas placées, car l'archive en donne le nombre, pas les positions.",
  'sx.star.circumbinary':
    "Au moins une planète tourne ici autour d'un COUPLE d'étoiles (circumbinaire dans l'archive) : son orbite est dessinée autour du centre du système, et aucune étoile seule n'y est dessinée, car les positions des deux étoiles ne sont pas dans les données.",
  'sx.star.archiveStarsSky': "L'archive compte {n} étoiles dans ce système.",
  'sx.helpSky':
    'Glisser pour tourner, molette ou pincement pour zoomer, toucher une étoile ou une orbite. Clavier : flèches pour tourner, + et - pour zoomer, Origine pour tout le système, Échap pour revenir au ciel. La liste donne le même accès.',
  'sx.read.measuredSky':
    "Publié : la distance du système et les paramètres de son étoile hôte, tels que l'archive les donne.",
  'sx.sourcesSky':
    'Étoile et planètes : NASA Exoplanet Archive, table pscomppars, instantané du {date}.',
};
