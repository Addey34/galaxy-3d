/**
 * LE BLOC « VILLES EN 3D » DE LA FICHE DE LA TERRE : les villes dont les bâtiments sont livrés, et
 * un bouton par ville qui y plonge. Avant lui, une ville en 3D ne se découvrait qu'en y étant déjà
 * (recherche d'un nom, puis des dizaines de crans de molette) : rien ne disait qu'elle existait.
 *
 * LA LISTE EST LUE, JAMAIS RECOPIÉE : c'est l'index publié par le cuiseur
 * (`public/assets/buildings/index.json`, le même que lit la couche de bâtiments), donc une ville
 * ajoutée au cuiseur apparaît ici avec son nom de dictionnaire (`bi.cities.name.<id>`, gardé par
 * `citiesBlock.test.ts`). Rien n'est demandé au démarrage ni à l'ouverture d'une fiche autre que
 * celle de la Terre.
 */
import {
  parseBuildingSetIndex,
  type BuildingSetIndex,
} from '@/config/buildingSets';
import { EARTH_NAMES_BODY } from '@/core/earthNames';
import { onLocaleChange, t } from '@/i18n';
import type { PublicAPI } from '@/SolarSystemApp';
import type { BodyInfoPanel } from './bodyInfo';
import { getAnnouncer } from './announcer';
import { requestPlaceDive } from './placeDive';

/**
 * Diamètre (km) que la ville occupe à l'arrivée : une plongée à ce cadrage s'arrête vers 7 km
 * d'altitude, où la couche de bâtiments se pose (mesuré à Paris, Berlin et Nairobi).
 */
export const CITY_FRAME_KM = 3;

/** Le centre d'une emprise (longitude, latitude en degrés). */
export function centreOf(bbox: readonly [number, number, number, number]): {
  lon: number;
  lat: number;
} {
  return { lon: (bbox[0] + bbox[2]) / 2, lat: (bbox[1] + bbox[3]) / 2 };
}

/** La clé de dictionnaire du nom d'une ville, d'après l'identifiant de son jeu. */
export const cityNameKey = (id: string): string => `bi.cities.name.${id}`;

export function setupCitiesBlock(
  api: PublicAPI,
  bodyInfo: BodyInfoPanel
): void {
  const panel = document.getElementById('body-info');
  const block = panel?.querySelector<HTMLDetailsElement>('.bi-cities');
  const label = block?.querySelector<HTMLElement>('.bi-cities-label');
  const hint = block?.querySelector<HTMLElement>('.bi-cities-hint');
  const list = block?.querySelector<HTMLUListElement>('.bi-cities-list');
  if (!block || !label || !hint || !list) return;

  let index: BuildingSetIndex | null = null;
  let state: 'idle' | 'loading' | 'failed' = 'idle';
  let retryAt = 0;

  const render = (): void => {
    if (!index) return;
    const earth = index.sets.filter((set) => set.body === EARTH_NAMES_BODY);
    label.textContent = `${t('bi.cities.label')} (${earth.length})`;
    hint.textContent = t('bi.cities.hint');
    list.replaceChildren();
    for (const set of earth) {
      const city = t(cityNameKey(set.id));
      const { lon, lat } = centreOf(set.bboxLonLat);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'bi-city';
      button.dataset['set'] = set.id;
      button.textContent = city;
      button.setAttribute('aria-label', t('bi.cities.go', { city }));
      button.addEventListener('click', () => {
        const started = requestPlaceDive({
          body: EARTH_NAMES_BODY,
          name: city,
          lat,
          lon,
          diameterKm: CITY_FRAME_KM,
        });
        if (started) getAnnouncer().announce(t('bi.cities.diving', { city }));
      });
      const item = document.createElement('li');
      item.append(button);
      list.append(item);
    }
    block.hidden = earth.length === 0;
  };

  const load = (): void => {
    state = 'loading';
    fetch(`${location.origin}/assets/buildings/index.json`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<unknown>;
      })
      .then((json) => {
        index = parseBuildingSetIndex(json);
        state = 'idle';
        if (bodyInfo.currentBody() === EARTH_NAMES_BODY) render();
      })
      .catch(() => {
        // Pas de liste : le bloc reste masqué, et on retente plus tard plutôt qu'à chaque image.
        state = 'failed';
        retryAt = performance.now() + 30_000;
      });
  };

  const sync = (): void => {
    if (bodyInfo.currentBody() !== EARTH_NAMES_BODY) {
      block.hidden = true;
      return;
    }
    if (index) {
      if (block.hidden && list.childElementCount === 0) render();
      else block.hidden = false;
      return;
    }
    if (state === 'loading') return;
    if (state === 'failed' && performance.now() < retryAt) return;
    load();
  };

  let lastCheck = 0;
  api.animationSystem.onFrame(() => {
    const at = performance.now();
    if (at - lastCheck < 500) return;
    lastCheck = at;
    sync();
  });
  onLocaleChange(() => {
    if (index && bodyInfo.currentBody() === EARTH_NAMES_BODY) render();
  });
}
