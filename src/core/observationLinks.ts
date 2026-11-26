/**
 * L'OBSERVATION INTERCONNECTÉE (GAL-OBSERVATION-001) : depuis un corps ou une sonde, les expériences de Galaxy
 * qui le concernent RÉELLEMENT. Pur, sans DOM.
 *
 * Aucune relation n'est écrite à la main : chacune est LUE dans un registre ou un catalogue déjà livré.
 *  - visite → corps et lieux : le catalogue des visites, dérivé de leurs étapes (`flyTo`, `diveTo`) ;
 *  - sonde ↔ corps : l'index de la recherche universelle (`public/assets/search/index.json`), lui-même dérivé
 *    des éphémérides (survols et mises en orbite détectés, contacts, à la seconde) et du registre fédéré des
 *    missions du PDS (une mission déclarée pour un corps) ;
 *  - inspection 3D : le registre des modèles d'engins (`registry/craft/models.json`, `targets`) ;
 *  - événements : le corps sur lequel la caméra se recadre pour un événement (`eventFocusBody`) ;
 *  - Terre → satellites en orbite, Soleil → voisinage solaire : les deux couches qui portent ces objets.
 * Une sonde reliée sans preuve (aucune ligne de ces fichiers) n'apparaît pas.
 */
import type { SearchIndexFile } from './search';

/** Ce qui relie une sonde à un corps, du plus fort au plus faible (on ne garde que le plus fort). */
export type ProbeRelation = 'orbit' | 'contact' | 'flyby' | 'mission';
const RELATION_RANK: Record<ProbeRelation, number> = {
  orbit: 0,
  contact: 1,
  flyby: 2,
  mission: 3,
};

export type ObservationLink =
  /** Une visite guidée qui rejoint ce corps (ou y plonge vers `place`). */
  | { kind: 'tour'; tour: string; place: string | null }
  /** Une sonde reliée à ce corps, avec la preuve et sa date ; `model` : l'inspection 3D existe. */
  | {
      kind: 'probe';
      probe: string;
      relation: ProbeRelation;
      at: string | null;
      model: string | null;
    }
  /** Un corps qu'une sonde a rejoint (depuis la fiche de la sonde). */
  | { kind: 'body'; body: string; relation: ProbeRelation; at: string | null }
  /** Le panneau des événements, avec le prochain qui concerne ce corps. */
  | { kind: 'events'; nextAt: string; eventKind: string }
  /** La couche des satellites en orbite (Terre). */
  | { kind: 'satellites' }
  /** La vue 3D du voisinage solaire (Soleil). */
  | { kind: 'neighbourhood' };

export interface TourReach {
  id: string;
  bodies: readonly string[];
  places: readonly { body: string; name: string }[];
}

export interface CraftModelTargets {
  id: string;
  targets: readonly string[];
}

export interface ObservationData {
  index: SearchIndexFile | null;
  tours: readonly TourReach[];
  craft: readonly CraftModelTargets[];
  /** Le prochain événement dont le corps de recadrage est ce corps, s'il y en a un dans la fenêtre. */
  nextEvent?: { at: string; kind: string } | null;
  /** Le corps qui porte la couche des satellites, et l'étoile du voisinage solaire. */
  satellitesBody?: string;
  neighbourhoodBody?: string;
  /**
   * Les phases où une sonde est le satellite d'un corps (`SpacecraftMission.satelliteOf`, dérivées des
   * binaires) : elles DATENT une relation « mission » que l'index ne date pas (Hayabusa2 à Ryugu).
   */
  phases?: Readonly<
    Record<string, readonly { body: string; fromMs: number }[]>
  >;
}

/** Les liens sonde ↔ corps de l'index, avec la plus forte relation et sa première date. */
function probeBodyPairs(
  index: SearchIndexFile | null,
  phases: ObservationData['phases'] = {}
): Array<{
  probe: string;
  body: string;
  relation: ProbeRelation;
  at: string | null;
}> {
  if (!index) return [];
  const out: Array<{
    probe: string;
    body: string;
    relation: ProbeRelation;
    at: string | null;
  }> = [];
  for (const [probe, body, at] of index.orbitInsertions ?? [])
    out.push({ probe, body, relation: 'orbit', at });
  for (const [probe, body, at] of index.contacts ?? [])
    out.push({ probe, body, relation: 'contact', at });
  for (const [probe, body, at] of index.flybys ?? [])
    out.push({ probe, body, relation: 'flyby', at });
  for (const [, , probe, body] of index.missions ?? [])
    if (probe && body) {
      const phase = phases[probe]?.find((p) => p.body === body);
      out.push({
        probe,
        body,
        relation: 'mission',
        at: phase ? new Date(phase.fromMs).toISOString() : null,
      });
    }
  // Une seule ligne par couple, la plus forte ; à force égale, la plus ancienne.
  const best = new Map<string, (typeof out)[number]>();
  for (const pair of out) {
    const key = `${pair.probe}|${pair.body}`;
    const kept = best.get(key);
    if (
      !kept ||
      RELATION_RANK[pair.relation] < RELATION_RANK[kept.relation] ||
      (pair.relation === kept.relation &&
        pair.at !== null &&
        (kept.at === null || pair.at < kept.at))
    )
      best.set(key, pair);
  }
  return [...best.values()];
}

const byRelationThenDate = <
  T extends { relation: ProbeRelation; at: string | null },
>(
  a: T,
  b: T
): number =>
  RELATION_RANK[a.relation] - RELATION_RANK[b.relation] ||
  (a.at ?? '9999').localeCompare(b.at ?? '9999');

/** Les liens d'un CORPS : visites, sondes, événements, couches. */
export function bodyLinks(
  body: string,
  data: ObservationData
): ObservationLink[] {
  const links: ObservationLink[] = [];
  for (const tour of data.tours) {
    if (!tour.bodies.includes(body)) continue;
    const place = tour.places.find((p) => p.body === body)?.name ?? null;
    links.push({ kind: 'tour', tour: tour.id, place });
  }
  const modelOf = (probe: string): string | null =>
    data.craft.find((m) => m.targets.includes(probe))?.id ?? null;
  for (const pair of probeBodyPairs(data.index, data.phases)
    .filter((p) => p.body === body)
    .sort(byRelationThenDate))
    links.push({
      kind: 'probe',
      probe: pair.probe,
      relation: pair.relation,
      at: pair.at,
      model: modelOf(pair.probe),
    });
  if (data.nextEvent)
    links.push({
      kind: 'events',
      nextAt: data.nextEvent.at,
      eventKind: data.nextEvent.kind,
    });
  if (body === (data.satellitesBody ?? 'earth'))
    links.push({ kind: 'satellites' });
  if (body === (data.neighbourhoodBody ?? 'sun'))
    links.push({ kind: 'neighbourhood' });
  return links;
}

/** Les liens d'une SONDE : les corps qu'elle a rejoints, par la preuve la plus forte. */
export function probeLinks(
  probe: string,
  data: ObservationData
): ObservationLink[] {
  return probeBodyPairs(data.index, data.phases)
    .filter((p) => p.probe === probe)
    .sort(byRelationThenDate)
    .map((p) => ({
      kind: 'body',
      body: p.body,
      relation: p.relation,
      at: p.at,
    }));
}
