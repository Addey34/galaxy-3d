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
  'search.group.perihelion': 'Periélios',
  'search.group.perijove': 'Perijoves',
  'deep.card.designation': 'Designação',
  'deep.card.messier': 'Messier',
  'deep.card.constellation': 'Constelação',
  'deep.card.ra': 'Ascensão reta (J2000)',
  'deep.card.dec': 'Declinação (J2000)',
  'deep.card.vmag': 'Magnitude visual',
  'deep.card.size': 'Tamanho aparente',
  'deep.card.unknown': 'não publicado',
  'deep.card.source':
    'OpenNGC, lido em {date}, licença {license}. Só a direção do objeto é colocada no céu: o catálogo não dá nenhuma distância utilizável, então nenhuma é desenhada nem exibida.',
  'deep.card.opened': 'Objeto do céu profundo {name}',
  'deep.unit.arcmin': '{v} minutos de arco',
  'deep.search.label': 'Procurar um objeto do céu profundo',
  'deep.search.placeholder': 'M 31, NGC 224, Andrômeda',
  'deep.type.G': 'Galáxia',
  'deep.type.OCl': 'Aglomerado aberto',
  'deep.type.ClN': 'Aglomerado com nebulosidade',
  'deep.type.GCl': 'Aglomerado globular',
  'deep.type.Neb': 'Nebulosa',
  'deep.type.HII': 'Região H II',
  'deep.type.PN': 'Nebulosa planetária',
  'deep.type.RfN': 'Nebulosa de reflexão',
  'deep.type.SNR': 'Remanescente de supernova',
  'nb.card.kind': 'Estrela próxima do Sol',
  'nb.card.members': 'Estrelas deste sistema',
  'nb.card.distance': 'Distância do Sol',
  'nb.card.distanceValue': '{ly} anos-luz',
  'nb.card.distanceError': '{ly} ± {err} anos-luz',
  'nb.card.au': 'Em unidades astronômicas',
  'nb.card.auValue': '{au} UA',
  'nb.card.scale': 'Se a Terra estivesse a 1 cm do Sol',
  'nb.card.scaleValue': 'a {km} km',
  'nb.card.light': 'Sua luz leva',
  'nb.card.lightValue': '{years} anos para chegar até nós',
  'nb.card.motion': 'Movimento próprio',
  'nb.card.motionValue': '{v} segundos de arco por ano',
  'nb.card.rv': 'Velocidade radial',
  'nb.card.rvApproaching': '{v} km/s, aproximando-se',
  'nb.card.rvReceding': '{v} km/s, afastando-se',
  'nb.card.spectral': 'Tipo espectral',
  'nb.card.vmag': 'Magnitude visual',
  'nb.card.unknown': 'não publicada',
  'nb.card.origin.gaia': 'Distância e movimento: Gaia DR3, fonte {id}.',
  'nb.card.origin.hyg':
    'Distância e movimento: HYG v4.4 (Hipparcos e Gliese); nenhuma incerteza é publicada.',
  'nb.card.hint':
    'O marcador mostra a direção real da estrela. A estrela não é desenhada à sua distância: a cena termina no Sistema Solar.',
  'nb.card.source':
    'Fontes: Gaia DR3 (ESA) e HYG v4.4 ({license}). As posições são as de J2000,0; o marcador acompanha o movimento próprio até a data da cena.',
  'nb.card.opened': 'Estrela próxima {name}',
  'nb.unit.ly': 'a.l.',
  'nb.search.label': 'Encontrar uma estrela próxima',
  'nb.search.placeholder': 'Próxima, Sirius, Barnard',
  'st.title': 'Vizinhança solar em 3D',
  'st.back': 'Voltar ao Sistema Solar',
  'st.reset': 'Recentralizar a vista',
  'st.open': 'Ver na vizinhança solar',
  'st.scale':
    '1 unidade = 1 parsec = 3,26 anos-luz. Um círculo por parsec ao redor do Sol, no plano galáctico.',
  'st.ring': '{pc} pc · {ly} a.l.',
  'st.sun': 'Sol',
  'st.centre': 'Centro galáctico (direção)',
  'st.symbolic':
    'Os pontos são símbolos de tamanho constante: o tamanho real de uma estrela não é desenhado. A cor segue o tipo espectral.',
  'st.frame':
    'Referencial galáctico: x em direção ao centro galáctico, z em direção ao polo norte galáctico. As posições são as da data da cena, deslocadas em linha reta a partir dos valores do catálogo em J2000.',
  'st.help':
    'Arraste para girar, roda ou pinça para aproximar, botão direito ou dois dedos para mover. Teclado: as setas giram, mais e menos aproximam, Home recentraliza, Esc volta.',
  'st.list': 'Estrelas da vizinhança',
  'st.listItem': '{name}, {ly} anos-luz',
  'st.selected': 'Estrela escolhida',
  'st.noSelection': 'Escolha uma estrela para ver sua distância e sua posição.',
  'st.distSun': 'Distância do Sol (publicada)',
  'st.distAtDate': 'Distância do Sol nesta data',
  'st.position': 'Posição (x, y, z)',
  'st.positionValue': '{x} ; {y} ; {z} pc',
  'st.timeLabel': 'Anos a partir da data da cena',
  'st.timeNow': 'A data da cena',
  'st.timeValue': '{years} anos, ano {year}',
  'st.timeLimit':
    'Movimento retilíneo, limitado a 10 000 anos de cada lado de J2000: além disso a aproximação não é defensável.',
  'st.noRadial':
    'Nenhuma velocidade radial é publicada para esta estrela: sua aproximação ou afastamento do Sol não é considerado.',
  'st.opened':
    'Vizinhança solar em 3D. {n} sistemas de estrelas ao redor do Sol.',
  'st.closed': 'De volta ao Sistema Solar.',
  'st.selectedAnnounce': '{name}, a {ly} anos-luz do Sol.',
  'st.unavailable':
    'A vista 3D não está disponível: o contexto gráfico não responde.',
  'st.unknownStar':
    'O link indica uma estrela que não está entre as estrelas próximas. A vista abre sem estrela selecionada.',
  'st.dataUnavailable':
    'A vista 3D não está disponível: não foi possível ler o arquivo das estrelas próximas.',
  'st.fieldAu': 'Largura do campo na altura do Sol: {au} UA',
  'st.fieldLy': 'Largura do campo na altura do Sol: {ly} al ({pc} pc)',
  'st.ringAu': '{au} UA',
  'st.stageAu':
    'No Sistema Solar: a unidade é a unidade astronômica (UA), a distância média Terra-Sol, {km} milhões de km. Círculos laranja: 1, 10, 100… UA, no plano dos planetas.',
  'st.stageLy':
    'Entre as estrelas: a unidade é o ano-luz (1 parsec = {ly} anos-luz = {au} UA). Círculos azuis: um por parsec, no plano galáctico.',
  'st.stageNote':
    'Uma mudança de escala, não uma viagem: o Sol fica no centro e só o campo se alarga, em um único referencial galáctico. Nenhuma velocidade é suposta.',
  'st.skip': 'Pular a transição',
  'sv.visit.start': 'Visita guiada',
  'sv.visit.region': 'Visita guiada das vizinhas do Sol',
  'sv.visit.progress': 'Parada {n} de {total}',
  'sv.visit.prev': 'Parada anterior',
  'sv.visit.next': 'Próxima parada',
  'sv.visit.finish': 'Encerrar a visita',
  'sv.visit.leave': 'Sair da visita e explorar livremente',
  'sv.visit.resume': 'Retomar a visita (parada {n} de {total})',
  'sv.visit.end': 'Encerrar a visita',
  'sv.visit.paused':
    'A visita está em pausa. As estrelas, o controle de tempo e a câmera são seus.',
  'sv.visit.data': 'Esta estrela nos dados',
  'sv.visit.fact.pm': 'Movimento próprio',
  'sv.visit.fact.pmValue': '{pm} mas/ano',
  'sv.visit.fact.rv': 'Velocidade radial',
  'sv.visit.fact.rvValue': '{rv} km/s',
  'sv.visit.fact.planets': 'Planetas listados pelo arquivo',
  'sv.visit.fact.none': 'nenhum',
  'sv.visit.reading': 'Como ler esta parada',
  'sv.visit.reading.measured':
    'Medido: a posição, o movimento próprio, a velocidade radial e o tipo espectral (Gaia DR3, ou HYG onde o Gaia não é seguro).',
  'sv.visit.reading.catalogued':
    'Catalogado: os planetas do NASA Exoplanet Archive (instantâneo de {date}), com o status que o arquivo lhes dá.',
  'sv.visit.reading.calculated':
    'Calculado: a posição em outro ano, a partir de um movimento retilíneo. Não é uma medição.',
  'sv.visit.reading.illustrative':
    'Ilustrativo: os pontos são símbolos. Nenhum planeta, textura ou superfície é desenhado.',
  'sv.visit.reading.unknown':
    'Desconhecido aqui: o raio, a massa e a idade destas estrelas não estão nos dados desta vista.',
  'sv.visit.approaching': 'está se aproximando do Sol',
  'sv.visit.receding': 'está se afastando do Sol',
  'sv.visit.unknown': 'Essa visita guiada não existe: a vista abre sem ela.',
  'sv.visit.opened': 'Visita guiada iniciada. Parada {n} de {total}: {title}.',
  'sv.visit.stop': 'Parada {n} de {total}: {title}.',
  'sv.visit.left': 'Visita em pausa. Você pode explorar livremente.',
  'sv.visit.finished': 'Visita encerrada. Você pode continuar explorando.',
  'sv.visit.noArchive':
    'Não foi possível ler o arquivo de exoplanetas: o número de planetas não é exibido.',
  'sv.visit.archive.none':
    'O NASA Exoplanet Archive não lista nenhum planeta para esta estrela.',
  'sv.visit.archive.one':
    'O NASA Exoplanet Archive lista {n} planeta para esta estrela, com o status que o arquivo lhe dá.',
  'sv.visit.archive.many':
    'O NASA Exoplanet Archive lista {n} planetas para esta estrela, com o status que o arquivo lhes dá.',
  'sv.visit.archive.loading':
    'O número de planetas do NASA Exoplanet Archive ainda está sendo carregado.',
  'sv.visit.archive.unavailable':
    'Não foi possível ler o NASA Exoplanet Archive: nenhum número de planetas é dado aqui, e um número ausente não significa zero planetas.',
  'st.transitionStart':
    'Mudança de escala: do Sistema Solar, em unidades astronômicas, para a vizinhança, em anos-luz.',
  'exo.card.unknown': 'não publicado',
  'exo.card.period': 'Período orbital',
  'exo.card.radius': 'Raio',
  'exo.card.axis': 'Semieixo maior',
  'exo.card.year': 'Descoberta',
  'exo.card.method': 'Método',
  'exo.card.planets.one': '{count} planeta conhecido',
  'exo.card.planets.other': '{count} planetas conhecidos',
  'exo.card.distance': 'a {ly} anos-luz',
  'exo.card.distanceUnknown': 'Distância não publicada',
  'exo.card.source':
    'NASA Exoplanet Archive, lido em {date}. Os planetas não são desenhados: só a estrela hospedeira é posicionada no céu. Para um planeta encontrado por velocidade radial, o raio costuma ser calculado pelo arquivo a partir da massa, não medido.',
  'exo.card.opened': 'Sistema {name}, {count} planetas conhecidos',
  'exo.unit.days': '{v} dias',
  'exo.unit.earthRadii': '{v} raios terrestres',
  'exo.unit.au': '{v} UA',
  'exo.search.label': 'Procurar um sistema planetário',
  'exo.search.placeholder': 'Nome da estrela hospedeira',
  'exo.method.transit': 'Trânsito',
  'exo.method.radialVelocity': 'Velocidade radial',
  'exo.method.imaging': 'Imagem direta',
  'exo.method.microlensing': 'Microlente',
  'exo.method.transitTiming': 'Variações dos tempos de trânsito',
  'exo.method.eclipseTiming': 'Variações dos tempos de eclipse',
  'exo.method.orbitalBrightness': 'Modulação orbital do brilho',
  'exo.method.pulsarTiming': 'Cronometragem de pulsar',
  'exo.method.pulsationTiming': 'Variações dos tempos de pulsação',
  'exo.method.astrometry': 'Astrometria',
  'exo.method.diskKinematics': 'Cinemática do disco',
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
    'Uma busca depositada em {date} não encontrou nenhum, até cerca de {radius} de raio.',
  'bi.atmosphere.label': 'Perfil medido (sonda Galileo)',
  'bi.atmosphere.labelNone': 'Perfil medido da atmosfera',
  'bi.atmosphere.labelTitan': 'Perfil medido (sonda Huygens)',
  'bi.atmosphere.altitudeSurface': 'Acima do solo',
  'bi.atmosphere.ground': 'Solo',
  'bi.atmosphere.localTitan':
    'Um único lugar de Titã, latitude {min}° a {max}°, atravessado em {date} na descida. A última linha é a primeira leitura ao nível do solo; as leituras seguintes vão de {low} a {high} K.',
  'bi.atmosphere.site': 'Latitude lida em: {title}, DOI {doi}.',
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
  'place.marker.hint':
    'Vista voltada para este lugar. Aproxime-se para ver os nomes da superfície.',
  'place.marker.announce':
    '{place}, {body}: a vista está voltada para este lugar. Aproxime-se para ver os nomes da superfície.',
  'bi.places.count':
    '{observed} observadas de {evaluated} avaliadas no conjunto ODE publicado.',
  'bi.places.countNamed': '{named} com nome no catálogo da UAI.',
  'bi.places.search': 'Formação com nome',
  'bi.places.hint':
    'Digite o nome de uma formação para ver quais orbitadores a observaram.',
  'bi.places.unknown': 'Nenhuma formação deste corpo tem esse nome.',
  'bi.places.none':
    'Nenhuma pegada publicada pelo Orbital Data Explorer toca esta formação.',
  'bi.places.notEvaluated':
    'Esta formação não foi avaliada no conjunto de dados ODE atualmente publicado.',
  'bi.places.unavailable':
    'Não foi possível carregar as observações desta formação.',
  'bi.places.observations': 'Observações: {count}, {span}',
  'bi.places.observationsUndated': 'Observações: {count}, datas não publicadas',
  'bi.places.firstLabel': 'Primeira observação (rótulo PDS)',
  'bi.places.announce': '{name}, instrumentos: {count}',
  'bi.places.uncovered':
    'Pegadas de observações só foram encontradas, no Orbital Data Explorer da NASA, para estes corpos: {bodies}. Nenhum serviço público de pegadas foi encontrado para este corpo.',
  'bi.cities.label': 'Cidades em 3D',
  'bi.cities.hint':
    'Cidades cujos edifícios são desenhados em 3D quando você se aproxima. Escolha uma para mergulhar nela.',
  'bi.cities.go': 'Mergulhar em {city}',
  'bi.cities.diving': 'Mergulhando em {city}',
  'bi.cities.name.lyon-bdtopo': 'Lyon',
  'bi.cities.name.marseille-bdtopo': 'Marselha',
  'bi.cities.name.toulouse-bdtopo': 'Toulouse',
  'bi.cities.name.nice-bdtopo': 'Nice',
  'bi.cities.name.bordeaux-bdtopo': 'Bordéus',
  'bi.cities.name.lille-bdtopo': 'Lille',
  'bi.cities.name.nantes-bdtopo': 'Nantes',
  'bi.cities.name.strasbourg-bdtopo': 'Estrasburgo',
  'bi.cities.name.montpellier-bdtopo': 'Montpellier',
  'bi.cities.name.rennes-bdtopo': 'Rennes',
  'bi.cities.name.grenoble-bdtopo': 'Grenoble',
  'bi.cities.name.toulon-bdtopo': 'Toulon',
  'bi.cities.name.dijon-bdtopo': 'Dijon',
  'bi.cities.name.angers-bdtopo': 'Angers',
  'bi.cities.name.reims-bdtopo': 'Reims',
  'bi.cities.name.nimes-bdtopo': 'Nîmes',
  'bi.cities.name.saintetienne-bdtopo': 'Saint-Étienne',
  'bi.cities.name.newyork-opendata': 'Nova York',
  'bi.cities.name.london-overture': 'Londres',
  'bi.cities.name.amsterdam-3dbag': 'Amsterdã',
  'bi.cities.name.rotterdam-3dbag': 'Roterdã',
  'bi.cities.name.denhaag-3dbag': 'Haia',
  'bi.cities.name.utrecht-3dbag': 'Utrecht',
  'bi.cities.name.eindhoven-3dbag': 'Eindhoven',
  'bi.cities.name.chicago-overture': 'Chicago',
  'bi.cities.name.singapore-overture': 'Singapura',
  'bi.cities.name.sydney-overture': 'Sydney',
  'bi.cities.name.paris-bdtopo': 'Paris',
  'bi.cities.name.berlin-lod2': 'Berlim',
  'bi.cities.name.nairobi-overture': 'Nairóbi',
  'bi.places.note':
    'Pegadas lidas no Orbital Data Explorer da NASA (PDS Geosciences Node), produtos criados até {date}. Um produto cuja pegada também cobre o antípoda da formação, como um mapa global, não é contado.',
  'inspect.title': 'O tempo em um ponto',
  'inspect.hint.pick':
    'Clique ou toque no globo, ou digite coordenadas, para ler as camadas ativas.',
  'inspect.hint.noLayers':
    'Nenhuma camada inspecionável está ativa. Ative uma camada de modelo (temperatura, pressão, umidade, chuva, nuvens ou vento) no painel meteorológico. O inspetor nunca ativa uma por você.',
  'inspect.hint.images':
    'As camadas de satélite e do NASA GIBS são imagens: não são lidas aqui.',
  'inspect.lat': 'Latitude',
  'inspect.lon': 'Longitude',
  'inspect.go': 'Ler este ponto',
  'inspect.center': 'Usar o centro da vista',
  'inspect.offGlobe': 'O centro da vista não está sobre o globo.',
  'inspect.badCoords':
    'Digite uma latitude de −90 a 90 e uma longitude de −180 a 180.',
  'inspect.details': 'Fonte e data',
  'inspect.expand': 'Mostrar o cartão completo',
  'inspect.collapse': 'Mostrar menos',
  'inspect.about': 'Sobre estes valores',
  'inspect.summary': 'Leituras neste ponto',
  'inspect.caveat':
    'Os valores são interpolados de uma grade de modelo. Não são uma medição neste ponto exato.',
  'inspect.selected': 'Ponto escolhido: {lat}, {lon}.',
  'inspect.var.temperature': 'Temperatura (2 m)',
  'inspect.var.pressure': 'Pressão ao nível do mar',
  'inspect.var.humidity': 'Umidade relativa',
  'inspect.var.precipitation': 'Precipitação',
  'inspect.var.cloudCover': 'Cobertura de nuvens (modelo)',
  'inspect.var.wind': 'Vento (10 m)',
  'inspect.msg.missing': 'O modelo não tem valor neste ponto.',
  'inspect.msg.outOfCoverage': 'Fora da cobertura da grade.',
  'inspect.msg.stale':
    'Desatualizado: a grade carregada é de outra hora, então nenhum valor é mostrado.',
  'inspect.msg.staleError':
    'A atualização falhou. A grade carregada é de outra hora, então nenhum valor é mostrado.',
  'inspect.msg.updating': 'Atualizando para a nova data…',
  'inspect.msg.outOfRange': 'Esta data está fora do alcance do modelo.',
  'inspect.msg.error': 'Não foi possível carregar os dados.',
  'inspect.msg.loading': 'Carregando…',
  'inspect.wind.calm': 'Calmaria: sem direção significativa',
  'inspect.wind.from': 'Origem: {dir} · {deg}°',
  'inspect.dir.N': 'N',
  'inspect.dir.NE': 'NE',
  'inspect.dir.E': 'L',
  'inspect.dir.SE': 'SE',
  'inspect.dir.S': 'S',
  'inspect.dir.SW': 'SO',
  'inspect.dir.W': 'O',
  'inspect.dir.NW': 'NO',
  'inspect.precip.rate': 'Taxa instantânea (GFS)',
  'inspect.precip.accumulation': 'Acumulada na hora anterior',
  'inspect.precip.none': 'Sem precipitação',
  'inspect.meta.source': 'Fonte',
  'inspect.meta.nature': 'Natureza',
  'inspect.meta.effective': 'Válido para',
  'inspect.meta.requested': 'Hora pedida',
  'inspect.meta.offset': '{h} h em relação à hora pedida',
  'inspect.meta.grid': 'Grade',
  'inspect.meta.gridValue': 'grade de {step}°, interpolada',
  'craft.button': 'Inspecionar em 3D',
  'craft.issButton': 'Inspecionar a ISS em 3D',
  'craft.noModel':
    'Não há aqui um modelo 3D confiável desta sonda: nada é desenhado em vez de uma forma inventada.',
  'craft.title': '{name}: inspeção em 3D',
  'craft.close': 'Fechar a inspeção',
  'craft.reset': 'Redefinir a vista',
  'craft.loading': 'Carregando o modelo 3D…',
  'craft.failed':
    'Não foi possível carregar o modelo 3D. A cena não foi alterada.',
  'craft.unavailable':
    'A inspeção em 3D não está disponível: o contexto gráfico não responde.',
  'craft.help':
    'Arraste ou use as setas para girar o modelo. Roda, pinça ou teclas + e - para ampliar. Home redefine a vista, Escape a fecha.',
  'craft.scale':
    'Escala de apresentação: aqui a nave é mostrada ampliada para poder ser inspecionada. Na cena astronômica ela nunca é ampliada.',
  'craft.fidelity':
    'Modelo representativo da coleção 3D Resources da NASA. Suas proporções e detalhes são os do arquivo: este projeto não os conferiu com desenhos de engenharia.',
  'craft.rights':
    'A NASA indica que o conteúdo usado para renderizar modelos 3D geralmente não está sujeito a direitos autorais nos Estados Unidos (NASA Images and Media Usage Guidelines, lido em 2026-11-23). Nenhum apoio da NASA é sugerido.',
  'craft.parts': 'Peças nomeadas no arquivo',
  'craft.partsNone':
    'Este modelo é um único bloco: seu arquivo não nomeia peças separadas.',
  'craft.instruments': 'Instrumentos declarados no arquivo do PDS',
  'craft.instrumentsNote':
    'A lista vem do registro de contexto do PDS, não do modelo 3D: o modelo não diz onde fica cada instrumento.',
  'craft.provenance': 'Procedência',
  'craft.source': 'Arquivo de origem',
  'craft.credit': 'Crédito: {credit}',
  'craft.file': '{kb} KB, {tris} triângulos, SHA-256 {hash}…',
  'craft.opened': 'Inspecionando {name} em 3D.',
  'craft.closed': 'De volta à vista anterior.',
  'craft.partOn': '{part} destacada.',
  'craft.partOff': 'Destaque removido.',
  'sat.kind': 'Objeto em órbita',
  'sat.group.stations': 'Grupo: estações espaciais',
  'sat.group.visual': 'Grupo: objetos mais brilhantes',
  'sat.unknown': 'não publicado',
  'sat.norad': 'Número de catálogo NORAD',
  'sat.designator': 'Designação internacional (COSPAR)',
  'sat.period': 'Período orbital',
  'sat.minutes': '{n} min',
  'sat.altitudes': 'Altitude, do perigeu ao apogeu',
  'sat.altitudesValue': '{perigee} a {apogee} km',
  'sat.inclination': 'Inclinação',
  'sat.eccentricity': 'Excentricidade',
  'sat.epoch': 'Época dos elementos',
  'sat.validity': 'Elementos válidos',
  'sat.validityValue': 'de {from} a {to}',
  'sat.altitude': 'Altitude agora (SGP4)',
  'sat.km': '{n} km',
  'sat.speed': 'Velocidade agora (SGP4)',
  'sat.kmPerS': '{n} km/s',
  'sat.over': 'Sobre (SGP4)',
  'sat.outside':
    'Na data da cena estes elementos estão fora da validade: o objeto não é desenhado em vez de ser desenhado no lugar errado.',
  'sat.model.iss':
    'A ISS tem um modelo 3D (NASA 3D Resources). Só é ampliada na inspeção; no espaço continua sendo um ponto.',
  'sat.model.none':
    'Não há modelo 3D deste objeto: continua sendo um ponto em vez de uma forma inventada.',
  'sat.source':
    'Elementos do CelesTrak (18th Space Defense Squadron), lidos em {date} UTC pelo serviço de dados do Galaxy e propagados com SGP4. O erro cresce alguns quilômetros por dia em torno da época. Altitude, velocidade e posição são calculadas, não medidas.',
  'sat.opened': '{name}: ficha do satélite aberta.',
  'sat.search.label': 'Encontrar um satélite',
  'sat.search.placeholder': 'Digite um nome, por exemplo ISS',
  'sat.follow': 'Seguir este objeto',
  'sat.unfollow': 'Parar de seguir',
  'sat.following':
    '{name}: a câmera segue o objeto. Gire, aproxime ou pare de seguir a qualquer momento.',
  'sat.followChip': 'Seguindo {name}',
  'sat.followEnded': '{name}: acompanhamento encerrado.',
  'sat.followEndedOutside':
    '{name}: acompanhamento encerrado, os elementos não são válidos nesta data.',
  'sat.followEndedNoSolution':
    '{name}: acompanhamento encerrado, o SGP4 não tem posição para esta data.',
  'sat.path':
    'Traçado da órbita: um período à frente da data da cena, calculado pelo SGP4 a partir dos elementos. Não é uma medição, e nenhum traçado do passado é desenhado. As setas mostram o sentido do movimento.',
  'sat.pathTruncated':
    'O traçado termina onde os elementos deixam de ser válidos.',
  'sx.open': 'Explorar este sistema',
  'sx.unavailable': 'Não foi possível carregar a exploração do sistema.',
  'sx.title': 'O sistema {name}',
  'sx.back': 'Voltar à vizinhança',
  'sx.reset': 'Sistema inteiro',
  'sx.compare': 'Comparar com o Sistema Solar',
  'sx.scale':
    'Uma unidade é uma unidade astronômica (a distância Terra-Sol). As órbitas são desenhadas de frente.',
  'sx.field': 'Campo de visão: {au} UA de largura',
  'sx.help':
    'Arraste para girar, role ou faça pinça para aproximar, toque numa estrela ou numa órbita. Teclado: setas para girar, + e - para aproximar, Home para o sistema inteiro, Esc para voltar à vizinhança. A lista dá o mesmo acesso.',
  'sx.list': 'Neste sistema',
  'sx.listStar': '{name} (estrela)',
  'sx.listPlanet': '{name} (planeta)',
  'sx.listPlanetNoOrbit': '{name} (planeta, órbita não desenhada)',
  'sx.opened':
    'Sistema {name} aberto: {stars} estrelas no catálogo, {planets} planetas catalogados.',
  'sx.selected': '{name} selecionado',
  'sx.closed': 'De volta à vizinhança solar.',
  'sx.archiveUnavailable':
    'Não foi possível ler o arquivo de planetas: apenas as estrelas são mostradas.',
  'sx.doc.noPlanets':
    'Nenhuma órbita a desenhar: o arquivo não lista nenhum planeta para este sistema (instantâneo de {date}). Isso não significa que ele não tenha.',
  'sx.doc.noAxis':
    'Nenhuma órbita a desenhar: seus planetas não têm semieixo maior nem massa estelar para derivá-lo. Seus dados estão na lista.',
  'sx.missingHosts':
    'Reconhecidos na camada do céu mas ausentes do instantâneo detalhado: {hosts}.',
  'sx.star.separation': 'Separação projetada de {name}',
  'sx.star.separationValue':
    '{au} UA (derivada das posições do catálogo: um mínimo, a distância ao longo da linha de visada é desconhecida)',
  'sx.star.teff': 'Temperatura efetiva',
  'sx.star.radius': 'Raio',
  'sx.star.mass': 'Massa',
  'sx.star.noHost': 'Nenhum planeta do arquivo é atribuído a esta estrela.',
  'sx.star.hostOf':
    'NASA Exoplanet Archive: hospedeira "{host}", {count} planetas catalogados desenhados ou listados aqui.',
  'sx.star.trueSize':
    'A estrela é desenhada com seu raio publicado; seu ponto mantém um tamanho constante na tela para encontrá-la de longe.',
  'sx.star.archiveStars':
    'O arquivo conta {n} estrelas neste sistema; o catálogo da vizinhança agrupa {m} aqui (uma companheira a mais de um minuto de arco tem seu próprio marcador).',
  'sx.planet.star': 'Estrela hospedeira',
  'sx.planet.eccentricity': 'Excentricidade',
  'sx.planet.eccZero': '0 (publicada; muitas vezes fixada em zero pelo ajuste)',
  'sx.planet.eccUnknown':
    'não publicada: a órbita é um círculo tracejado no semieixo maior',
  'sx.planet.range': 'Distância à estrela',
  'sx.planet.rangeValue': 'de {q} a {Q} UA',
  'sx.planet.inclination': 'Inclinação',
  'sx.planet.mass': 'Massa',
  'sx.planet.noOrbit':
    'Nem semieixo maior nem massa estelar para derivá-lo: a órbita não é desenhada.',
  'sx.planet.position':
    'Não se sabe onde o planeta está na órbita: seu nome marca a órbita, não o planeta.',
  'sx.planet.radiusCalculated':
    'Seu raio não foi medido: o arquivo o calcula a partir da massa.',
  'sx.planet.controversial': 'O arquivo marca este planeta como controverso.',
  'sx.planet.circumbinary':
    'O arquivo o classifica como circumbinário (em órbita de duas estrelas).',
  'sx.tag.calculated': 'valor calculado pelo arquivo',
  'sx.tag.derived': 'valor derivado aqui, terceira lei de Kepler',
  'sx.tag.minimum': 'massa mínima, m sin i',
  'sx.tag.trueMass': 'massa',
  'sx.unit.kelvin': '{v} K',
  'sx.unit.solarRadii': '{v} raios solares',
  'sx.unit.solarMasses': '{v} massas solares',
  'sx.unit.earthMasses': '{v} massas terrestres',
  'sx.unit.degrees': '{v}°',
  'sx.table.title': 'Comparar os planetas',
  'sx.table.planet': 'Planeta',
  'sx.table.caption':
    'Período em dias, semieixo maior em UA, massa em massas terrestres, raio em raios terrestres. † calculado pelo arquivo; ‡ derivado aqui (terceira lei de Kepler); ≥ massa mínima (m sin i); um traço: não publicado.',
  'sx.compare.note':
    'Círculos cinza tracejados: as órbitas dos planetas do Sistema Solar na mesma escala (semieixos maiores, NSSDCA), centradas em {name}.',
  'sx.compare.ring': '{name} (Sistema Solar)',
  'sx.read.title': 'Como ler esta vista',
  'sx.read.measured':
    'Medido: a posição, a distância e o movimento das estrelas (Gaia DR3 ou HYG), e a separação projetada entre duas estrelas do sistema.',
  'sx.read.catalogued':
    'Catalogado: os planetas e suas órbitas, do NASA Exoplanet Archive (instantâneo de {date}). Cada valor diz quando o arquivo o calculou em vez de tirá-lo de uma publicação.',
  'sx.read.derived':
    'Derivado aqui: um semieixo maior calculado a partir do período e da massa estelar (terceira lei de Kepler), indicado como tal.',
  'sx.read.illustrative':
    'Ilustrativo: as órbitas são desenhadas de frente porque sua orientação no céu não é publicada (o nó nunca, a inclinação raramente); uma faixa vai da menor à maior distância à estrela; um círculo tracejado indica uma excentricidade não publicada; as cores só distinguem as órbitas.',
  'sx.read.unknown':
    'Desconhecido: onde cada planeta está na órbita, a inclinação das órbitas, a distância entre as estrelas ao longo da linha de visada. Nada é desenhado para isso.',
  'sx.sources':
    'Estrelas: catálogo da vizinhança (Gaia DR3 ou HYG). Planetas e estrela hospedeira: NASA Exoplanet Archive, tabela pscomppars, instantâneo de {date}.',
  'sx.sourcesStars': 'Estrelas: catálogo da vizinhança (Gaia DR3 ou HYG).',
  'sx.star.spectral': 'Tipo espectral (catálogo da vizinhança)',
  'sx.star.spectralArchive': 'Tipo espectral (arquivo)',
  'sx.backSky': 'Voltar ao céu',
  'sx.closedSky': 'De volta ao céu.',
  'sx.unknownHost':
    'Este sistema planetário não está no catálogo do céu: a exploração não abre.',
  'sx.star.distanceArchive': 'Distância ao Sol (arquivo)',
  'sx.star.originArchive':
    'Estrela conhecida só pelo NASA Exoplanet Archive (não está no catálogo da vizinhança): suas outras estrelas, se houver, não são posicionadas, pois o arquivo dá o número delas, não as posições.',
  'sx.star.circumbinary':
    'Pelo menos um planeta gira aqui em torno de um PAR de estrelas (circumbinário no arquivo): sua órbita é desenhada em torno do centro do sistema, e nenhuma estrela isolada é desenhada ali, pois as posições das duas estrelas não estão nos dados.',
  'sx.star.archiveStarsSky': 'O arquivo conta {n} estrelas neste sistema.',
  'sx.helpSky':
    'Arraste para girar, role ou faça pinça para aproximar, toque numa estrela ou numa órbita. Teclado: setas para girar, + e - para aproximar, Home para o sistema inteiro, Esc para voltar ao céu. A lista dá o mesmo acesso.',
  'sx.read.measuredSky':
    'Publicado: a distância do sistema e os parâmetros de sua estrela hospedeira, como o arquivo os dá.',
  'sx.sourcesSky':
    'Estrela e planetas: NASA Exoplanet Archive, tabela pscomppars, instantâneo de {date}.',
};
