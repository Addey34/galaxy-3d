/**
 * L'ASSEMBLAGE DU VOLUME STELLAIRE À L'EXÉCUTION (GAL-UNIVERSE-008, séparation des données). Pur, sans
 * DOM ni réseau.
 *
 * Les fournisseurs n'ont pas les mêmes droits et ne partagent plus aucun fichier :
 *   - `gcns/` : le Gaia Catalogue of Nearby Stars (CC BY-NC 4.0, sur les données de Gaia de l'ESA) ;
 *     coquilles binaires et paquets de détails, rien d'autre que ses valeurs ;
 *   - `gcns-missing/` : la liste du GCNS des objets absents d'EDR3, positions et parallaxes de SIMBAD ;
 *   - `hyg/` : HYG v4.4 (CC BY-SA 4.0) : les étoiles très brillantes absentes de Gaia, et les noms ;
 *   - `nasa/` : les hôtes d'exoplanètes de la NASA Exoplanet Archive (identifiant Gaia DR3, planètes) ;
 *   - `crossmatch*.json` : les TABLES DE CORRESPONDANCE de Galaxy, des identifiants seulement (rang dans
 *     le GCNS, rang dans la liste des absentes, identifiant HYG, rang dans la table de la NASA), aucune
 *     valeur d'un catalogue. Chacune déclare les empreintes des fichiers qu'elle relie (`binds`) : si un
 *     fournisseur est remplacé sans que la table soit refaite, la jointure est REFUSÉE (et dite), au
 *     lieu de coller un nom ou un hôte sur la mauvaise étoile.
 *
 * Ce module refait en mémoire ce que le générateur livrait fusionné : des coquilles au format de
 * `core/stellarVolume.ts` (16 octets par étoile, donc `decodeShell` et le rendu sont inchangés), les
 * détails, les noms. Disposition d'une coquille : les étoiles du GCNS de la coquille (ordre du fichier,
 * donc de distance), sans les doublons du voisinage à 5 pc, PUIS les absentes de Gaia de la coquille,
 * par distance. Un fournisseur désactivé (`enabled: false` dans l'index) ou illisible retire sa part :
 * sans HYG les absentes gardent la position et la parallaxe de SIMBAD ; sans la liste des absentes, il
 * n'y a que le GCNS ; sans le GCNS, que les absentes ; sans la NASA, aucun hôte ; le moteur tourne.
 */
import type {
  VolumeDetail,
  VolumeFlags,
  VolumeManifest,
  VolumeNameEntry,
} from './stellarVolume';

/** Un fichier livré et son empreinte (SHA-256 des octets). */
export interface VolumeFileEntry {
  file: string;
  bytes: number;
  sha256: string;
}

/** Les droits d'un fournisseur, tels que l'index et la notice de son dossier les écrivent. */
export interface VolumeProviderRights {
  name: string;
  license: string;
  licenseUrl: string;
  rightsHolder: string;
  notice: string;
  /** `false` : le fournisseur est désactivé ; le client n'en charge rien. */
  enabled?: boolean;
  /** Empreinte du fournisseur (de ses fichiers) : ce que les tables de correspondance déclarent relier. */
  sha256: string;
}

export interface VolumeIndex {
  format: {
    epochYear: number;
    recordBytes: number;
    detailBytes: number;
    detailBucket: number;
    positionScale: number;
    velocityScale: number;
    flags: VolumeFlags;
    maxDistancePc: number;
    frame: string;
  };
  providers: {
    gcns: VolumeProviderRights & {
      shells: Array<VolumeFileEntry & { maxPc: number; count: number }>;
      details: VolumeFileEntry[];
    };
    gcnsMissing: VolumeProviderRights & VolumeFileEntry;
    hyg: VolumeProviderRights & {
      complement: VolumeFileEntry;
      names: VolumeFileEntry;
    };
    nasa: VolumeProviderRights & VolumeFileEntry;
  };
  crossmatch: { structure: VolumeFileEntry; names: VolumeFileEntry };
  /** Ce que l'assemblage doit produire quand tous les fournisseurs sont là (tenu par les tests). */
  expected: {
    count: number;
    perShell: number[];
    counts: Record<string, number>;
  };
  source: Record<string, Record<string, string>>;
  witnesses: VolumeManifest['witnesses'];
}

/** `gcns-missing/missing.json` : la table `gcns.missing_10mas` (valeurs de SIMBAD). */
export interface MissingFile {
  fields: string[];
  rows: Array<
    [mainId: string, raDeg: number, decDeg: number, parallaxMas: number]
  >;
}

/** `hyg/complement.json` : les lignes de HYG des étoiles absentes de Gaia (valeurs de HYG seules). */
export interface HygComplementFile {
  fields: string[];
  rows: Array<
    [
      hygId: number,
      name: string | null,
      spectral: string | null,
      raDeg: number,
      decDeg: number,
      distPc: number,
      vmag: number | null,
      bv: number | null,
      pmRaMas: number,
      pmDecMas: number,
      rvKms: number | null,
    ]
  >;
}

/** `hyg/names.json` : identifiant HYG et nom lisible (nom propre, Bayer, Flamsteed, Gliese, HD, HIP). */
export interface HygNamesFile {
  fields: string[];
  rows: Array<[hygId: number, name: string]>;
}

/** `nasa/hosts.json` : un hôte d'exoplanètes par ligne (identifiant Gaia DR3, nom, planètes de l'hôte). */
export interface NasaHostsFile {
  fields: string[];
  rows: Array<[gaiaDr3Id: string, host: string, planets: number]>;
}

/** `crossmatch.json` : correspondances de Galaxy, identifiants seulement. */
export interface CrossmatchFile {
  binds: Record<string, string>;
  /** Rangs du GCNS qui sont une étoile du voisinage à 5 pc (déjà dans la vue). */
  hiddenGcns: number[];
  /** Rangs de la liste des absentes qui sont une étoile du voisinage. */
  hiddenMissing: number[];
  /** Absente de Gaia → sa ligne HYG : [rang dans la liste, identifiant HYG]. */
  missingHyg: Array<[number, number]>;
  /** Étoile du GCNS → hôte de la NASA : [rang dans le GCNS, rang dans `nasa/hosts.json`]. */
  hostGcns: Array<[number, number]>;
}

/** `crossmatch-names.json` : étoile du GCNS → ligne HYG qui la nomme. */
export interface CrossmatchNamesFile {
  binds: Record<string, string>;
  pairs: Array<[gcnsIndex: number, hygId: number]>;
}

export interface VolumeSources {
  index: VolumeIndex;
  /** `false` : fournisseur désactivé ou ses coquilles inaccessibles par décision. */
  gcns: boolean;
  missing: MissingFile | null;
  hygComplement: HygComplementFile | null;
  nasa: NasaHostsFile | null;
  crossmatch: CrossmatchFile | null;
}

/** Où lire les détails d'une étoile : un paquet du GCNS, ou des détails déjà connus (absente de Gaia). */
export type DetailSource =
  | { kind: 'gcns'; file: string; local: number }
  | { kind: 'known'; detail: VolumeDetail };

export interface VolumeAssembly {
  /** Au format attendu par la vue : coquilles fusionnées (rang global), drapeaux, comptes. */
  manifest: VolumeManifest;
  /** Le fichier de coquille du GCNS à télécharger pour la coquille `k`, ou `null` (rien à lire). */
  gcnsShellFile(k: number): string | null;
  /** La coquille `k` fusionnée, au format binaire de `decodeShell`. */
  shellBuffer(k: number, gcnsBuffer: ArrayBuffer | null): ArrayBuffer;
  detailSource(index: number): DetailSource | null;
  /** Noms connus sans HYG : absentes de Gaia (HYG ou SIMBAD) et hôtes d'exoplanètes. */
  baseNames: Record<string, VolumeNameEntry>;
  /** Les noms complets, une fois les noms de HYG et leur table lus (`null` si la table est refusée). */
  withHygNames(
    names: HygNamesFile | null,
    pairs: CrossmatchNamesFile | null
  ): { names: Record<string, VolumeNameEntry>; fromHyg: ReadonlySet<number> };
  /** Rang global → rang dans le GCNS (−1 pour une absente de Gaia). */
  gcnsIndexOf(index: number): number;
  /** Rang dans le GCNS → rang global (−1 : doublon du voisinage, caché). */
  globalIndexOf(gcnsIndex: number): number;
  /** Les fournisseurs qui n'ont pas contribué (désactivés, illisibles, ou table de correspondance refusée). */
  missingParts: readonly string[];
}

/** Constante astrométrique : km/s pour 1″/an à 1 pc (même valeur que le générateur). */
const K_ASTRO = 4.740470446;
const RAD = Math.PI / 180;

/** Position (pc) et vitesse (km/s) ÉQUATORIALES : mêmes calculs que `stateOf` du générateur. */
export function equatorialState(
  raDeg: number,
  decDeg: number,
  distPc: number,
  pmRa: number,
  pmDec: number,
  rvKms: number
): { position: number[]; velocity: number[] } {
  const a = raDeg * RAD;
  const d = decDeg * RAD;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const cd = Math.cos(d);
  const sd = Math.sin(d);
  const r = [cd * ca, cd * sa, sd];
  const ea = [-sa, ca, 0];
  const ed = [-sd * ca, -sd * sa, cd];
  const vRa = (K_ASTRO * pmRa * distPc) / 1000;
  const vDec = (K_ASTRO * pmDec * distPc) / 1000;
  const vr = Number.isFinite(rvKms) ? rvKms : 0;
  return {
    position: r.map((c) => c * distPc),
    velocity: [0, 1, 2].map((i) => vr * r[i]! + vRa * ea[i]! + vDec * ed[i]!),
  };
}

const clampInt = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, Math.round(v)));

interface Complement {
  distPc: number;
  position: number[];
  velocity: number[] | null;
  mag: number;
  colour: number;
  flags: number;
  parallax: number;
  name: string;
  spectral: string | null;
}

/** Une étoile en 16 octets : même codage que `encodeRecord` du générateur. */
function encodeRecord(
  view: DataView,
  offset: number,
  s: Complement,
  format: VolumeIndex['format']
): void {
  for (let i = 0; i < 3; i++) {
    view.setInt16(
      offset + 2 * i,
      clampInt(s.position[i]! * format.positionScale, -32767, 32767),
      true
    );
    view.setInt16(
      offset + 6 + 2 * i,
      clampInt((s.velocity?.[i] ?? 0) * format.velocityScale, -32767, 32767),
      true
    );
  }
  view.setUint8(
    offset + 12,
    Number.isFinite(s.mag) ? clampInt(s.mag * 10, 0, 254) : 255
  );
  view.setInt8(
    offset + 13,
    Number.isFinite(s.colour) ? clampInt(s.colour * 25, -127, 127) : -128
  );
  view.setUint8(offset + 14, s.flags);
  view.setUint8(offset + 15, 255);
}

/** Position ramenée à une autre époque par le mouvement propre (mas/an, pmRa × cos δ). */
function propagate(
  raDeg: number,
  decDeg: number,
  pmRa: number,
  pmDec: number,
  years: number
): { raDeg: number; decDeg: number } {
  const cosDec = Math.cos(decDeg * RAD);
  return {
    raDeg: raDeg + (pmRa * years) / 3.6e6 / cosDec,
    decDeg: decDeg + (pmDec * years) / 3.6e6,
  };
}

/** Vrai si une table de correspondance relie bien les fournisseurs tels qu'ils sont livrés. */
export function bindsMatch(
  binds: Record<string, string>,
  index: VolumeIndex,
  ids: ReadonlyArray<keyof VolumeIndex['providers']>
): boolean {
  return ids.every((id) => binds[id] === index.providers[id].sha256);
}

export function assembleVolume(sources: VolumeSources): VolumeAssembly {
  const { index } = sources;
  const format = index.format;
  const F = format.flags;
  const P = index.providers;
  const missingParts: string[] = [];
  const gcnsOn = sources.gcns && P.gcns.enabled !== false;
  if (!gcnsOn) missingParts.push('gcns');
  const missing = P.gcnsMissing.enabled === false ? null : sources.missing;
  if (!missing) missingParts.push('gcnsMissing');
  const hygComplement = P.hyg.enabled === false ? null : sources.hygComplement;
  if (!hygComplement) missingParts.push('hyg');
  const nasa = P.nasa.enabled === false ? null : sources.nasa;
  if (!nasa) missingParts.push('nasa');
  const cross = sources.crossmatch;
  if (!cross) missingParts.push('crossmatch');
  const use = (ids: ReadonlyArray<keyof VolumeIndex['providers']>): boolean => {
    if (!cross) return false;
    if (bindsMatch(cross.binds, index, ids)) return true;
    missingParts.push(`crossmatch:${ids.join('+')}`);
    return false;
  };

  // ---- le GCNS : rangs par coquille, sans les doublons du voisinage
  const hidden = new Set(
    gcnsOn && use(['gcns']) ? cross!.hiddenGcns : ([] as number[])
  );
  const gcnsShells = gcnsOn ? P.gcns.shells : P.gcns.shells.map(() => null);
  let gcnsStart = 0;
  const gcnsKept: number[][] = [];
  for (const s of gcnsShells) {
    const kept: number[] = [];
    if (s) {
      for (let i = gcnsStart; i < gcnsStart + s.count; i++)
        if (!hidden.has(i)) kept.push(i);
      gcnsStart += s.count;
    }
    gcnsKept.push(kept);
  }
  const gcnsTotal = gcnsStart;

  // ---- les hôtes d'exoplanètes, par la table de Galaxy (rang GCNS → rang NASA)
  const hostOfGcns = new Map<number, { host: string; planets: number }>();
  if (gcnsOn && nasa && use(['gcns', 'nasa']))
    for (const [g, row] of cross!.hostGcns) {
      const r = nasa.rows[row];
      if (r) hostOfGcns.set(g, { host: r[1], planets: r[2] });
    }

  // ---- les absentes de Gaia : ligne HYG si la table la donne, sinon SIMBAD seul
  const complement: Complement[] = [];
  if (missing) {
    const hiddenMissing = new Set(
      use(['gcnsMissing']) ? cross!.hiddenMissing : ([] as number[])
    );
    const hygOf = new Map<number, number>();
    if (hygComplement && use(['gcnsMissing', 'hyg']))
      for (const [m, h] of cross!.missingHyg) hygOf.set(m, h);
    const hygRows = new Map(hygComplement?.rows.map((r) => [r[0], r]) ?? []);
    missing.rows.forEach((m, mi) => {
      const plx = m[3];
      if (!(plx >= 1000 / format.maxDistancePc) || hiddenMissing.has(mi))
        return;
      const h = hygOf.has(mi) ? hygRows.get(hygOf.get(mi)!) : undefined;
      if (h) {
        const rv = h[10] ?? NaN;
        const at = propagate(h[3], h[4], h[8], h[9], format.epochYear - 2000);
        const state = equatorialState(
          at.raDeg,
          at.decDeg,
          h[5],
          h[8],
          h[9],
          rv
        );
        complement.push({
          distPc: h[5],
          position: state.position,
          velocity: state.velocity,
          mag: h[6] ?? NaN,
          colour: h[7] ?? NaN,
          flags:
            F.hyg | F.colourBV | (Number.isFinite(rv) ? F.radialVelocity : 0),
          parallax: 1000 / h[5],
          name: h[1] ?? m[0],
          spectral: h[2],
        });
      } else {
        const dist = 1000 / plx;
        const state = equatorialState(m[1], m[2], dist, 0, 0, NaN);
        complement.push({
          distPc: dist,
          position: state.position,
          velocity: null,
          mag: NaN,
          colour: NaN,
          flags: F.simbadOnly,
          parallax: plx,
          name: m[0],
          spectral: null,
        });
      }
    });
  }
  // La distance retenue fait foi : une ligne HYG au-delà de 100 pc sort du volume.
  const kept = complement
    .filter((c) => c.distPc <= format.maxDistancePc)
    .sort((a, b) => a.distPc - b.distPc);
  const complementOf: Complement[][] = P.gcns.shells.map(() => []);
  for (const c of kept) {
    const k = P.gcns.shells.findIndex((s) => c.distPc <= s.maxPc);
    complementOf[k]!.push(c);
  }

  // ---- la disposition globale
  const shells: VolumeManifest['shells'] = [];
  const gcnsToGlobal = new Int32Array(gcnsTotal).fill(-1);
  const globalCount = gcnsKept.reduce(
    (n, g, k) => n + g.length + complementOf[k]!.length,
    0
  );
  const globalToGcns = new Int32Array(globalCount).fill(-1);
  const complementAt = new Map<number, Complement>();
  let start = 0;
  P.gcns.shells.forEach((s, k) => {
    const g = gcnsKept[k]!;
    g.forEach((gi, j) => {
      gcnsToGlobal[gi] = start + j;
      globalToGcns[start + j] = gi;
    });
    complementOf[k]!.forEach((c, j) =>
      complementAt.set(start + g.length + j, c)
    );
    const count = g.length + complementOf[k]!.length;
    shells.push({
      maxPc: s.maxPc,
      file: gcnsOn ? s.file : '',
      start,
      count,
      bytes: count * format.recordBytes,
      sha256: '',
    });
    start += count;
  });

  // ---- noms connus sans HYG : absentes et hôtes
  const baseNames: Record<string, VolumeNameEntry> = {};
  for (const [g, host] of hostOfGcns) {
    const at = gcnsToGlobal[g]!;
    if (at >= 0) baseNames[at] = [host.host, host.host, host.planets];
  }
  for (const [at, c] of complementAt)
    baseNames[at] = c.spectral ? [c.name, null, 0, c.spectral] : [c.name];

  const count = (pred: (c: Complement) => boolean): number =>
    kept.filter(pred).length;
  const manifest: VolumeManifest = {
    epochYear: format.epochYear,
    recordBytes: format.recordBytes,
    detailBytes: format.detailBytes,
    detailBucket: format.detailBucket,
    positionScale: format.positionScale,
    velocityScale: format.velocityScale,
    flags: F,
    count: globalCount,
    counts: {
      gcns: gcnsKept.reduce((n, g) => n + g.length, 0),
      hyg: count((c) => (c.flags & F.hyg) !== 0),
      simbad: count((c) => (c.flags & F.simbadOnly) !== 0),
      exoplanetHosts: [...hostOfGcns.keys()].filter(
        (g) => gcnsToGlobal[g]! >= 0
      ).length,
    },
    shells,
    details: gcnsOn ? P.gcns.details : [],
    names: P.hyg.names.file,
    source: index.source,
    witnesses: index.witnesses,
  };

  return {
    manifest,
    missingParts,
    gcnsShellFile: (k) => (gcnsOn ? P.gcns.shells[k]!.file : null),
    gcnsIndexOf: (i) => globalToGcns[i] ?? -1,
    globalIndexOf: (g) => gcnsToGlobal[g] ?? -1,
    shellBuffer(k, gcnsBuffer) {
      const entry = shells[k]!;
      const out = new ArrayBuffer(entry.count * format.recordBytes);
      const bytes = new Uint8Array(out);
      const view = new DataView(out);
      const g = gcnsKept[k]!;
      if (g.length > 0) {
        if (!gcnsBuffer)
          throw new Error(`coquille ${entry.maxPc} pc du GCNS absente`);
        const first = shellFirst(k);
        const src = new Uint8Array(gcnsBuffer);
        const expected = P.gcns.shells[k]!.count * format.recordBytes;
        if (gcnsBuffer.byteLength !== expected)
          throw new Error(
            `coquille ${entry.maxPc} pc du GCNS : ${gcnsBuffer.byteLength} octets pour ${expected}`
          );
        g.forEach((gi, j) => {
          const from = (gi - first) * format.recordBytes;
          const to = j * format.recordBytes;
          bytes.set(src.subarray(from, from + format.recordBytes), to);
          if (hostOfGcns.has(gi))
            view.setUint8(to + 14, view.getUint8(to + 14) | F.exoplanetHost);
        });
      }
      complementOf[k]!.forEach((c, j) =>
        encodeRecord(view, (g.length + j) * format.recordBytes, c, format)
      );
      return out;
    },
    detailSource(i) {
      const gi = globalToGcns[i];
      if (gi === undefined) return null;
      if (gi >= 0) {
        const bucket = Math.floor(gi / format.detailBucket);
        const file = P.gcns.details[bucket]?.file;
        return file
          ? { kind: 'gcns', file, local: gi % format.detailBucket }
          : null;
      }
      const c = complementAt.get(i);
      if (!c) return null;
      return {
        kind: 'known',
        detail: {
          sourceId: null,
          parallaxMas: Math.fround(c.parallax),
          parallaxErrorMas: null,
          distanceBelowPc: null,
          distanceAbovePc: null,
          ruwe: null,
          whiteDwarfProbability: null,
          astrometryProbability: null,
          radialVelocityErrorKms: null,
        },
      };
    },
    baseNames,
    withHygNames(names, pairs) {
      const out: Record<string, VolumeNameEntry> = { ...baseNames };
      const fromHyg = new Set<number>();
      if (
        !names ||
        !pairs ||
        P.hyg.enabled === false ||
        !gcnsOn ||
        !bindsMatch(pairs.binds, index, ['gcns', 'hyg'])
      )
        return { names: out, fromHyg };
      const nameOf = new Map(names.rows);
      for (const [g, h] of pairs.pairs) {
        const at = gcnsToGlobal[g];
        const name = nameOf.get(h);
        if (at === undefined || at < 0 || !name) continue;
        const host = hostOfGcns.get(g);
        out[at] = host ? [name, host.host, host.planets] : [name];
        fromHyg.add(at);
      }
      return { names: out, fromHyg };
    },
  };

  /** Premier rang GCNS de la coquille `k` (les coquilles du GCNS se suivent). */
  function shellFirst(k: number): number {
    let n = 0;
    for (let j = 0; j < k; j++) n += P.gcns.shells[j]!.count;
    return n;
  }
}
