/** Les phrases des blocs hors démarrage, cf. `./dict-card-en.ts` (lot 52, piste C). */
import type { CardMessageKey } from './dict-card-en';

export const cardPtBR: Record<CardMessageKey, string> = {
  'search.group.dataset': 'Camadas de dados',
  'search.group.place': 'Lugares',
  'search.group.mission': 'Missões',
  'search.group.instrument': 'Instrumentos',
  'search.group.discovery': 'Descobertas',
  'search.group.flyby': 'Sobrevoos',
  'search.group.orbitInsertion': 'Inserções em órbita',
  'search.group.contact': 'Contatos',
  'search.missionPage': 'página da missão',
  'surface.compare.slider': 'Cortina antes e depois',
  'surface.compare.valuetext':
    '{before} à esquerda da linha, {after} à direita, linha a {percent} % da largura',
  'bi.discovery.according': '{source}, lido em {date}',
  'bi.discovery.prehistoric': 'Desde a pré-história',
  'bi.discovery.ancient': 'Desde a Antiguidade',
  'bi.discovery.ancientObservations':
    'Observações antigas de mais de dois mil anos',
  'bi.discovery.predictedReturn': 'Retorno previsto, observado em {date}',
  'bi.discovery.notYetKnown':
    'Na data da cena, este corpo ainda não era conhecido.',
  'bi.discovery.known': 'Na data da cena, este corpo já era conhecido.',
  'bi.discovery.onTheDay': 'A data da cena é o dia da sua descoberta.',
  'bi.discovery.withinYear':
    'A data da cena cai no ano da sua descoberta, e a fonte não informa o dia.',
  'bi.discovery.withinDates':
    'A data da cena cai entre as datas publicadas: a resposta depende da fonte.',
  'bi.discovery.moonsKnown':
    'Luas já vistas nesta data: {count} das {total} que o JPL registra hoje',
  'bi.discovery.moonsKnownRange':
    'Luas já vistas nesta data: entre {min} e {max} das {total} que o JPL registra hoje',
  'bi.discovery.moonsKnownOne':
    'Luas já vistas nesta data: {count} da única que o JPL registra hoje',
  'bi.discovery.moonsKnownRangeOne':
    'Luas já vistas nesta data: entre {min} e {max} da única que o JPL registra hoje',
  'bi.discovery.moonsNext': 'Próxima descoberta: {year} ({names})',
  'bi.discovery.moonsMore': '{names} e mais {count}',
  'bi.discovery.moonsNote':
    'Esta contagem inclui apenas as luas que a tabela do JPL registra hoje, lida em {date}: uma lua anunciada e depois refutada não aparece nela, portanto não é o que se acreditava na época.',
  'bi.discovery.moonsNoteSbdb':
    'Esta contagem inclui apenas os satélites que a JPL Small-Body Database confirma hoje, lida em {date}: um satélite anunciado e depois refutado não aparece nela, portanto não é o que se acreditava na época.',
  'bi.discovery.moonsUnconfirmed':
    'Não contados, porque a base de dados os indica como não confirmados: {names}.',
  'bi.discovery.names':
    'Nomes de superfície que a UAI havia tornado oficiais nesta data: {count} de {total}',
  'bi.discovery.namesRange':
    'Nomes de superfície que a UAI havia tornado oficiais nesta data: entre {min} e {max} de {total}',
  'bi.discovery.lettered':
    'Designações com letra como “Copernicus A” tornadas oficiais nesta data: {count} de {total}',
  'bi.discovery.letteredRange':
    'Designações com letra como “Copernicus A” tornadas oficiais nesta data: entre {min} e {max} de {total}',
  'bi.discovery.namesNext': 'Próxima adoção: {date}, {count} a mais',
  'bi.discovery.namesNote':
    'Datas de adoção do Gazetteer of Planetary Nomenclature da UAI, lido em {date}: a data em que um nome se tornou oficial, não a data em que a formação foi vista ou nomeada pela primeira vez.',
  'bi.discovery.refutedThatYear':
    'Em {year}, o ano da cena, {who} relata um possível satélite deste corpo; a fonte não dá o dia.',
  'bi.discovery.refutedReported':
    'Nesta data, um possível satélite deste corpo já havia sido relatado: desde {year} por {who}, e depois várias vezes por outros observadores, entre eles {others}.',
  'bi.discovery.refutedSearched':
    'Uma busca depositada em {date} não encontrou nenhum, até cerca de {radius} km de raio.',
  'bi.atmosphere.label': 'Perfil medido (sonda Galileo)',
  'bi.atmosphere.labelNone': 'Perfil medido da atmosfera',
  'bi.atmosphere.altitude': 'Acima de 1 bar',
  'bi.atmosphere.pressure': 'Pressão',
  'bi.atmosphere.temperature': 'Temperatura',
  'bi.atmosphere.local':
    'Um único ponto do globo, latitude {min}° a {max}°, atravessado em {date}. O artigo da equipe o situa na borda de uma mancha quente a 5 µm do cinturão equatorial norte.',
  'bi.atmosphere.adjusted':
    'A partir de {altitude}, a equipe ajustou a adiabática seca aos dados: essas linhas não são pontos medidos.',
  'bi.atmosphere.citation':
    '{authors} ({year}), {title}, NASA Planetary Data System, DOI {doi}. {reference} Lido em {date}.',
  'bi.atmosphere.absent':
    'Nenhum perfil de temperatura e pressão da baixa atmosfera é publicado como dados no Planetary Data System da NASA para este planeta: {count} coleções lidas em {date}, nenhuma o é.',
  'bi.missions.countAtDate': '{count}, sendo {active} nesta data',
  'bi.missions.countAllAtDate': '{count}, todas nesta data',
  'bi.missions.none':
    'Nenhuma missão deste arquivo declara este corpo entre os seus alvos.',
  'bi.missions.span': 'de {from} a {to}',
  'bi.missions.spanUndeclared': 'datas não declaradas',
  'bi.missions.spanEndOnly': 'até {to}, início não declarado',
  'bi.missions.spanOpen': 'desde {from}, fim não declarado',
  'bi.missions.atDate': 'já havia começado na data da cena',
  'bi.missions.note':
    'O que o arquivo do PDS declara para cada missão: o intervalo dos seus dados e os corpos que toma como alvos, lido em {date}. Um alvo declarado não é um registro de observações, e o início é o do projeto, não o lançamento.',
  'bi.instruments.investigations': 'Investigações em que figura',
  'bi.instruments.hostEmpty': '(nenhum instrumento declarado)',
  'bi.instruments.absent':
    'O arquivo do PDS não declara aqui nenhuma investigação, e portanto nenhum instrumento.',
  'bi.instruments.absentNote': 'Lido no arquivo do PDS em {date}.',
  'bi.instruments.note':
    'O que o arquivo do PDS declara que esta sonda leva, lido em {date}. Cada nome é o que o arquivo publica, e o identificador abaixo é a sua citação.',
  'bi.places.count': '{observed} de {total} com nome',
  'bi.places.search': 'Formação com nome',
  'bi.places.hint':
    'Digite o nome de uma formação para ver quais orbitadores a observaram.',
  'bi.places.unknown': 'Nenhuma formação deste corpo tem esse nome.',
  'bi.places.none':
    'Nenhuma pegada publicada pelo Orbital Data Explorer toca esta formação.',
  'bi.places.unavailable':
    'Não foi possível carregar as observações desta formação.',
  'bi.places.observations': 'Observações: {count}, {span}',
  'bi.places.observationsUndated': 'Observações: {count}, datas não publicadas',
  'bi.places.firstLabel': 'Primeira observação (rótulo PDS)',
  'bi.places.announce': '{name}, instrumentos: {count}',
  'bi.places.uncovered':
    'Pegadas de observações só foram encontradas, no Orbital Data Explorer da NASA, para estes corpos: {bodies}. Nenhum serviço público de pegadas foi encontrado para este corpo.',
  'bi.places.note':
    'Pegadas lidas no Orbital Data Explorer da NASA (PDS Geosciences Node), produtos criados até {date}. Um produto cuja pegada também cobre o antípoda da formação, como um mapa global, não é contado.',
};
