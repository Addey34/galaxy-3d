import { describe, expect, it } from 'vitest';
import {
  earthquakeLayer,
  earthquakeToEvent,
  naturalEventLayer,
  naturalEventToEvent,
} from './earthEventLayers';
import { topEvents } from './earthEvents';
import { classifyTemporal } from './temporal';
import { EVENT_PROVIDERS } from '@/registry/providers/events';
import { messages } from '@/i18n/locales';

const NOW = new Date('2026-09-20T12:00:00Z');

const quake = (magnitude: number, timeMs: number) => ({
  id: `q-${magnitude}`,
  magnitude,
  latitudeDeg: 0,
  longitudeDeg: 0,
  depthKm: 10,
  timeMs,
  place: '',
});

describe('un séisme est une MESURE, un événement EONET un RAPPORT', () => {
  it('classe un séisme passé comme observé', () => {
    const event = earthquakeToEvent(
      quake(7.1, Date.parse('2026-09-18T00:00:00Z'))
    );
    expect(event.product.kind).toBe('measurement');
    expect(
      classifyTemporal(event.product, new Date('2026-09-18T00:00:00Z'), NOW)
        .category
    ).toBe('observed');
  });

  it('classe un événement EONET passé comme rapporté, jamais observé', () => {
    const event = naturalEventToEvent({
      id: 'EONET_1',
      title: 'Wildfire',
      categoryId: 'wildfires',
      categoryTitle: 'Wildfires',
      latitudeDeg: 0,
      longitudeDeg: 0,
      startMs: Date.parse('2026-09-10T00:00:00Z'),
      reportedMs: Date.parse('2026-09-14T00:00:00Z'),
      closedMs: Date.parse('2026-09-15T00:00:00Z'),
    });
    expect(event.product.kind).toBe('report');
    const stamp = classifyTemporal(
      event.product,
      new Date('2026-09-12T00:00:00Z'),
      NOW
    );
    expect(stamp.category).toBe('reported');
    expect(stamp.ongoing).toBe(false);
  });

  it('marque « en cours » un événement qu’EONET n’a pas clos, sans inventer de fin', () => {
    const event = naturalEventToEvent({
      id: 'EONET_2',
      title: 'Volcano',
      categoryId: 'volcanoes',
      categoryTitle: 'Volcanoes',
      latitudeDeg: 0,
      longitudeDeg: 0,
      startMs: Date.parse('2026-09-10T00:00:00Z'),
      reportedMs: Date.parse('2026-09-14T00:00:00Z'),
      closedMs: null,
    });
    expect(event.product.openEnded).toBe(true);
    // La fin retenue reste le dernier relevé CONNU : rien n'a été fabriqué au-delà.
    expect(event.product.validTime.to).toBe(Date.parse('2026-09-14T00:00:00Z'));
    const stamp = classifyTemporal(event.product, NOW, NOW);
    expect(stamp.ongoing).toBe(true);
    // La scène est APRÈS le dernier relevé, et pourtant sans écart : l'événement n'est pas
    // fini, donc l'intervalle la contient. C'est l'information, pas un trou comblé.
    expect(stamp.offset).toBe(false);
  });
});

describe('poids visuel', () => {
  it('croît avec la magnitude et sature aux extrêmes', () => {
    expect(earthquakeToEvent(quake(4.5, 0)).weight).toBe(0);
    expect(earthquakeToEvent(quake(3, 0)).weight).toBe(0);
    expect(earthquakeToEvent(quake(9.5, 0)).weight).toBe(1);
    expect(earthquakeToEvent(quake(10, 0)).weight).toBe(1);
    expect(earthquakeToEvent(quake(7, 0)).weight).toBeGreaterThan(
      earthquakeToEvent(quake(6, 0)).weight
    );
  });

  it('ordonne la liste et les marqueurs sur le même critère', () => {
    const events = [5.0, 8.2, 6.4].map((m) => earthquakeToEvent(quake(m, 0)));
    expect(topEvents(events, 2).map((e) => e.label)).toEqual(['M8.2', 'M6.4']);
  });
});

describe('déclaration des deux couches', () => {
  const layers = [earthquakeLayer(), naturalEventLayer()];

  it('cite une fiche de fournisseur qui existe', () => {
    for (const layer of layers) {
      expect(Object.keys(EVENT_PROVIDERS), `fiche de ${layer.id}`).toContain(
        layer.providerId
      );
    }
  });

  it('a un libellé et une note traduits dans les deux langues', () => {
    for (const layer of layers) {
      for (const locale of ['en', 'fr'] as const) {
        expect(messages[locale][layer.labelKey], layer.labelKey).toBeTruthy();
        expect(messages[locale][layer.noteKey], layer.noteKey).toBeTruthy();
      }
    }
  });

  it('interpole ses nombres depuis les constantes, pas depuis le dictionnaire', () => {
    // Le texte publié ne doit porter AUCUN nombre retapé : chaque valeur citée dans la note
    // est une variable, remplie par la constante que la requête emploie réellement.
    for (const layer of layers) {
      for (const locale of ['en', 'fr'] as const) {
        const raw = messages[locale][layer.noteKey]!;
        for (const name of Object.keys(layer.noteVars)) {
          expect(raw, `${layer.noteKey} (${locale})`).toContain(`{${name}}`);
        }
      }
    }
  });

  it('ne crie pas à l’écart pour une horloge qui a avancé de cinq secondes', async () => {
    // La fenêtre est figée à l'instant du chargement, l'horloge de la scène continue : sans
    // tolérance, le badge annonçait « scène au … » au bout de quelques secondes de lecture.
    // Défaut réellement observé à l'écran, sur le panneau mobile.
    const simulation = new Date('2026-09-18T00:00:00Z');
    for (const layer of layers) {
      const batch = await layer.fetch(simulation, NOW);
      const later = new Date(simulation.getTime() + 5_000);
      expect(
        classifyTemporal(batch.candidate.product!, later, NOW).offset,
        layer.id
      ).toBe(false);
      // Une scène vraiment ailleurs reste signalée.
      expect(
        classifyTemporal(
          batch.candidate.product!,
          new Date('2030-01-01T00:00:00Z'),
          NOW
        ).offset,
        layer.id
      ).toBe(true);
    }
  });

  it('rend un lot vide, jamais une erreur, hors de la couverture déclarée', async () => {
    for (const layer of layers) {
      const ancient = new Date('1800-01-01T00:00:00Z');
      expect(layer.keyForDate(ancient, NOW)).toBeNull();
      const batch = await layer.fetch(ancient, NOW);
      expect(batch.events).toEqual([]);
      expect(batch.candidate.product).toBeNull();
    }
  });
});
