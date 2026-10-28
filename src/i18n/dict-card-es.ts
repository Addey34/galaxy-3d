/** Les phrases des blocs hors démarrage, cf. `./dict-card-en.ts` (lot 52, piste C). */
import type { CardMessageKey } from './dict-card-en';

export const cardEs: Record<CardMessageKey, string> = {
  'search.group.dataset': 'Capas de datos',
  'search.group.place': 'Lugares',
  'search.group.mission': 'Misiones',
  'search.group.instrument': 'Instrumentos',
  'search.group.discovery': 'Descubrimientos',
  'search.group.flyby': 'Sobrevuelos',
  'search.group.orbitInsertion': 'Inserciones en órbita',
  'search.group.perihelion': 'Perihelios',
  'search.group.perijove': 'Perijoves',
  'search.group.contact': 'Contactos',
  'search.missionPage': 'página de la misión',
  'surface.compare.slider': 'Cortina antes y después',
  'surface.compare.valuetext':
    '{before} a la izquierda de la línea, {after} a la derecha, línea al {percent} % del ancho',
  'bi.discovery.according': '{source}, leído el {date}',
  'bi.discovery.prehistoric': 'Desde la prehistoria',
  'bi.discovery.ancient': 'Desde la Antigüedad',
  'bi.discovery.ancientObservations':
    'Observaciones antiguas de hace más de dos mil años',
  'bi.discovery.predictedReturn': 'Retorno predicho, observado el {date}',
  'bi.discovery.notYetKnown':
    'En la fecha de la escena, este cuerpo aún no se conocía.',
  'bi.discovery.known': 'En la fecha de la escena, este cuerpo ya se conocía.',
  'bi.discovery.onTheDay':
    'La fecha de la escena es el día de su descubrimiento.',
  'bi.discovery.withinYear':
    'La fecha de la escena cae en el año de su descubrimiento, y la fuente no indica el día.',
  'bi.discovery.withinDates':
    'La fecha de la escena cae entre las fechas publicadas: la respuesta depende de la fuente.',
  'bi.discovery.moonsKnown':
    'Lunas ya vistas en esta fecha: {count} de las {total} que el JPL registra hoy',
  'bi.discovery.moonsKnownRange':
    'Lunas ya vistas en esta fecha: entre {min} y {max} de las {total} que el JPL registra hoy',
  'bi.discovery.moonsKnownOne':
    'Lunas ya vistas en esta fecha: {count} de la única que el JPL registra hoy',
  'bi.discovery.moonsKnownRangeOne':
    'Lunas ya vistas en esta fecha: entre {min} y {max} de la única que el JPL registra hoy',
  'bi.discovery.moonsNext': 'Siguiente descubrimiento: {year} ({names})',
  'bi.discovery.moonsMore': '{names} y {count} más',
  'bi.discovery.moonsNote':
    'Este recuento solo incluye las lunas que la tabla del JPL registra hoy, leída el {date}: una luna anunciada y luego refutada no figura en ella, así que no es lo que se creía en su momento.',
  'bi.discovery.moonsNoteSbdb':
    'Este recuento solo incluye los satélites que la JPL Small-Body Database confirma hoy, leída el {date}: un satélite anunciado y luego refutado no figura en ella, así que no es lo que se creía en su momento.',
  'bi.discovery.moonsUnconfirmed':
    'No contados, porque la base de datos los da como no confirmados: {names}.',
  'bi.discovery.names':
    'Nombres de superficie que la UAI había hecho oficiales en esta fecha: {count} de {total}',
  'bi.discovery.namesRange':
    'Nombres de superficie que la UAI había hecho oficiales en esta fecha: entre {min} y {max} de {total}',
  'bi.discovery.lettered':
    'Designaciones con letra como «Copernicus A» hechas oficiales en esta fecha: {count} de {total}',
  'bi.discovery.letteredRange':
    'Designaciones con letra como «Copernicus A» hechas oficiales en esta fecha: entre {min} y {max} de {total}',
  'bi.discovery.namesNext': 'Siguiente adopción: {date}, {count} más',
  'bi.discovery.namesNote':
    'Fechas de adopción del Gazetteer of Planetary Nomenclature de la UAI, leído el {date}: la fecha en que un nombre se hizo oficial, no la fecha en que la formación se vio o se nombró por primera vez.',
  'bi.discovery.refutedThatYear':
    'En {year}, el año de la escena, {who} señala un posible satélite de este cuerpo; la fuente no da el día.',
  'bi.discovery.refutedReported':
    'En esta fecha ya se había señalado un posible satélite de este cuerpo: desde {year} por {who}, y después varias veces por otros observadores, entre ellos {others}.',
  'bi.discovery.refutedSearched':
    'Una búsqueda depositada el {date} no encontró ninguno, hasta unos {radius} km de radio.',
  'bi.atmosphere.label': 'Perfil medido (sonda Galileo)',
  'bi.atmosphere.labelNone': 'Perfil medido de la atmósfera',
  'bi.atmosphere.labelTitan': 'Perfil medido (sonda Huygens)',
  'bi.atmosphere.altitudeSurface': 'Sobre el suelo',
  'bi.atmosphere.ground': 'Suelo',
  'bi.atmosphere.localTitan':
    'Un solo lugar de Titán, latitud {min}° a {max}°, atravesado el {date} en el descenso. La última fila es la primera lectura a nivel del suelo; las lecturas siguientes van de {low} a {high} K.',
  'bi.atmosphere.site': 'Latitud leída en: {title}, DOI {doi}.',
  'bi.atmosphere.altitude': 'Sobre 1 bar',
  'bi.atmosphere.pressure': 'Presión',
  'bi.atmosphere.temperature': 'Temperatura',
  'bi.atmosphere.local':
    'Un solo punto del globo, latitud {min}° a {max}°, atravesado el {date}. El artículo del equipo lo sitúa en el borde de una mancha caliente a 5 µm del cinturón ecuatorial norte.',
  'bi.atmosphere.adjusted':
    'A partir de {altitude}, el equipo ajustó la adiabática seca a los datos: esas filas no son puntos medidos.',
  'bi.atmosphere.citation':
    '{authors} ({year}), {title}, NASA Planetary Data System, DOI {doi}. {reference} Leído el {date}.',
  'bi.atmosphere.absent':
    'Ningún perfil de temperatura y presión de la baja atmósfera se publica como datos en el Planetary Data System de la NASA para este planeta: {count} colecciones leídas el {date}, ninguna lo es.',
  'bi.missions.countAtDate': '{count}, de las cuales {active} en esta fecha',
  'bi.missions.countAllAtDate': '{count}, todas en esta fecha',
  'bi.missions.none':
    'Ninguna misión de este archivo declara este cuerpo entre sus objetivos.',
  'bi.missions.span': 'del {from} al {to}',
  'bi.missions.spanUndeclared': 'fechas no declaradas',
  'bi.missions.spanEndOnly': 'hasta el {to}, inicio no declarado',
  'bi.missions.spanOpen': 'desde el {from}, fin no declarado',
  'bi.missions.atDate': 'había comenzado en la fecha de la escena',
  'bi.missions.note':
    'Lo que el archivo del PDS declara para cada misión: el intervalo de sus datos y los cuerpos que toma como objetivos, leído el {date}. Un objetivo declarado no es un registro de observaciones, y el inicio es el del proyecto, no el lanzamiento.',
  'bi.instruments.investigations': 'Investigaciones en las que figura',
  'bi.instruments.hostEmpty': '(ningún instrumento declarado)',
  'bi.instruments.absent':
    'El archivo del PDS no declara aquí ninguna investigación, y por tanto ningún instrumento.',
  'bi.instruments.absentNote': 'Leído en el archivo del PDS el {date}.',
  'bi.instruments.note':
    'Lo que el archivo del PDS declara que lleva esta sonda, leído el {date}. Cada nombre es el que publica el archivo, y el identificador debajo es su cita.',
  'bi.places.count': '{observed} de {total} con nombre',
  'bi.places.search': 'Formación con nombre',
  'bi.places.hint':
    'Escriba el nombre de una formación para ver qué orbitadores la observaron.',
  'bi.places.unknown': 'Ninguna formación de este cuerpo lleva ese nombre.',
  'bi.places.none':
    'Ninguna huella publicada por el Orbital Data Explorer toca esta formación.',
  'bi.places.unavailable':
    'No se pudieron cargar las observaciones de esta formación.',
  'bi.places.observations': 'Observaciones: {count}, {span}',
  'bi.places.observationsUndated':
    'Observaciones: {count}, fechas no publicadas',
  'bi.places.firstLabel': 'Primera observación (etiqueta PDS)',
  'bi.places.announce': '{name}, instrumentos: {count}',
  'bi.places.uncovered':
    'Solo se encontraron huellas de observaciones, en el Orbital Data Explorer de la NASA, para estos cuerpos: {bodies}. No se encontró ningún servicio público de huellas para este cuerpo.',
  'bi.places.note':
    'Huellas leídas en el Orbital Data Explorer de la NASA (PDS Geosciences Node), productos creados hasta el {date}. No se cuenta un producto cuya huella cubre también el antípoda de la formación, como un mapa global.',
};
