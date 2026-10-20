/**
 * LES FICHES D'ACTIVITÉ IMPRIMABLES (lot 58) : `/activities/` et une page par activité,
 * `/activities/seasons/`, dans les quatre langues. Module PUR : le plugin de `vite.config.ts` lui
 * passe le registre et le catalogue.
 *
 * La page suit l'ordre des fiches « teach with space » de l'ESA (lu à la source, cf.
 * `registry/schema/activity.ts`) : en bref, objectifs, guide de l'enseignant AVEC le corrigé,
 * puis la fiche élève, qui commence sur une nouvelle feuille à l'impression (`docs.css`). Chaque
 * nombre du corrigé est rempli par `core/activityValues.ts`, jamais écrit ici.
 *
 * Le lien vers la scène est la page de la Terre dans la langue de la fiche, avec `?tour=` : la
 * scène démarre dans cette langue (lot 56) et lance la visite (lot 58). Il est aussi IMPRIMÉ en
 * clair dans la fiche élève, parce qu'un lien ne se clique pas sur du papier.
 */
import type { CelestialConfig } from '@/types';
import type { Locale } from '@/i18n/locales';
import type { ActivityRecord } from '@/registry/schema/activity';
import type { TourScript } from '@/core/tourEngine';
import {
  evaluateActivityValues,
  fillSlots,
  type EvaluatedValue,
} from '@/core/activityValues';
import {
  catalogueFactProvenance,
  catalogueEditionReader,
  catalogueFactReader,
  editionTileset,
} from '@/config/activityFacts';
import { factSource } from '@/config/factSources';
import { flattenBodies } from '@/config/catalog';
import { bodyPagePath, escapeHtml, trimForMeta } from './bodyLandingPage';
import {
  ACTIVITIES_SLUG,
  docPath,
  docSection,
  type DocPage,
  type DocText,
} from './documentPage';
import { longDay } from './instrumentLandingPage';

/**
 * La source du FORMAT, lue le 2026-10-18 (journal du lot 58). Une constante et non une fiche de
 * fournisseur : elle ne fonde aucun fait affiché, elle dit d'où vient la forme de la page.
 */
const ESA_FORMAT_SOURCE = {
  publisher: 'ESA Education',
  title: 'One year on Earth: Understanding seasons (teach with space, PR45)',
  url: 'https://www.esa.int/Education/Teachers_Corner/One_year_on_Earth_-_Understanding_seasons_Teach_with_space_PR45',
  accessed: '2026-10-18',
} as const;

const TEXT = {
  indexTitle: {
    en: 'Classroom activities',
    fr: 'Activités pour la classe',
    es: 'Actividades para el aula',
    'pt-BR': 'Atividades para a sala de aula',
  },
  indexDescription: {
    en: 'Ready-to-use classroom activities built on Galaxy: teacher guide, answer key and printable pupil sheet.',
    fr: 'Des activités prêtes à l’emploi construites sur Galaxy : guide de l’enseignant, corrigé et fiche élève imprimable.',
    es: 'Actividades listas para usar construidas sobre Galaxy: guía del docente, respuestas y ficha del alumno imprimible.',
    'pt-BR':
      'Atividades prontas para usar construídas sobre o Galaxy: guia do professor, respostas e ficha do aluno para imprimir.',
  },
  indexIntro: {
    en: 'Each activity follows the layout of ESA’s “teach with space” sheets: at a glance, objectives, a teacher guide with the answer key, then a pupil sheet that starts on a new page when printed. Every figure of an answer key is computed by Galaxy or quoted from a sourced fact, and a test holds it.',
    fr: 'Chaque activité suit la présentation des fiches « teach with space » de l’ESA : en bref, objectifs, un guide de l’enseignant avec le corrigé, puis une fiche élève qui commence sur une nouvelle page à l’impression. Chaque nombre d’un corrigé est calculé par Galaxy ou cité d’un fait sourcé, et un test le tient.',
    es: 'Cada actividad sigue la presentación de las fichas «teach with space» de la ESA: en resumen, objetivos, una guía del docente con las respuestas y luego una ficha del alumno que empieza en una página nueva al imprimir. Cada cifra de las respuestas la calcula Galaxy o se cita de un dato con fuente, y una prueba la sostiene.',
    'pt-BR':
      'Cada atividade segue a apresentação das fichas “teach with space” da ESA: resumo, objetivos, um guia do professor com as respostas e depois uma ficha do aluno que começa em uma nova página ao imprimir. Cada número das respostas é calculado pelo Galaxy ou citado de um dado com fonte, e um teste o garante.',
  },
  atAGlance: {
    en: 'At a glance',
    fr: 'En bref',
    es: 'En resumen',
    'pt-BR': 'Resumo',
  },
  subjects: {
    en: 'Subjects',
    fr: 'Matières',
    es: 'Materias',
    'pt-BR': 'Disciplinas',
  },
  ages: {
    en: 'Age range',
    fr: 'Tranche d’âge',
    es: 'Edades',
    'pt-BR': 'Faixa etária',
  },
  agesValue: {
    en: '{from} to {to} years old',
    fr: '{from} à {to} ans',
    es: 'de {from} a {to} años',
    'pt-BR': 'de {from} a {to} anos',
  },
  difficulty: {
    en: 'Difficulty',
    fr: 'Difficulté',
    es: 'Dificultad',
    'pt-BR': 'Dificuldade',
  },
  duration: {
    en: 'Lesson time',
    fr: 'Durée de la leçon',
    es: 'Duración de la clase',
    'pt-BR': 'Duração da aula',
  },
  minutes: {
    en: '{n} minutes',
    fr: '{n} minutes',
    es: '{n} minutos',
    'pt-BR': '{n} minutos',
  },
  material: {
    en: 'Material',
    fr: 'Matériel',
    es: 'Material',
    'pt-BR': 'Material',
  },
  scene: {
    en: 'Scene to open',
    fr: 'Scène à ouvrir',
    es: 'Escena que abrir',
    'pt-BR': 'Cena para abrir',
  },
  objectives: {
    en: 'Learning objectives',
    fr: 'Objectifs pédagogiques',
    es: 'Objetivos de aprendizaje',
    'pt-BR': 'Objetivos de aprendizagem',
  },
  teacherGuide: {
    en: 'Teacher guide and answer key',
    fr: 'Guide de l’enseignant et corrigé',
    es: 'Guía del docente y respuestas',
    'pt-BR': 'Guia do professor e respostas',
  },
  answerKey: {
    en: 'Answer key',
    fr: 'Corrigé',
    es: 'Respuestas',
    'pt-BR': 'Respostas',
  },
  computedNote: {
    en: 'Figures computed by Galaxy for the years {from} to {to}, with the same code as the scene; dates in Universal Time. Quoted facts:',
    fr: 'Valeurs calculées par Galaxy pour les années {from} à {to}, avec le code même de la scène ; dates en temps universel. Faits cités :',
    es: 'Valores calculados por Galaxy para los años {from} a {to}, con el mismo código que la escena; fechas en tiempo universal. Datos citados:',
    'pt-BR':
      'Valores calculados pelo Galaxy para os anos de {from} a {to}, com o mesmo código da cena; datas em tempo universal. Dados citados:',
  },
  factLine: {
    en: '{body}, axial tilt: {publisher}, {title}, read on {date}.',
    fr: '{body}, inclinaison axiale : {publisher}, {title}, lu le {date}.',
    es: '{body}, inclinación axial: {publisher}, {title}, consultado el {date}.',
    'pt-BR':
      '{body}, inclinação axial: {publisher}, {title}, consultado em {date}.',
  },
  editionLine: {
    en: '{title}: {credit}; product sheet read on {date}.',
    fr: '{title} : {credit} ; fiche du produit relue le {date}.',
    es: '{title}: {credit}; ficha del producto consultada el {date}.',
    'pt-BR': '{title}: {credit}; ficha do produto consultada em {date}.',
  },
  editionNote: {
    en: 'Image dates quoted from the product sheets of the imagery editions, not computed. Sources:',
    fr: 'Dates des images citées depuis les fiches de produit des éditions d’imagerie, et non calculées. Sources :',
    es: 'Fechas de las imágenes citadas de las fichas de producto de las ediciones de imágenes, no calculadas. Fuentes:',
    'pt-BR':
      'Datas das imagens citadas das fichas de produto das edições de imagens, não calculadas. Fontes:',
  },
  pupilSheet: {
    en: 'Pupil sheet',
    fr: 'Fiche élève',
    es: 'Ficha del alumno',
    'pt-BR': 'Ficha do aluno',
  },
  pupilLink: {
    en: 'Address of the scene:',
    fr: 'Adresse de la scène :',
    es: 'Dirección de la escena:',
    'pt-BR': 'Endereço da cena:',
  },
  formatSource: {
    en: 'Format of this sheet',
    fr: 'Format de cette fiche',
    es: 'Formato de esta ficha',
    'pt-BR': 'Formato desta ficha',
  },
  formatText: {
    en: 'The layout follows ESA’s “teach with space” sheets, which the ESERO network relays to teachers. Reference read on {date}:',
    fr: 'La présentation suit les fiches « teach with space » de l’ESA, que le réseau ESERO relaie auprès des enseignants. Référence lue le {date} :',
    es: 'La presentación sigue las fichas «teach with space» de la ESA, que la red ESERO hace llegar a los docentes. Referencia consultada el {date}:',
    'pt-BR':
      'A apresentação segue as fichas “teach with space” da ESA, que a rede ESERO divulga aos professores. Referência consultada em {date}:',
  },
  all: {
    en: 'All activities',
    fr: 'Toutes les activités',
    es: 'Todas las actividades',
    'pt-BR': 'Todas as atividades',
  },
} as const satisfies Record<string, DocText>;

const SUBJECT: Record<ActivityRecord['subjects'][number], DocText> = {
  physics: { en: 'physics', fr: 'physique', es: 'física', 'pt-BR': 'física' },
  geography: {
    en: 'geography',
    fr: 'géographie',
    es: 'geografía',
    'pt-BR': 'geografia',
  },
  earthScience: {
    en: 'Earth science',
    fr: 'sciences de la Terre',
    es: 'ciencias de la Tierra',
    'pt-BR': 'ciências da Terra',
  },
  astronomy: {
    en: 'astronomy',
    fr: 'astronomie',
    es: 'astronomía',
    'pt-BR': 'astronomia',
  },
};

const DIFFICULTY: Record<ActivityRecord['difficulty'], DocText> = {
  easy: { en: 'easy', fr: 'facile', es: 'fácil', 'pt-BR': 'fácil' },
  medium: { en: 'medium', fr: 'moyenne', es: 'media', 'pt-BR': 'média' },
  hard: { en: 'hard', fr: 'difficile', es: 'difícil', 'pt-BR': 'difícil' },
};

type Level = NonNullable<
  ActivityRecord['parts'][number]['questions'][number]['level']
>;

/** Les niveaux de lecture, tels que la fiche les nomme (pas 3, choix de l'utilisateur). */
const LEVEL: Record<Level, DocText> = {
  high: {
    en: 'To go further, upper secondary:',
    fr: 'Pour aller plus loin, lycée :',
    es: 'Para ir más lejos, bachillerato:',
    'pt-BR': 'Para ir além, ensino médio:',
  },
  advanced: {
    en: 'To go further, advanced:',
    fr: 'Pour aller plus loin, niveau avancé :',
    es: 'Para ir más lejos, nivel avanzado:',
    'pt-BR': 'Para ir além, nível avançado:',
  },
};

const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? `{${key}}`);

export interface ActivityPageInputs {
  activities: readonly ActivityRecord[];
  tours: readonly TourScript[];
  config: CelestialConfig;
  origin: string;
}

const activitySlug = (activity: Pick<ActivityRecord, 'id'>): string =>
  `${ACTIVITIES_SLUG}/${activity.id}`;

/** La scène que l'élève ouvre : la page de la Terre dans la langue de la fiche, et sa visite. */
export function activitySceneHref(
  activity: Pick<ActivityRecord, 'tour'>,
  locale: Locale
): string {
  return `/${bodyPagePath('earth', locale)}/?tour=${activity.tour}`;
}

const list = (items: readonly string[], ordered = false): string => {
  const tag = ordered ? 'ol' : 'ul';
  return `<${tag}>${items.map((item) => `<li>${item}</li>`).join('')}</${tag}>`;
};

function factLines(
  activity: ActivityRecord,
  config: CelestialConfig,
  locale: Locale
): { lines: string[]; latest: string } {
  const seen = new Set<string>();
  const lines: string[] = [];
  let latest = '';
  for (const value of Object.values(activity.values)) {
    if (value.kind === 'imageryEdition') {
      const key = `${value.body}.edition.${value.edition}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const tileset = editionTileset(value.body, value.edition);
      if (!tileset?.verified)
        throw new Error(`activité ${activity.id} : ${key} sans fiche relue`);
      lines.push(
        escapeHtml(
          fill(TEXT.editionLine[locale], {
            title: tileset.title,
            credit: tileset.credit,
            date: longDay(tileset.verified, locale),
          })
        )
      );
      if (tileset.verified > latest) latest = tileset.verified;
      continue;
    }
    if (value.kind !== 'fact') continue;
    const key = `${value.body}.${value.fact}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const provenance = catalogueFactProvenance(config, value.body, value.fact);
    const source = provenance && factSource(provenance.source);
    if (!source)
      throw new Error(`activité ${activity.id} : ${key} sans source`);
    const body = flattenBodies(config).get(value.body)?.displayName?.[locale];
    if (!body)
      throw new Error(`activité ${activity.id} : corps ${value.body} sans nom`);
    lines.push(
      escapeHtml(
        fill(TEXT.factLine[locale], {
          body,
          publisher: source.publisher,
          title: source.title,
          date: longDay(source.accessed, locale),
        })
      )
    );
    if (source.accessed > latest) latest = source.accessed;
  }
  return { lines, latest };
}

function activityPage(
  activity: ActivityRecord,
  inputs: ActivityPageInputs,
  locale: Locale
): DocPage {
  const { config, origin } = inputs;
  const values: Record<string, EvaluatedValue> = evaluateActivityValues(
    activity,
    catalogueFactReader(config),
    catalogueEditionReader
  );
  const text = (t: DocText | Record<Locale, string>): string =>
    escapeHtml(t[locale]);
  const slotted = (t: Record<Locale, string>): string =>
    escapeHtml(fillSlots(t[locale], values, locale));
  // Un prolongement gradué (pas 3) porte son niveau EN TÊTE de la question, dans le corrigé comme
  // sur la fiche élève : c'est la même question, pour un autre lecteur.
  const levelTag = (level: Level | undefined): string =>
    level === undefined
      ? ''
      : `<span class="activity-level">${escapeHtml(LEVEL[level][locale])}</span> `;
  const tour = inputs.tours.find((t) => t.id === activity.tour);
  if (!tour) throw new Error(`activité ${activity.id} : visite inconnue`);
  const sceneHref = activitySceneHref(activity, locale);
  const sceneUrl = `${origin}${sceneHref}`;

  const glance = `<dl class="activity-glance">${[
    [
      TEXT.subjects,
      activity.subjects.map((s) => SUBJECT[s][locale]).join(', '),
    ],
    [
      TEXT.ages,
      fill(TEXT.agesValue[locale], {
        from: String(activity.ages.from),
        to: String(activity.ages.to),
      }),
    ],
    [TEXT.difficulty, DIFFICULTY[activity.difficulty][locale]],
    [
      TEXT.duration,
      fill(TEXT.minutes[locale], { n: String(activity.durationMinutes) }),
    ],
  ]
    .map(
      ([label, value]) =>
        `<div><dt>${escapeHtml((label as DocText)[locale])}</dt><dd>${escapeHtml(value as string)}</dd></div>`
    )
    .join('')}<div><dt>${text(TEXT.material)}</dt><dd>${list(
    activity.material.map(text)
  )}</dd></div><div><dt>${text(TEXT.scene)}</dt><dd><a href="${escapeHtml(sceneHref)}">${escapeHtml(tour.title[locale])}</a></dd></div></dl>`;

  const facts = factLines(activity, config, locale);
  const teacher = activity.parts
    .map(
      (part, index) =>
        `<h3>${index + 1}. ${text(part.title)}</h3><p>${text(part.teacher)}</p>` +
        `<h4>${text(TEXT.answerKey)}</h4><dl class="activity-answers">${part.questions
          .map(
            (q) =>
              `<div><dt>${levelTag(q.level)}${slotted(q.prompt)}</dt><dd>${slotted(q.answer)}</dd></div>`
          )
          .join('')}</dl>`
    )
    .join('');
  const computed =
    `<p class="activity-note">${escapeHtml(
      activity.years
        ? fill(TEXT.computedNote[locale], {
            from: String(activity.years.from),
            to: String(activity.years.to),
          })
        : TEXT.editionNote[locale]
    )}</p>` + list(facts.lines);

  const pupil =
    `<p class="activity-pupil-title">${text(activity.title)}</p>` +
    `<p>${text(TEXT.pupilLink)} <span class="activity-url">${escapeHtml(sceneUrl)}</span></p>` +
    activity.parts
      .map(
        (part, index) =>
          `<h3>${index + 1}. ${text(part.title)}</h3>` +
          list(part.steps.map(text), true) +
          part.questions
            .map(
              (q) =>
                `<p class="activity-question">${levelTag(q.level)}${slotted(q.prompt)}</p><div class="activity-lines" aria-hidden="true"></div>`
            )
            .join('')
      )
      .join('');

  const format = `<p>${escapeHtml(
    fill(TEXT.formatText[locale], {
      date: longDay(ESA_FORMAT_SOURCE.accessed, locale),
    })
  )} <a href="${escapeHtml(ESA_FORMAT_SOURCE.url)}" rel="noopener noreferrer">${escapeHtml(ESA_FORMAT_SOURCE.publisher)}, ${escapeHtml(ESA_FORMAT_SOURCE.title)}</a>.</p><p class="activity-screen-only"><a href="${docPath(ACTIVITIES_SLUG, locale)}">${text(TEXT.all)}</a></p>`;

  const slug = activitySlug(activity);
  return {
    slug,
    locale,
    canonical: `${origin}${docPath(slug, locale)}`,
    title: activity.title[locale],
    description: trimForMeta(activity.summary[locale], 160),
    updated: facts.latest,
    body: [
      `      <p>${text(activity.summary)}</p>`,
      docSection('at-a-glance', TEXT.atAGlance[locale], glance),
      docSection(
        'objectives',
        TEXT.objectives[locale],
        list(activity.objectives.map(text))
      ),
      docSection('teacher', TEXT.teacherGuide[locale], teacher + computed),
      docSection('pupil', TEXT.pupilSheet[locale], pupil).replace(
        '<h2 id="pupil">',
        '<h2 id="pupil" class="activity-pupil">'
      ),
      docSection('format', TEXT.formatSource[locale], format),
    ].join('\n'),
  };
}

function indexPage(inputs: ActivityPageInputs, locale: Locale): DocPage {
  const items = inputs.activities.map(
    (activity) =>
      `<a href="${docPath(activitySlug(activity), locale)}">${escapeHtml(activity.title[locale])}</a>: ${escapeHtml(activity.summary[locale])}`
  );
  const updated = inputs.activities
    .map((a) => factLines(a, inputs.config, locale).latest)
    .sort()
    .at(-1)!;
  return {
    slug: ACTIVITIES_SLUG,
    locale,
    canonical: `${inputs.origin}${docPath(ACTIVITIES_SLUG, locale)}`,
    title: TEXT.indexTitle[locale],
    description: TEXT.indexDescription[locale],
    updated,
    body: `      <p>${escapeHtml(TEXT.indexIntro[locale])}</p>\n      <section>${list(items)}</section>`,
  };
}

/** L'index et une page par activité, dans une langue. */
export function activityPages(
  inputs: ActivityPageInputs,
  locale: Locale
): DocPage[] {
  return [
    indexPage(inputs, locale),
    ...inputs.activities.map((activity) =>
      activityPage(activity, inputs, locale)
    ),
  ];
}
