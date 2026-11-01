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
  'bi.places.count': '{observed} sur {total} nommées',
  'bi.places.search': 'Formation nommée',
  'bi.places.hint':
    'Saisissez le nom d’une formation pour voir quels orbiteurs l’ont observée.',
  'bi.places.unknown': 'Aucune formation de ce corps ne porte ce nom.',
  'bi.places.none':
    'Aucune empreinte publiée par l’Orbital Data Explorer ne touche cette formation.',
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
  'bi.cities.name.newyork-overture': 'New York',
  'bi.cities.name.london-overture': 'Londres',
  'bi.cities.name.amsterdam-overture': 'Amsterdam',
  'bi.cities.name.chicago-overture': 'Chicago',
  'bi.cities.name.singapore-overture': 'Singapour',
  'bi.cities.name.sydney-overture': 'Sydney',
  'bi.cities.name.paris-bdtopo': 'Paris',
  'bi.cities.name.berlin-lod2': 'Berlin',
  'bi.cities.name.nairobi-overture': 'Nairobi',
  'bi.places.note':
    'Empreintes lues dans l’Orbital Data Explorer de la NASA (PDS Geosciences Node), produits créés jusqu’au {date}. Un produit dont l’empreinte couvre aussi l’antipode de la formation, comme une carte globale, n’est pas compté.',
};
