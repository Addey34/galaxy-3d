/**
 * `/methodology`, section « La luminosité des surfaces » : la règle de `core/displayAlbedo.ts`
 * et la table que `pnpm textures:albedo` en dérive (`config/displayAlbedo.json`), LUES au build.
 *
 * Aucun nombre ni aucune liste de corps n'est écrit ici : le facteur, les albédos, les gains et
 * les corps hors règle viennent de la table, la raison d'un corps hors règle de son CODE
 * (`DISPLAY_ALBEDO_EXCLUSIONS`), traduit ci-dessous. Une raison nouvelle sans traduction fait
 * échouer le build, au lieu de publier un corps sans explication.
 *
 * Module PUR : données en entrée, HTML en sortie.
 */
import type { CelestialConfig } from '@/types';
import { flattenBodies } from '@/config/catalog';
import {
  DISPLAY_ALBEDO_EXCLUSIONS,
  type DisplayAlbedoExclusionKind,
} from '@/core/displayAlbedo';
import { escapeHtml } from './bodyLandingPage';
import {
  type DocLocale,
  type DocText,
  docSection,
  docTable,
  formatExact,
  formatQuantity,
} from './documentPage';

export interface DisplayAlbedoRow {
  body: string;
  /** `texture`, `baked` ou `excluded` : lu dans un JSON, donc vérifié à l'entrée. */
  rule: string;
  albedo?: number;
  source?: { path: string; url: string };
  gain?: number;
  exclusion?: string;
}

export interface DisplayAlbedoTable {
  luminancePerAlbedo: number;
  rows: readonly DisplayAlbedoRow[];
}

/** Le nom de la source d'un albédo, d'après la section du relevé où il est lu. */
const SOURCE_NAMES: Record<string, string> = {
  nssdca: 'NASA NSSDCA',
  nssdcaSatellites: 'NASA NSSDCA',
  sbdb: 'JPL SBDB',
};

const EXCLUSION_TEXT: Record<DisplayAlbedoExclusionKind, DocText> = {
  notLit: {
    en: 'not a lit surface',
    fr: 'pas une surface éclairée',
    es: 'no es una superficie iluminada',
    'pt-BR': 'não é uma superfície iluminada',
  },
  atmosphere: {
    en: 'an atmosphere, whose published albedo is that of the whole disc, clouds and haze included, not that of the surface the texture shows',
    fr: 'une atmosphère, dont l’albédo publié est celui du disque entier, nuages et brumes compris, pas celui de la surface que montre la texture',
    es: 'una atmósfera, cuyo albedo publicado es el del disco entero, nubes y brumas incluidas, no el de la superficie que muestra la textura',
    'pt-BR':
      'uma atmosfera, cujo albedo publicado é o do disco inteiro, nuvens e névoas incluídas, não o da superfície que a textura mostra',
  },
  twoAlbedos: {
    en: 'the source publishes two albedos, and no single number describes the body',
    fr: 'la source publie deux albédos, et aucun nombre unique ne décrit le corps',
    es: 'la fuente publica dos albedos, y ningún número único describe el cuerpo',
    'pt-BR':
      'a fonte publica dois albedos, e nenhum número único descreve o corpo',
  },
  noAlbedo: {
    en: 'no geometric albedo in the sources Galaxy reads yet, so the body keeps the brightness of its map',
    fr: 'aucun albédo géométrique dans les sources que Galaxy lit encore, donc le corps garde la luminosité de sa carte',
    es: 'ningún albedo geométrico en las fuentes que Galaxy lee todavía, así que el cuerpo conserva el brillo de su mapa',
    'pt-BR':
      'nenhum albedo geométrico nas fontes que a Galaxy lê ainda, então o corpo mantém o brilho do seu mapa',
  },
  noColour: {
    en: 'neither a texture nor a baked colour, so the body is drawn in the plain tint of its record',
    fr: 'ni texture ni couleur cuite, donc le corps est dessiné dans la teinte unie de sa fiche',
    es: 'ni textura ni color horneado, así que el cuerpo se dibuja con el tono uniforme de su ficha',
    'pt-BR':
      'nem textura nem cor gravada, então o corpo é desenhado no tom uniforme da sua ficha',
  },
};

const isExclusion = (kind: unknown): kind is DisplayAlbedoExclusionKind =>
  (DISPLAY_ALBEDO_EXCLUSIONS as readonly unknown[]).includes(kind);

/** Refuse une table que la page ne saurait pas publier en entier. */
export function assertPublishableAlbedoTable(table: DisplayAlbedoTable): void {
  for (const row of table.rows) {
    if (!['texture', 'baked', 'excluded'].includes(row.rule))
      throw new Error(`luminosité : ${row.body}, règle inconnue (${row.rule})`);
    if (row.rule === 'excluded' && !isExclusion(row.exclusion))
      throw new Error(
        `luminosité : ${row.body} hors règle sans code de raison connu (${String(row.exclusion)})`
      );
    if (row.rule !== 'excluded' && row.gain === undefined)
      throw new Error(`luminosité : ${row.body} sans gain`);
    if (row.rule === 'texture' && !row.source)
      throw new Error(`luminosité : ${row.body} sans source d'albédo`);
    if (row.source && !SOURCE_NAMES[row.source.path.split('.')[0]!])
      throw new Error(
        `luminosité : source d'albédo sans nom publiable (${row.source.path})`
      );
  }
}

export function brightnessSection(
  table: DisplayAlbedoTable,
  config: CelestialConfig,
  locale: DocLocale,
  name: (body: string, locale: DocLocale) => string
): string {
  assertPublishableAlbedoTable(table);
  const L = (text: DocText): string => text[locale];
  const bodies = flattenBodies(config);
  const n = (value: number): string => formatQuantity(value, locale);
  const factor = formatExact(table.luminancePerAlbedo, locale);
  const following = table.rows.filter((r) => r.rule !== 'excluded');
  const baked = following.filter((r) => r.rule === 'baked');

  const methodLabel = (r: DisplayAlbedoRow): string =>
    r.rule === 'texture'
      ? L({
          en: 'texture measured',
          fr: 'texture mesurée',
          es: 'textura medida',
          'pt-BR': 'textura medida',
        })
      : L({
          en: 'colour baked into the shape model',
          fr: 'couleur cuite dans le modèle de forme',
          es: 'color horneado en el modelo de forma',
          'pt-BR': 'cor gravada no modelo de forma',
        });
  const sourceCell = (r: DisplayAlbedoRow): string => {
    if (r.source)
      return `<a href="${escapeHtml(r.source.url)}">${escapeHtml(SOURCE_NAMES[r.source.path.split('.')[0]!]!)}</a>`;
    return escapeHtml(bodies.get(r.body)?.model?.albedoSource ?? '');
  };

  const rows = following.map((r) => [
    escapeHtml(name(r.body, locale)),
    methodLabel(r),
    sourceCell(r),
    formatExact(r.albedo!, locale),
    n(r.gain!),
  ]);

  // La voûte étoilée est une ligne de la table, pas un corps qu'un lecteur chercherait ici.
  const excluded = DISPLAY_ALBEDO_EXCLUSIONS.map((kind) => {
    const names = table.rows
      .filter(
        (r) =>
          r.rule === 'excluded' &&
          r.exclusion === kind &&
          bodies.get(r.body)?.kind !== 'skybox'
      )
      .map((r) => escapeHtml(name(r.body, locale)));
    return names.length === 0
      ? ''
      : `<li data-exclusion="${kind}"><strong>${names.join(', ')}</strong>${L({ en: ':', fr: ' :', es: ':', 'pt-BR': ':' })} ${L(EXCLUSION_TEXT[kind])}.</li>`;
  }).join('');

  return docSection(
    'brightness',
    L({
      en: 'Surface brightness',
      fr: 'La luminosité des surfaces',
      es: 'El brillo de las superficies',
      'pt-BR': 'O brilho das superfícies',
    }),
    `<p>${L({
      en: `A surface is shown as bright as its published geometric albedo: the mean linear luminance of the rendered surface, texture times a gain, is ${factor} times that albedo. Without this rule each map would keep the brightness its publisher chose, and a bright icy moon could look darker than a dark one. The gain is applied when rendering, not to the files: no texture is re-encoded, and the brightest highlights are compressed by the tone mapping rather than clipped. The share images of the body pages use the same gain.`,
      fr: `Une surface est affichée aussi claire que son albédo géométrique publié : la luminance linéaire moyenne de la surface rendue, texture multipliée par un gain, vaut ${factor} fois cet albédo. Sans cette règle, chaque carte garderait la luminosité choisie par son éditeur, et une lune de glace très claire pourrait paraître plus sombre qu’une lune sombre. Le gain s’applique au rendu, pas aux fichiers : aucune texture n’est réencodée, et les plus hautes lumières sont comprimées par le mappage des tons plutôt qu’écrêtées. Les vignettes de partage des pages de corps appliquent le même gain.`,
      es: `Una superficie se muestra tan clara como su albedo geométrico publicado: la luminancia lineal media de la superficie renderizada, textura multiplicada por una ganancia, vale ${factor} veces ese albedo. Sin esta regla, cada mapa conservaría el brillo que eligió su editor, y una luna de hielo muy clara podría parecer más oscura que una luna oscura. La ganancia se aplica al renderizar, no a los archivos: ninguna textura se recodifica, y las luces más altas se comprimen con el mapeo de tonos en lugar de recortarse. Las imágenes para compartir de las páginas de cuerpos aplican la misma ganancia.`,
      'pt-BR': `Uma superfície é mostrada tão clara quanto o seu albedo geométrico publicado: a luminância linear média da superfície renderizada, textura multiplicada por um ganho, vale ${factor} vezes esse albedo. Sem essa regra, cada mapa manteria o brilho escolhido pelo seu editor, e uma lua de gelo muito clara poderia parecer mais escura que uma lua escura. O ganho é aplicado na renderização, não nos arquivos: nenhuma textura é recodificada, e as luzes mais altas são comprimidas pelo mapeamento de tons em vez de cortadas. As imagens de compartilhamento das páginas de corpos aplicam o mesmo ganho.`,
    })}</p><p>${L({
      en: `For a textured body the gain is the published albedo times ${factor}, divided by the mean luminance measured on its shipped texture, weighted by area. ${baked.length} bodies drawn from a shape model without a texture carry a colour already baked at their own published albedo, so they share one gain. A check re-measures every shipped texture against this table.`,
      fr: `Pour un corps texturé, le gain est l’albédo publié multiplié par ${factor}, divisé par la luminance moyenne mesurée sur sa texture livrée, pondérée par l’aire. ${baked.length} corps dessinés par un modèle de forme sans texture portent une couleur déjà cuite à leur propre albédo publié, et partagent donc un même gain. Une vérification remesure chaque texture livrée contre cette table.`,
      es: `Para un cuerpo con textura, la ganancia es el albedo publicado multiplicado por ${factor}, dividido por la luminancia media medida en su textura entregada, ponderada por el área. ${baked.length} cuerpos dibujados con un modelo de forma sin textura llevan un color ya horneado a su propio albedo publicado, y comparten por tanto una misma ganancia. Una comprobación vuelve a medir cada textura entregada contra esta tabla.`,
      'pt-BR': `Para um corpo com textura, o ganho é o albedo publicado multiplicado por ${factor}, dividido pela luminância média medida na sua textura entregue, ponderada pela área. ${baked.length} corpos desenhados por um modelo de forma sem textura carregam uma cor já gravada no seu próprio albedo publicado, e compartilham portanto um mesmo ganho. Uma verificação mede de novo cada textura entregue contra esta tabela.`,
    })}</p>${docTable(
      L({
        en: 'Bodies that follow the rule',
        fr: 'Corps qui suivent la règle',
        es: 'Cuerpos que siguen la regla',
        'pt-BR': 'Corpos que seguem a regra',
      }),
      [
        L({ en: 'Body', fr: 'Corps', es: 'Cuerpo', 'pt-BR': 'Corpo' }),
        L({ en: 'Method', fr: 'Méthode', es: 'Método', 'pt-BR': 'Método' }),
        L({
          en: 'Albedo source',
          fr: 'Source de l’albédo',
          es: 'Fuente del albedo',
          'pt-BR': 'Fonte do albedo',
        }),
        L({
          en: 'Geometric albedo',
          fr: 'Albédo géométrique',
          es: 'Albedo geométrico',
          'pt-BR': 'Albedo geométrico',
        }),
        L({ en: 'Gain', fr: 'Gain', es: 'Ganancia', 'pt-BR': 'Ganho' }),
      ],
      rows,
      3
    )}<p>${L({
      en: 'The other bodies are not adjusted, for the reason written next to them:',
      fr: 'Les autres corps ne sont pas ajustés, pour la raison écrite à côté d’eux :',
      es: 'Los demás cuerpos no se ajustan, por la razón escrita a su lado:',
      'pt-BR':
        'Os outros corpos não são ajustados, pela razão escrita ao lado deles:',
    })}</p><ul class="doc-list">${excluded}</ul>`
  );
}
