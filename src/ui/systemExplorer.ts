/**
 * EXPLORER UN SYSTÈME STELLAIRE (GAL-UNIVERSE-006) : depuis la vue du voisinage solaire, l'étoile choisie,
 * ses composantes et les orbites de ses planètes cataloguées. Morceau chargé au premier clic sur
 * « Explorer ce système » ; jamais au démarrage, jamais avec la vue du voisinage.
 *
 * Une seule boucle, un seul renderer : la vue du voisinage passe son rendu de remplacement à
 * `SystemScene` tant que l'exploration est ouverte (`ExplorerHost.setRender`), et le reprend à la
 * fermeture. L'exploration possède sa scène, ses contrôles et son DOM (posé DANS la vue du voisinage,
 * dont les éléments sont masqués puis rendus tels quels) ; `close()` libère tout.
 *
 * Données (`core/exoplanetSystems`) : composantes du catalogue des voisines, planètes et paramètres de
 * l'étoile hôte de l'instantané détaillé de l'archive (un paquet de ~32 Ko par hôte, lu à l'ouverture).
 * Chaque valeur dit sa nature : publiée, calculée par l'archive, dérivée ici, ou inconnue.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  SystemScene,
  type ComparisonRing,
} from '@/components/stellar/SystemScene';
import { allBodies } from '@/config/catalog';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import type { ExoplanetFile } from '@/core/exoplanets';
import {
  bucketUrl,
  buildSystemModel,
  hostsByMember,
  planetMass,
  type OrbitShape,
  type Provenance,
  type SystemHostRow,
  type SystemModel,
  type SystemsFile,
  type Valued,
} from '@/core/exoplanetSystems';
import { distanceFacts, type NeighbourSystem } from '@/core/neighbours';
import { starSlug } from '@/core/stellarPermalink';
import { bodyDisplayName } from '@/i18n/bodyText';
import { getLocale, onLocaleChange, t } from '@/i18n';
import { loadDeferredMessages } from '@/i18n/deferredMessages';
import { prefersReducedMotion } from '@/utils/reducedMotion';
import Logger from '@/utils/Logger';
import { getAnnouncer } from './announcer';
import { METHOD_KEYS } from './exoplanetMethods';
import './systemExplorer.css';

/** Remerciement EXIGÉ par la NASA Exoplanet Archive, verbatim et en anglais (page lue le 2026-11-03). */
export const ARCHIVE_ACKNOWLEDGEMENT =
  'This research has made use of the NASA Exoplanet Archive, which is operated by the California Institute of Technology, under contract with the National Aeronautics and Space Administration under the Exoplanet Exploration Program.';

/** Les planètes du Système solaire montrées pour comparaison (leurs demi-grands axes sont lus dans le registre). */
const COMPARISON_BODIES = [
  'mercury',
  'venus',
  'earth',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
] as const;

const PICK_RADIUS_PX = 16;
const CLICK_MOVE_TOLERANCE = 5;
const KEY_ROTATE_RAD = (6 * Math.PI) / 180;
const KEY_ZOOM = 1.2;
const GLIDE_MS = 900;
/** Le recul d'ouverture : la caméra arrive de cette fraction du cadrage final multipliée (échelle géométrique). */
const ARRIVAL_FACTOR = 40;

/** Ce que l'exploration demande à la vue du voisinage : le renderer, la boucle, et rien d'autre. */
export interface ExplorerHost {
  /** La vue du voisinage : l'exploration s'y pose et masque le reste. */
  root: HTMLElement;
  renderer: THREE.WebGLRenderer;
  /** Remplace le rendu de la vue par `fn` (ou le lui rend avec `null`) : même boucle, même renderer. */
  setRender(fn: (() => void) | null): void;
  system: NeighbourSystem;
  name: string;
  /** L'instantané d'exoplanètes de la couche du ciel (pour la correspondance étoile ↔ hôte, #576). */
  exoplanets(): Promise<ExoplanetFile | null>;
  fetchImpl: typeof fetch;
  /** La planète demandée par l'adresse (identifiant `starSlug` de son nom), le cas échéant. */
  initialPlanet?: string | null;
  /** L'objet choisi change : l'adresse le suit (`null` : aucune planète choisie). */
  onPlanet(slug: string | null): void;
  /** L'exploration se ferme (bouton, Échap) : la vue du voisinage reprend la main. */
  onClose(): void;
}

export interface SystemExplorer {
  close(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  id?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (id) node.id = id;
  return node;
}

const number = (value: number, digits: number): string =>
  new Intl.NumberFormat(getLocale(), {
    maximumSignificantDigits: digits,
  }).format(value);

/** Une valeur suivie de sa nature quand elle n'est pas simplement publiée. */
function withProvenance(text: string, provenance: Provenance): string {
  if (provenance === 'archiveCalculated')
    return `${text} (${t('sx.tag.calculated')})`;
  if (provenance === 'derived') return `${text} (${t('sx.tag.derived')})`;
  return text;
}

function provenanceOf(calc: 0 | 1 | null): Provenance {
  return calc === 1 ? 'archiveCalculated' : 'published';
}

/** Les demi-grands axes du Système solaire, lus dans le registre (NSSDCA), jamais recopiés. */
export function comparisonRings(): ComparisonRing[] {
  const rings: ComparisonRing[] = [];
  for (const entry of allBodies(CELESTIAL_CONFIG)) {
    if (!(COMPARISON_BODIES as readonly string[]).includes(entry.name))
      continue;
    const au = entry.config.realData?.distanceAU;
    if (typeof au === 'number' && au > 0) rings.push({ name: entry.name, au });
  }
  return rings.sort((a, b) => a.au - b.au);
}

/** Lit les paquets de l'instantané détaillé qui portent ces hôtes (un paquet n'est lu qu'une fois). */
async function readHosts(
  hosts: readonly string[],
  fetchImpl: typeof fetch
): Promise<{
  details: Map<string, SystemHostRow>;
  source: SystemsFile['source'] | null;
}> {
  const urls = [...new Set(hosts.map(bucketUrl))];
  const files = await Promise.all(
    urls.map(async (url) => {
      const res = await fetchImpl(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} : ${url}`);
      return (await res.json()) as SystemsFile;
    })
  );
  const details = new Map<string, SystemHostRow>();
  for (const file of files)
    for (const row of file.systems)
      if (hosts.includes(row[0])) details.set(row[0], row);
  return { details, source: files[0]?.source ?? null };
}

export async function openSystemExplorer(
  host: ExplorerHost
): Promise<SystemExplorer> {
  await loadDeferredMessages();
  const reduced = prefersReducedMotion();
  const cleanups: Array<() => void> = [];

  // ---- les données : correspondance (règle de #576), puis le paquet de chaque hôte reconnu
  let archiveUnavailable = false;
  let source: SystemsFile['source'] | null = null;
  // La date de l'instantané qui a servi à la CORRESPONDANCE (couche du ciel) : c'est elle qui dit « aucune planète ».
  let matchDate: string | null = null;
  let model: SystemModel;
  try {
    const archive = await host.exoplanets();
    if (!archive) throw new Error('archive des exoplanètes illisible');
    matchDate = archive.source.retrieved;
    const hosts = hostsByMember(host.system, archive.systems);
    const flat = hosts.flat();
    const read = flat.length
      ? await readHosts(flat, host.fetchImpl)
      : { details: new Map<string, SystemHostRow>(), source: null };
    source = read.source;
    model = buildSystemModel(host.system, host.name, hosts, read.details);
  } catch (error) {
    Logger.warn('[systemExplorer] planètes illisibles', error);
    archiveUnavailable = true;
    model = buildSystemModel(
      host.system,
      host.name,
      host.system.members.map(() => []),
      new Map()
    );
  }

  const scene = new SystemScene(
    model,
    window.innerWidth / Math.max(1, window.innerHeight)
  );
  const rings = comparisonRings();
  scene.setComparisonRings(rings);

  // ---- le DOM, posé dans la vue du voisinage (dont le reste est masqué tant que l'exploration est ouverte)
  const root = el('section', 'system-explorer', 'system-explorer');
  root.setAttribute('aria-labelledby', 'system-title');
  const head = el('div', 'sv-head');
  const top = el('header', 'sv-top');
  const title = el('h2', 'sv-title', 'system-title');
  const back = el('button', 'sv-button sv-back', 'system-back');
  back.type = 'button';
  const reset = el('button', 'sv-button', 'system-reset');
  reset.type = 'button';
  const compare = el('button', 'sv-button', 'system-compare');
  compare.type = 'button';
  compare.setAttribute('aria-pressed', 'false');
  top.append(title, back, reset, compare);
  const field = el('p', 'sv-scale sv-field', 'system-field');
  const scaleNote = el('p', 'sv-scale', 'system-scale');
  head.append(top, scaleNote, field);
  const surface = el('div', 'sv-surface', 'system-surface');
  surface.tabIndex = 0;
  surface.setAttribute('role', 'group');
  surface.setAttribute('aria-describedby', 'system-help');
  const labels = el('div', 'sv-labels');
  labels.setAttribute('aria-hidden', 'true');
  const help = el('p', 'sv-help', 'system-help');
  const side = el('aside', 'sv-side sx-side');
  const status = el('p', 'sv-note sx-status', 'system-status');
  const listTitle = el('h3', 'sv-heading', 'system-list-title');
  const list = el('ul', 'sv-list sx-list', 'system-list');
  list.setAttribute('aria-labelledby', 'system-list-title');
  const card = el('div', 'sv-card', 'system-card');
  card.setAttribute('role', 'region');
  card.setAttribute('aria-labelledby', 'system-card-title');
  const cardTitle = el('h3', 'sv-heading', 'system-card-title');
  const facts = el('dl', 'exo-facts');
  const notes = el('div', 'sv-notes');
  card.append(cardTitle, facts, notes);
  const tableBox = el('details', 'sx-table-box', 'system-table-box');
  const tableSummary = el('summary', 'sx-summary');
  const table = el('table', 'sx-table', 'system-table');
  tableBox.append(tableSummary, table);
  const read = el('details', 'sx-read', 'system-read');
  const readSummary = el('summary', 'sx-summary');
  const readList = el('ul', 'sx-read-list');
  read.append(readSummary, readList);
  const compareNote = el('p', 'sv-note', 'system-compare-note');
  compareNote.hidden = true;
  const sources = el('div', 'sx-sources', 'system-sources');
  side.append(
    status,
    listTitle,
    list,
    card,
    tableBox,
    compareNote,
    read,
    sources
  );
  root.append(surface, labels, head, help, side);
  host.root.append(root);
  host.root.classList.add('sv-exploring');

  // ---- la sélection : une étoile (rang de composante) ou une planète (rang dans model.planets)
  let selected: { kind: 'star' | 'planet'; index: number } = {
    kind: 'star',
    index: 0,
  };

  // ---- les contrôles, sur la surface de l'exploration
  const controls = new OrbitControls(scene.camera, surface);
  controls.enableDamping = !reduced;
  controls.dampingFactor = 0.12;
  controls.screenSpacePanning = true;
  const wholeExtent = scene.extentAu(-1);
  controls.minDistance = 1e-5;
  controls.maxDistance = scene.distanceToFit(Math.max(wholeExtent, 40)) * 8;

  let glide: {
    t0: number;
    from: { position: THREE.Vector3; target: THREE.Vector3 };
    to: { position: THREE.Vector3; target: THREE.Vector3 };
    geometric: boolean;
  } | null = null;
  const frameOn = (
    target: THREE.Vector3,
    radiusAu: number,
    from?: number
  ): void => {
    const distance = scene.distanceToFit(radiusAu);
    // On regarde le plan du ciel un peu en biais : les bandes restent lisibles et la profondeur se devine.
    const direction = new THREE.Vector3(0, -0.42, 1).normalize();
    const position = target
      .clone()
      .add(direction.clone().multiplyScalar(distance));
    const start = from
      ? target.clone().add(direction.multiplyScalar(distance * from))
      : scene.camera.position.clone();
    if (reduced) {
      glide = null;
      controls.target.copy(target);
      scene.camera.position.copy(position);
      scene.fitClipping(distance);
      controls.update();
      return;
    }
    if (from) {
      scene.camera.position.copy(start);
      controls.target.copy(target);
    }
    glide = {
      t0: performance.now(),
      from: {
        position: scene.camera.position.clone(),
        target: controls.target.clone(),
      },
      to: { position, target },
      geometric: true,
    };
  };
  const stepGlide = (): void => {
    if (!glide) return;
    const p = Math.min(1, (performance.now() - glide.t0) / GLIDE_MS);
    const e = p * p * (3 - 2 * p);
    controls.target.lerpVectors(glide.from.target, glide.to.target, e);
    // Distance en progression GÉOMÉTRIQUE (même rapport à chaque instant), direction interpolée.
    const fromOffset = glide.from.position.clone().sub(glide.from.target);
    const toOffset = glide.to.position.clone().sub(glide.to.target);
    const d0 = fromOffset.length();
    const d1 = toOffset.length();
    const d = d0 > 0 && d1 > 0 ? d0 * Math.pow(d1 / d0, e) : d1;
    const dir = fromOffset
      .normalize()
      .lerp(toOffset.normalize(), e)
      .normalize();
    scene.camera.position.copy(controls.target).add(dir.multiplyScalar(d));
    scene.fitClipping(d);
    if (p >= 1) glide = null;
  };
  const stopGlide = (): void => {
    glide = null;
  };
  surface.addEventListener('pointerdown', stopGlide);
  surface.addEventListener('wheel', stopGlide, { passive: true });
  cleanups.push(() => {
    surface.removeEventListener('pointerdown', stopGlide);
    surface.removeEventListener('wheel', stopGlide);
  });

  // Le système entier : le milieu des composantes, et le rayon qui contient chacune avec ses orbites.
  const whole = ((): { centre: THREE.Vector3; radius: number } => {
    const box = new THREE.Box3().setFromPoints([...scene.centres]);
    const centre = box.getCenter(new THREE.Vector3());
    let radius = scene.extentAu(0);
    scene.centres.forEach((c, i) => {
      radius = Math.max(radius, c.distanceTo(centre) + scene.extentAu(i));
    });
    return { centre, radius };
  })();
  const frameSelection = (from?: number): void => {
    if (selected.kind === 'star') {
      // La primaire d'un système à plusieurs étoiles : on montre tout le système, compagnes comprises.
      if (model.components.length > 1 && selected.index === 0)
        frameOn(whole.centre.clone(), whole.radius, from);
      else
        frameOn(
          scene.centres[selected.index]!.clone(),
          scene.extentAu(selected.index),
          from
        );
    } else {
      const planet = model.planets[selected.index]!;
      const shape = planet.shape;
      const radius =
        shape.kind === 'band'
          ? shape.apoastronAu
          : shape.kind === 'none'
            ? scene.extentAu(planet.component)
            : shape.axis.value;
      frameOn(scene.centres[planet.component]!.clone(), radius, from);
    }
  };
  /** Vue d'ensemble : toutes les composantes et leurs orbites. */
  const home = (): void => {
    frameOn(whole.centre.clone(), whole.radius);
  };

  // ---- la fiche
  const fact = (label: string, value: string): HTMLElement[] => {
    const dt = el('dt');
    dt.textContent = label;
    const dd = el('dd');
    dd.textContent = value;
    return [dt, dd];
  };
  const note = (text: string): HTMLElement => {
    const p = el('p', 'sv-note');
    p.textContent = text;
    return p;
  };
  const axisText = (axis: Valued): string =>
    withProvenance(
      t('exo.unit.au', { v: number(axis.value, 4) }),
      axis.provenance
    );

  function renderStarCard(index: number): void {
    const component = model.components[index]!;
    const row = component.row;
    const d = distanceFacts(row);
    const archive = component.host;
    cardTitle.textContent = row[0];
    const items: HTMLElement[] = [
      ...fact(t('sx.star.spectral'), row[2] ?? t('nb.card.unknown')),
      // Le type de l'archive quand il diffère de celui du catalogue : deux sources, dites toutes deux.
      ...(archive?.[6] && archive[6] !== row[2]
        ? fact(t('sx.star.spectralArchive'), archive[6])
        : []),
      ...fact(
        t('st.distSun'),
        d.lightYearsError === null
          ? t('nb.card.distanceValue', { ly: number(d.lightYears, 4) })
          : t('nb.card.distanceError', {
              ly: number(d.lightYears, 5),
              err: number(d.lightYearsError, 1),
            })
      ),
    ];
    if (index > 0)
      items.push(
        ...fact(
          t('sx.star.separation', { name: model.components[0]!.row[0] }),
          t('sx.star.separationValue', {
            au: number(component.separationAu, 3),
          })
        )
      );
    if (archive) {
      const teff = archive[7];
      const radius = archive[9];
      const mass = archive[11];
      items.push(
        ...fact(
          t('sx.star.teff'),
          teff === null
            ? t('exo.card.unknown')
            : withProvenance(
                t('sx.unit.kelvin', { v: number(teff, 4) }),
                provenanceOf(archive[8])
              )
        ),
        ...fact(
          t('sx.star.radius'),
          radius === null
            ? t('exo.card.unknown')
            : withProvenance(
                t('sx.unit.solarRadii', { v: number(radius, 3) }),
                provenanceOf(archive[10])
              )
        ),
        ...fact(
          t('sx.star.mass'),
          mass === null
            ? t('exo.card.unknown')
            : withProvenance(
                t('sx.unit.solarMasses', { v: number(mass, 3) }),
                provenanceOf(archive[12])
              )
        )
      );
    }
    facts.replaceChildren(...items);
    const lines: string[] = [
      row[11] === 'gaia-dr3'
        ? t('nb.card.origin.gaia', { id: row[12] ?? '' })
        : t('nb.card.origin.hyg'),
    ];
    const planets = model.planets.filter((p) => p.component === index).length;
    if (archiveUnavailable) lines.push(t('sx.archiveUnavailable'));
    else if (!archive) lines.push(t('sx.star.noHost'));
    else {
      lines.push(
        t('sx.star.hostOf', { host: archive[0], count: String(planets) })
      );
      if (archive[9] !== null) lines.push(t('sx.star.trueSize'));
    }
    if (
      model.archiveStars !== null &&
      model.archiveStars > model.components.length &&
      index === 0
    )
      lines.push(
        t('sx.star.archiveStars', {
          n: String(model.archiveStars),
          m: String(model.components.length),
        })
      );
    notes.replaceChildren(...lines.map(note));
  }

  function shapeLines(shape: OrbitShape): HTMLElement[] {
    switch (shape.kind) {
      case 'band':
        return [
          ...fact(t('exo.card.axis'), axisText(shape.axis)),
          ...fact(
            t('sx.planet.eccentricity'),
            withProvenance(
              number(shape.eccentricity.value, 3),
              shape.eccentricity.provenance
            )
          ),
          ...fact(
            t('sx.planet.range'),
            t('sx.planet.rangeValue', {
              q: number(shape.periastronAu, 3),
              Q: number(shape.apoastronAu, 3),
            })
          ),
        ];
      case 'circle':
        return [
          ...fact(t('exo.card.axis'), axisText(shape.axis)),
          ...fact(t('sx.planet.eccentricity'), t('sx.planet.eccZero')),
        ];
      case 'axisOnly':
        return [
          ...fact(t('exo.card.axis'), axisText(shape.axis)),
          ...fact(t('sx.planet.eccentricity'), t('sx.planet.eccUnknown')),
        ];
      case 'none':
        return [...fact(t('exo.card.axis'), t('exo.card.unknown'))];
    }
  }

  function renderPlanetCard(index: number): void {
    const planet = model.planets[index]!;
    const row = planet.row;
    cardTitle.textContent = row[0];
    const mass = planetMass(row);
    const methodKey = row[15] ? METHOD_KEYS[row[15]] : undefined;
    facts.replaceChildren(
      ...fact(t('sx.planet.star'), model.components[planet.component]!.row[0]),
      ...fact(
        t('exo.card.period'),
        row[1] === null
          ? t('exo.card.unknown')
          : withProvenance(
              t('exo.unit.days', { v: number(row[1], 5) }),
              provenanceOf(row[2])
            )
      ),
      ...shapeLines(planet.shape),
      ...(row[7] !== null
        ? fact(
            t('sx.planet.inclination'),
            withProvenance(
              t('sx.unit.degrees', { v: number(row[7], 3) }),
              provenanceOf(row[8])
            )
          )
        : []),
      ...fact(
        t('sx.planet.mass'),
        !mass
          ? t('exo.card.unknown')
          : `${t('sx.unit.earthMasses', { v: number(mass.value, 3) })} (${t(
              mass.kind === 'mass'
                ? 'sx.tag.trueMass'
                : mass.kind === 'minimum'
                  ? 'sx.tag.minimum'
                  : 'sx.tag.calculated'
            )})`
      ),
      ...fact(
        t('exo.card.radius'),
        row[9] === null
          ? t('exo.card.unknown')
          : withProvenance(
              t('exo.unit.earthRadii', { v: number(row[9], 3) }),
              provenanceOf(row[10])
            )
      ),
      ...fact(
        t('exo.card.year'),
        row[14] === null ? t('exo.card.unknown') : String(row[14])
      ),
      ...fact(
        t('exo.card.method'),
        methodKey
          ? t(methodKey as Parameters<typeof t>[0])
          : (row[15] ?? t('exo.card.unknown'))
      )
    );
    const lines: string[] = [];
    if (planet.shape.kind === 'none') lines.push(t('sx.planet.noOrbit'));
    else lines.push(t('sx.planet.position'));
    if (row[10] === 1) lines.push(t('sx.planet.radiusCalculated'));
    if (row[16] === 1) lines.push(t('sx.planet.controversial'));
    if (row[17] === 1) lines.push(t('sx.planet.circumbinary'));
    notes.replaceChildren(...lines.map(note));
  }

  function renderCard(): void {
    if (selected.kind === 'star') renderStarCard(selected.index);
    else renderPlanetCard(selected.index);
  }

  // ---- la liste : les étoiles, puis les planètes de chacune (des boutons, `aria-pressed`)
  function renderList(): void {
    const items: HTMLElement[] = [];
    model.components.forEach((component, i) => {
      const li = el('li');
      const button = el('button', 'sv-star sx-item sx-item--star');
      button.type = 'button';
      button.dataset['kind'] = 'star';
      button.dataset['index'] = String(i);
      button.textContent = t('sx.listStar', { name: component.row[0] });
      button.addEventListener('click', () =>
        select({ kind: 'star', index: i })
      );
      li.append(button);
      items.push(li);
      model.planets.forEach((planet, k) => {
        if (planet.component !== i) return;
        const pli = el('li');
        const pb = el('button', 'sv-star sx-item sx-item--planet');
        pb.type = 'button';
        pb.dataset['kind'] = 'planet';
        pb.dataset['index'] = String(k);
        pb.textContent =
          planet.shape.kind === 'none'
            ? t('sx.listPlanetNoOrbit', { name: planet.row[0] })
            : t('sx.listPlanet', { name: planet.row[0] });
        pb.addEventListener('click', () =>
          select({ kind: 'planet', index: k })
        );
        pli.append(pb);
        items.push(pli);
      });
    });
    list.replaceChildren(...items);
    syncPressed();
  }
  function syncPressed(): void {
    for (const b of Array.from(list.querySelectorAll('button')))
      b.setAttribute(
        'aria-pressed',
        String(
          b.dataset['kind'] === selected.kind &&
            Number(b.dataset['index']) === selected.index
        )
      );
  }

  // ---- le tableau de comparaison des planètes
  function renderTable(): void {
    tableSummary.textContent = t('sx.table.title');
    tableBox.hidden = model.planets.length === 0;
    const headRow = el('tr');
    for (const key of [
      'sx.table.planet',
      'exo.card.period',
      'exo.card.axis',
      'sx.planet.eccentricity',
      'sx.planet.mass',
      'exo.card.radius',
    ] as const) {
      const th = el('th');
      th.scope = 'col';
      th.textContent = t(key);
      headRow.append(th);
    }
    const thead = el('thead');
    thead.append(headRow);
    const tbody = el('tbody');
    for (const planet of model.planets) {
      const row = planet.row;
      const tr = el('tr');
      const name = el('th');
      name.scope = 'row';
      name.textContent = row[0];
      const mass = planetMass(row);
      const shape = planet.shape;
      // Une valeur non publiée : un tiret simple (la légende du tableau le dit).
      const none = '-';
      // Des MARQUES courtes, expliquées par la légende : le tableau tient dans le volet d'un téléphone.
      const mark = (text: string, provenance: Provenance): string =>
        provenance === 'archiveCalculated'
          ? `${text} \u2020`
          : provenance === 'derived'
            ? `${text} \u2021`
            : text;
      const cells = [
        row[1] === null ? none : mark(number(row[1], 4), provenanceOf(row[2])),
        shape.kind === 'none'
          ? none
          : mark(number(shape.axis.value, 3), shape.axis.provenance),
        row[5] === null ? none : mark(number(row[5], 2), provenanceOf(row[6])),
        !mass
          ? none
          : mass.kind === 'minimum'
            ? `\u2265 ${number(mass.value, 3)}`
            : mass.kind === 'archiveCalculated'
              ? `${number(mass.value, 3)} \u2020`
              : number(mass.value, 3),
        row[9] === null ? none : mark(number(row[9], 3), provenanceOf(row[10])),
      ];
      tr.append(name);
      for (const text of cells) {
        const td = el('td');
        td.textContent = text;
        tr.append(td);
      }
      tbody.append(tr);
    }
    const caption = el('caption', 'sv-note');
    caption.textContent = t('sx.table.caption');
    table.replaceChildren(caption, thead, tbody);
  }

  // ---- les noms dans la scène (étoiles, orbites, anneaux de comparaison), placés par priorité
  interface Label {
    el: HTMLElement;
    point(): THREE.Vector3 | null;
    width: number;
  }
  let labelItems: Label[] = [];
  const buildLabels = (): void => {
    labels.replaceChildren();
    labelItems = [];
    const add = (
      text: string,
      className: string,
      point: () => THREE.Vector3 | null,
      key: string
    ): void => {
      const node = el('span', `sv-label ${className}`);
      node.textContent = text;
      node.dataset['label'] = key;
      node.style.display = 'none';
      labels.append(node);
      labelItems.push({ el: node, point, width: 0 });
    };
    model.components.forEach((component, i) =>
      add(
        component.row[0],
        'sv-label--sun',
        () => scene.centres[i]!.clone(),
        `star-${i}`
      )
    );
    for (const k of scene.drawnPlanets)
      add(
        model.planets[k]!.row[0],
        'sx-label--orbit',
        () => scene.labelAnchor(k),
        `planet-${k}`
      );
    rings.forEach((ring, k) =>
      add(
        t('sx.compare.ring', { name: bodyDisplayName(ring.name) }),
        'sv-label--ring',
        () => scene.comparisonAnchor(k),
        `ring-${ring.name}`
      )
    );
  };
  const updateLabels = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const placed: Array<{ x: number; y: number; w: number }> = [];
    for (const item of labelItems) {
      const point = item.point();
      const s = point ? scene.projectVector(point, width, height) : null;
      let visible = false;
      if (s && s.x > 0 && s.x < width && s.y > 60 && s.y < height) {
        if (item.el.style.display === 'none') item.el.style.display = '';
        if (item.width === 0) item.width = item.el.offsetWidth || 90;
        for (const y of [s.y + 14, s.y - 14]) {
          const clash = placed.some(
            (p) =>
              Math.abs(p.x - s.x) < (p.w + item.width) / 2 + 6 &&
              Math.abs(p.y - y) < 16
          );
          if (clash) continue;
          placed.push({ x: s.x, y, w: item.width });
          item.el.style.transform = `translate(${Math.round(s.x - item.width / 2)}px, ${Math.round(y - 8)}px)`;
          // Où est le point lui-même (px écran) : les tests cliquent l'objet, pas son nom.
          item.el.dataset['sx'] = String(Math.round(s.x));
          item.el.dataset['sy'] = String(Math.round(s.y));
          visible = true;
          break;
        }
      }
      item.el.style.display = visible ? '' : 'none';
    }
  };

  // ---- la largeur du champ, en UA, réécrite au plus dix fois par seconde
  let fieldText = '';
  let fieldAt = 0;
  const renderField = (force = false): void => {
    const now = performance.now();
    if (!force && now - fieldAt < 100) return;
    fieldAt = now;
    const distance = scene.camera.position.distanceTo(controls.target);
    const width =
      2 *
      distance *
      Math.tan((scene.camera.fov * Math.PI) / 360) *
      scene.camera.aspect;
    const text = t('sx.field', { au: number(width, 3) });
    if (text !== fieldText) {
      fieldText = text;
      field.textContent = text;
    }
  };

  // ---- les textes, réécrits au changement de langue
  const renderTexts = (): void => {
    title.textContent = t('sx.title', { name: model.name });
    back.textContent = t('sx.back');
    reset.textContent = t('sx.reset');
    compare.textContent = t('sx.compare');
    scaleNote.textContent = t('sx.scale');
    help.textContent = t('sx.help');
    surface.setAttribute('aria-label', t('sx.title', { name: model.name }));
    listTitle.textContent = t('sx.list');
    readSummary.textContent = t('sx.read.title');
    const date = source?.retrieved ?? '';
    readList.replaceChildren(
      ...(
        [
          t('sx.read.measured'),
          t('sx.read.catalogued', { date }),
          t('sx.read.derived'),
          t('sx.read.illustrative'),
          t('sx.read.unknown'),
        ] as const
      ).map((text) => {
        const li = el('li', 'sv-note');
        li.textContent = text;
        return li;
      })
    );
    compareNote.textContent = t('sx.compare.note', {
      name: model.components[0]!.row[0],
    });
    const statusLines: string[] = [];
    if (archiveUnavailable) statusLines.push(t('sx.archiveUnavailable'));
    else if (!model.spatial)
      statusLines.push(
        model.planets.length === 0
          ? t('sx.doc.noPlanets', {
              date: matchDate ?? t('exo.card.unknown'),
            })
          : t('sx.doc.noAxis')
      );
    if (model.missingHosts.length)
      statusLines.push(
        t('sx.missingHosts', { hosts: model.missingHosts.join(', ') })
      );
    status.textContent = statusLines.join(' ');
    status.hidden = statusLines.length === 0;
    const sourceLine = el('p', 'sv-note');
    sourceLine.textContent = source
      ? t('sx.sources', { date: source.retrieved })
      : t('sx.sourcesStars');
    const ack = el('p', 'sv-note sx-ack');
    ack.lang = 'en';
    ack.textContent = ARCHIVE_ACKNOWLEDGEMENT;
    sources.replaceChildren(sourceLine, ...(source ? [ack] : []));
    renderList();
    renderCard();
    renderTable();
    buildLabels();
    renderField(true);
  };

  // ---- choisir un objet
  function select(
    next: { kind: 'star' | 'planet'; index: number },
    announce = true,
    frame = true
  ): void {
    selected = next;
    scene.setSelectedPlanet(next.kind === 'planet' ? next.index : -1);
    if (scene.comparisonVisible)
      scene.setComparison(
        true,
        next.kind === 'planet'
          ? model.planets[next.index]!.component
          : next.index
      );
    syncPressed();
    renderCard();
    layout();
    if (frame) frameSelection();
    host.onPlanet(
      next.kind === 'planet'
        ? starSlug(model.planets[next.index]!.row[0])
        : null
    );
    if (announce) {
      const name =
        next.kind === 'planet'
          ? model.planets[next.index]!.row[0]
          : model.components[next.index]!.row[0];
      getAnnouncer().announce(t('sx.selected', { name }));
    }
  }

  // ---- le clic ou le tap (même tolérance de glisser que la vue du voisinage)
  let start: { id: number; x: number; y: number } | null = null;
  const down = (event: PointerEvent): void => {
    if (!event.isPrimary || event.button !== 0) return;
    start = { id: event.pointerId, x: event.clientX, y: event.clientY };
  };
  const up = (event: PointerEvent): void => {
    if (!start || event.pointerId !== start.id) return;
    const from = start;
    start = null;
    if (
      Math.hypot(event.clientX - from.x, event.clientY - from.y) >
      CLICK_MOVE_TOLERANCE
    )
      return;
    const rect = surface.getBoundingClientRect();
    const hit = scene.pick(
      event.clientX - rect.left,
      event.clientY - rect.top,
      rect.width,
      rect.height,
      PICK_RADIUS_PX
    );
    if (hit) select(hit, true, hit.kind === 'star');
  };
  surface.addEventListener('pointerdown', down);
  surface.addEventListener('pointerup', up);
  cleanups.push(() => {
    surface.removeEventListener('pointerdown', down);
    surface.removeEventListener('pointerup', up);
  });

  // ---- le clavier : flèches, + et -, Origine ; Échap revient au voisinage (et seulement là)
  const orbit = (dAzimuth: number, dPolar: number): void => {
    const offset = scene.camera.position.clone().sub(controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta += dAzimuth;
    spherical.phi = Math.min(
      Math.PI - 0.05,
      Math.max(0.05, spherical.phi + dPolar)
    );
    offset.setFromSpherical(spherical);
    scene.camera.position.copy(controls.target).add(offset);
    controls.update();
  };
  const zoom = (factor: number): void => {
    const offset = scene.camera.position.clone().sub(controls.target);
    const length = Math.min(
      controls.maxDistance,
      Math.max(controls.minDistance, offset.length() * factor)
    );
    offset.setLength(length);
    scene.camera.position.copy(controls.target).add(offset);
    scene.fitClipping(length);
    controls.update();
  };
  const keydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      // L'Échap ferme l'EXPLORATION, pas la vue du voisinage qui l'entoure.
      event.stopPropagation();
      event.preventDefault();
      explorer.close();
      return;
    }
    if (event.target !== surface) return;
    const handled = ((): boolean => {
      switch (event.key) {
        case 'ArrowLeft':
          orbit(KEY_ROTATE_RAD, 0);
          return true;
        case 'ArrowRight':
          orbit(-KEY_ROTATE_RAD, 0);
          return true;
        case 'ArrowUp':
          orbit(0, -KEY_ROTATE_RAD);
          return true;
        case 'ArrowDown':
          orbit(0, KEY_ROTATE_RAD);
          return true;
        case '+':
        case '=':
          zoom(1 / KEY_ZOOM);
          return true;
        case '-':
        case '_':
          zoom(KEY_ZOOM);
          return true;
        case 'Home':
          home();
          return true;
        default:
          return false;
      }
    })();
    if (handled) {
      stopGlide();
      event.preventDefault();
    }
  };
  root.addEventListener('keydown', keydown);
  cleanups.push(() => root.removeEventListener('keydown', keydown));
  back.addEventListener('click', () => explorer.close());
  reset.addEventListener('click', home);
  compare.addEventListener('click', () => {
    const on = !scene.comparisonVisible;
    scene.setComparison(
      on,
      selected.kind === 'planet'
        ? model.planets[selected.index]!.component
        : selected.index
    );
    compare.setAttribute('aria-pressed', String(on));
    compareNote.hidden = !on;
    if (on) {
      // Le cadrage s'élargit jusqu'à l'orbite de la Terre au moins : l'échelle se lit d'un coup d'œil.
      const centre =
        selected.kind === 'planet'
          ? model.planets[selected.index]!.component
          : selected.index;
      const earth = rings.find((r) => r.name === 'earth')?.au ?? 1;
      frameOn(
        scene.centres[centre]!.clone(),
        Math.max(scene.extentAu(centre), earth * 1.1)
      );
    }
  });

  // Le cadrage : le centre de la zone libre (bandeau et volet exclus) reçoit l'objet regardé.
  const layout = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const sheet = side.getBoundingClientRect();
    const bar = head.getBoundingClientRect();
    const phone = window.matchMedia('(max-width: 640px)').matches;
    const free = phone
      ? { x0: 0, x1: w, y0: bar.bottom + 8, y1: sheet.top - 8 }
      : { x0: 0, x1: sheet.left - 8, y0: bar.bottom, y1: h };
    scene.setFraming(
      w,
      h,
      Math.round((free.x0 + free.x1) / 2 - w / 2),
      Math.round((free.y0 + free.y1) / 2 - h / 2)
    );
  };
  window.addEventListener('resize', layout);
  cleanups.push(() => window.removeEventListener('resize', layout));
  let disposed = false;
  cleanups.push(
    onLocaleChange(() => {
      void loadDeferredMessages().then(() => {
        if (!disposed) renderTexts();
      });
    })
  );

  // ---- la boucle : le rendu de remplacement de la vue, prêté à l'exploration
  host.setRender(() => {
    if (glide) stepGlide();
    else controls.update();
    renderField();
    scene.render(host.renderer);
    updateLabels();
  });

  const explorer: SystemExplorer = {
    close() {
      if (disposed) return;
      disposed = true;
      // D'abord rendre la boucle à la vue du voisinage : plus rien ne dessine le système.
      host.setRender(null);
      for (const cleanup of cleanups) cleanup();
      controls.dispose();
      scene.dispose();
      root.remove();
      host.root.classList.remove('sv-exploring');
      getAnnouncer().announce(t('sx.closed'));
      host.onClose();
    },
  };

  renderTexts();
  layout();
  // L'objet demandé par l'adresse, sinon la primaire ; on ARRIVE de loin (échelle géométrique), sans
  // animation sous mouvement réduit.
  const wanted = host.initialPlanet
    ? model.planets.findIndex((p) => starSlug(p.row[0]) === host.initialPlanet)
    : -1;
  selected =
    wanted >= 0
      ? { kind: 'planet', index: wanted }
      : { kind: 'star', index: 0 };
  scene.setSelectedPlanet(wanted);
  syncPressed();
  renderCard();
  layout();
  frameSelection(ARRIVAL_FACTOR);
  if (host.initialPlanet && wanted < 0) host.onPlanet(null);
  getAnnouncer().announce(
    t('sx.opened', {
      name: model.name,
      stars: String(model.components.length),
      planets: String(model.planets.length),
    })
  );
  back.focus();
  return explorer;
}
