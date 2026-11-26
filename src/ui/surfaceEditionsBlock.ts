/**
 * LES OBSERVATIONS DE L'ATMOSPHÈRE D'UN CORPS (GAL-ATMOSPHERES-001), dans le morceau des blocs de fiche : il
 * n'agit pas avant qu'une fiche existe, et le catalogue des éditions (`virtual:surface-editions`, dérivé des
 * fiches du registre) voyage avec lui, jamais au démarrage.
 *
 * Le visiteur choisit une observation datée (un groupe de boutons radio, au clavier par les flèches) et
 * peut alterner entre deux millésimes (« Comparer avec… »). La carte change par `CelestialObject.
 * setLayerEdition` : le même moteur de textures, le même cache, la carte précédente libérée, le cadrage
 * intact, un chargement tardif d'une édition abandonnée jeté. Un échec le DIT et garde l'observation
 * affichée.
 *
 * Ce qui est dit en clair : la date de l'observation n'est pas celle de la scène ; rien n'est interpolé
 * entre deux observations ; la phase de rotation n'est pas datée ; les couleurs, la couverture et la
 * résolution diffèrent d'une observation à l'autre. Quand la fiche montre un autre corps ou se ferme,
 * l'édition par défaut revient : la scène reste celle que la fiche décrit.
 */
import './surfaceEditionsBlock.css';
import surfaceEditions from 'virtual:surface-editions';

import { texturePath } from '@/config/catalog';
import { formatIsoDay } from '@/core/dateText';
import type { SurfaceEdition } from '@/core/surfaceEditions';
import { getLocale, intlLocale, onLocaleChange, t } from '@/i18n';
import type { PublicAPI } from '@/SolarSystemApp';
import type { TextureQuality } from '@/types';
import { getAnnouncer } from './announcer';
import type { BodyInfoPanel } from './bodyInfo';
import { formatPercent } from './localNumber';

const day = (iso: string): string =>
  formatIsoDay(iso.slice(0, 10), getLocale(), intlLocale());

export function setupSurfaceEditionsBlock(
  api: PublicAPI,
  bodyInfo: BodyInfoPanel
): void {
  const panel = document.getElementById('body-info');
  const anchor = panel?.querySelector('.bi-surface-note');
  if (!panel || !anchor) return;

  const box = document.createElement('section');
  box.className = 'bi-editions';
  box.id = 'surface-editions';
  box.hidden = true;
  const title = document.createElement('h3');
  title.className = 'bi-editions-title';
  title.id = 'surface-editions-title';
  const group = document.createElement('div');
  group.className = 'bi-editions-group';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-labelledby', title.id);
  const compare = document.createElement('button');
  compare.type = 'button';
  compare.className = 'bi-editions-compare';
  compare.id = 'surface-editions-compare';
  const status = document.createElement('p');
  status.className = 'bi-editions-status';
  status.hidden = true;
  const info = document.createElement('p');
  info.className = 'bi-editions-info';
  const scene = document.createElement('p');
  scene.className = 'bi-editions-scene';
  const limits = document.createElement('p');
  limits.className = 'bi-editions-limits';
  box.append(title, group, compare, status, info, scene, limits);
  anchor.after(box);

  let shown: string | null = null;
  /** Le dernier corps à éditions montré : sa scène reste publiée fiche fermée (un chargement tardif s'y verrait). */
  let tracked: string | null = null;
  /** L'édition DEMANDÉE et pas encore posée, par corps : la dernière intention du visiteur. */
  const pending = new Map<string, string>();
  /** La dernière autre édition montrée, cible de « Comparer avec… ». */
  let other: string | null = null;
  let request = 0;
  let sceneDay = '';

  const catalogue = (body: string) => surfaceEditions[body] ?? null;
  /**
   * L'édition que la SCÈNE montre, lue sur le moteur (`appliedTextureBase`) et non tenue à part : le choix
   * actif, le badge et la note ne peuvent pas diverger de la carte réellement posée.
   */
  const appliedOf = (body: string): string => {
    const cat = catalogue(body)!;
    const base = api.sceneSystem.getBody(body)?.appliedTextureBase(cat.layer);
    const edition = base?.split('__')[1];
    return edition && cat.editions.some((e) => e.edition === edition)
      ? edition
      : cat.defaultEdition;
  };
  const editionOf = (body: string, edition: string): SurfaceEdition =>
    catalogue(body)!.editions.find((e) => e.edition === edition)!;

  /** Le badge de couleur et la note de la fiche disent l'édition affichée, pas celle par défaut. */
  const syncCardTexts = (body: string): void => {
    const e = editionOf(body, appliedOf(body));
    const badge = panel.querySelector<HTMLElement>('.bi-color-nature');
    const note = panel.querySelector<HTMLElement>('.bi-surface-note');
    if (badge && !badge.hidden) {
      badge.textContent = t('bi.color.dated', {
        nature: t(`bi.color.${e.colorNature}`),
        date: day(e.from),
      });
      badge.title = `${t(`bi.color.${e.colorNature}.hint`)} ${t('bi.color.observedHint', { date: day(e.from) })}`;
      badge.setAttribute('aria-label', `${badge.textContent} : ${badge.title}`);
    }
    if (note) {
      note.textContent = [
        t('bi.surfaceNote', { date: day(e.from) }),
        e.filledShare > 0 ? t('bi.surfaceNote.filled') : '',
      ]
        .filter(Boolean)
        .join(' ');
      note.hidden = false;
    }
  };

  const describe = (body: string): void => {
    const e = editionOf(body, appliedOf(body));
    info.textContent = t('ed.info', {
      date: day(e.from),
      px: String(e.sourcePixelWidth),
      share: formatPercent(e.filledShare),
    });
    sceneDay = day(api.orbitalMechanics.simulationDate.toISOString());
    scene.textContent = t('ed.scene', { date: sceneDay });
    limits.textContent = t('ed.limits');
    const target = other && other !== appliedOf(body) ? other : null;
    compare.hidden = !target;
    if (target)
      compare.textContent = t('ed.compare', {
        date: day(editionOf(body, target).from),
      });
    box.dataset['appliedEdition'] = appliedOf(body);
  };

  const radios = (): HTMLButtonElement[] => [
    ...group.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
  ];
  const markChecked = (edition: string): void => {
    for (const r of radios()) {
      const on = r.dataset['edition'] === edition;
      r.setAttribute('aria-checked', String(on));
      r.tabIndex = on ? 0 : -1;
    }
  };

  /** Le choix affiché, la description et les textes de la fiche, alignés sur la scène (ou sur la demande en vol). */
  const refresh = (body: string): void => {
    if (shown !== body || box.hidden) return;
    markChecked(pending.get(body) ?? appliedOf(body));
    describe(body);
    syncCardTexts(body);
  };

  /** Pose une édition ; un choix plus récent rend celui-ci caduc (le moteur jette son chargement). */
  const select = async (body: string, edition: string): Promise<void> => {
    const current = appliedOf(body);
    if (edition === current && !pending.has(body)) return;
    const object = api.sceneSystem.getBody(body);
    const cat = catalogue(body);
    if (!object || !cat) return;
    const mine = ++request;
    const wanted = editionOf(body, edition);
    pending.set(body, edition);
    markChecked(edition);
    box.setAttribute('aria-busy', 'true');
    status.hidden = false;
    status.textContent = t('ed.loading', { date: day(wanted.from) });
    const ok = await object.setLayerEdition(
      cat.layer,
      texturePath(body, cat.layer, edition),
      wanted.tiers as TextureQuality[]
    );
    // Une intention plus récente (autre choix, fiche quittée) possède désormais le changement.
    if (mine !== request) return;
    pending.delete(body);
    box.removeAttribute('aria-busy');
    if (ok) {
      if (edition !== current) other = current;
      status.hidden = true;
      getAnnouncer().announce(t('ed.announce', { date: day(wanted.from) }));
    } else {
      status.textContent = t('ed.unavailable', {
        date: day(wanted.from),
        shown: day(editionOf(body, appliedOf(body)).from),
      });
    }
    refresh(body);
  };

  /**
   * Rend l'édition par défaut d'un corps quand sa fiche n'est plus affichée, y compris quand une demande est
   * encore EN VOL : sans cela, elle arriverait fiche fermée et poserait sa carte sur la scène.
   */
  const restore = (body: string): void => {
    const cat = catalogue(body);
    if (!cat) return;
    if (!pending.has(body) && appliedOf(body) === cat.defaultEdition) return;
    request++;
    pending.delete(body);
    box.removeAttribute('aria-busy');
    status.hidden = true;
    other = null;
    const e = editionOf(body, cat.defaultEdition);
    void api.sceneSystem
      .getBody(body)
      ?.setLayerEdition(
        cat.layer,
        texturePath(body, cat.layer, cat.defaultEdition),
        e.tiers as TextureQuality[]
      );
  };

  group.addEventListener('keydown', (event) => {
    const list = radios();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0 || !shown) return;
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const next = list[(at + step + list.length) % list.length]!;
    next.focus();
    void select(shown, next.dataset['edition']!);
  });
  compare.addEventListener('click', () => {
    if (shown && other) void select(shown, other);
  });

  const render = (current: string | null): void => {
    if (shown && shown !== current) restore(shown);
    shown = current;
    const cat = current ? catalogue(current) : null;
    if (!current || !cat || cat.editions.length < 2) {
      box.hidden = true;
      return;
    }
    title.textContent = t('ed.title');
    group.replaceChildren(
      ...cat.editions.map((e) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'bi-editions-option';
        b.setAttribute('role', 'radio');
        b.dataset['edition'] = e.edition;
        b.textContent = day(e.from);
        b.addEventListener('click', () => void select(current, e.edition));
        return b;
      })
    );
    tracked = current;
    box.hidden = false;
    status.hidden = !pending.has(current);
    refresh(current);
  };

  let last = 0;
  api.animationSystem.onFrame(() => {
    // Ce que la SCÈNE montre (la carte posée), distinct de ce que le bloc a demandé, publié à CHAQUE image
    // (une lecture de table) : un chargement tardif d'une édition abandonnée, même pendant une image, s'y
    // verrait. Le reste du bloc suit la cadence de 500 ms.
    // Publié aussi fiche FERMÉE pour le dernier corps montré : la planète reste dans la scène.
    const watched = shown ?? tracked;
    if (watched) {
      const cat = catalogue(watched);
      const base = cat
        ? api.sceneSystem.getBody(watched)?.appliedTextureBase(cat.layer)
        : undefined;
      const edition = base?.split('__')[1] ?? '';
      if (box.dataset['sceneEdition'] !== edition) {
        box.dataset['sceneEdition'] = edition;
        // La scène a changé (restauration finie, LOD) : le bloc la suit.
        if (shown === watched && !pending.has(watched)) refresh(watched);
      }
    }
    const at = performance.now();
    if (at - last < 500) return;
    last = at;
    const current = bodyInfo.currentBody();
    if (current !== shown) render(current);
    else if (
      current &&
      !box.hidden &&
      day(api.orbitalMechanics.simulationDate.toISOString()) !== sceneDay
    )
      describe(current);
  });
  onLocaleChange(() => render(shown));
}
