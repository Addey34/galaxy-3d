import { readFileSync } from 'node:fs';
import { vi } from 'vitest';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { bodyDynamics } from '@/config/gravity';
import { HorizonsEphemerisService } from './HorizonsEphemerisService';

/**
 * Charge le service Horizons sur les binaires RÉELLEMENT COMMITTÉS, pour les tests.
 *
 * Pourquoi ce fixture existe. `HorizonsEphemerisService.load()` passe par `fetch` et
 * `window.location`, absents sous Vitest en environnement `node`. Un test qui veut exercer le
 * chemin de PRODUCTION — celui que voit l'utilisateur — doit donc reconstruire la même
 * structure interne depuis le disque. Trois fichiers de test le faisaient chacun de leur côté,
 * et chacun pouvait diverger de la vraie configuration sans que rien ne le signale : oublier
 * d'injecter la table `bodyDynamics`, par exemple, désactive silencieusement l'interpolation
 * dynamique et fait mesurer au test un comportement que personne n'exécute jamais.
 *
 * D'où un seul point de vérité, aligné sur ce que fait `SolarSystemApp` au démarrage.
 *
 * Ce n'est PAS un mock : les données sont les vrais fichiers du dépôt. Un test bâti dessus
 * échouera légitimement si un futur `pnpm ephemeris:generate` change le pas, la couverture ou
 * le centre d'un corps — c'est le but, ces fichiers font partie du produit.
 */

export const EPHEMERIDES_DIR = 'public/assets/ephemerides/';

export interface HorizonsManifestEntry {
  file: string;
  center?: string;
  stepDays: number;
  startJdTdb: number;
  sampleCount: number;
}

/** Le manifeste committé, tel quel. */
export const horizonsManifest = JSON.parse(
  readFileSync(EPHEMERIDES_DIR + 'manifest.json', 'utf-8')
) as { bodies: Record<string, HorizonsManifestEntry> };

/**
 * Instancie le service sur les fichiers du dépôt, avec la MÊME table de dynamique que la
 * couche de composition — sans elle, le service retomberait sur l'interpolation cubique seule
 * et le test n'exercerait pas le chemin réel.
 */
export function horizonsServiceFromDisk(): HorizonsEphemerisService {
  const dynamics = bodyDynamics(CELESTIAL_CONFIG);
  const loaded = new Map<string, unknown>();

  for (const [name, entry] of Object.entries(horizonsManifest.bodies)) {
    const file = readFileSync(EPHEMERIDES_DIR + entry.file);
    loaded.set(name, {
      manifest: entry,
      samples: new Float64Array(
        file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
      ),
      ...(dynamics[name] !== undefined ? { dynamics: dynamics[name] } : {}),
    });
  }

  // Le constructeur est `private` côté TypeScript seulement : au runtime c'est un
  // constructeur ordinaire, et c'est la seule voie pour construire le service hors du
  // navigateur. Le cast est délibéré et confiné ici.
  type Ctor = new (bodies: Map<string, unknown>) => HorizonsEphemerisService;
  return new (HorizonsEphemerisService as unknown as Ctor)(loaded);
}

/**
 * UN HÔTE QUI SERT LES VRAIS OCTETS, et honore `Range` comme Firebase le fait (mesuré le
 * 2026-09-23 : 206, `Content-Range`, borne haute ramenée à la fin du fichier).
 *
 * Il vit ici, avec le reste du fixture, parce que DEUX suites l'exercent depuis le lot 17E —
 * les fenêtres (17C) et le magasin de l'appareil (17E) — et qu'une seconde copie pourrait
 * diverger de la première sans que rien ne le dise.
 */
/** Ce qu'une requête a demandé et reçu : c'est là-dessus que portent la moitié des gardes. */
export interface Served {
  body: string;
  range: string | null;
  bytes: number;
  status: number;
}

export interface ServerOptions {
  /** Corps dont la requête échoue : statut HTTP, ou 0 pour un rejet de transport. */
  fail?: Readonly<Record<string, number>>;
  /** L'hôte IGNORE la plage et rend 200 avec tout le fichier (décision D7, mesuré). */
  ignoreRanges?: boolean;
  /**
   * L'hôte rend un `Content-Range` dont le total n'est pas celui du fichier : c'est le cas du
   * flux COMPRESSÉ (piège 1 du plan, 417 899 au lieu de 440 496 sur Mercure).
   */
  lieAboutTotal?: boolean;
}

const fileCache = new Map<string, Buffer>();

function fileOf(name: string): Buffer {
  const entry = horizonsManifest.bodies[name];
  let file = fileCache.get(name);
  if (!file) {
    file = readFileSync(EPHEMERIDES_DIR + entry.file);
    fileCache.set(name, file);
  }
  return file;
}

function bodyOfUrl(url: string): string {
  const file = url.split('/').pop() ?? '';
  const found = Object.entries(horizonsManifest.bodies).find(
    ([, entry]) => entry.file === file
  );
  if (!found) throw new Error(`fichier inconnu du manifeste : ${file}`);
  return found[0];
}

/** Un hôte qui sert les VRAIS octets, et honore `Range` comme Firebase le fait (mesuré). */
export function serveRealEphemerides(
  log: Served[],
  options: ServerOptions = {}
): typeof fetch {
  const server = async (
    input: unknown,
    init?: RequestInit
  ): Promise<unknown> => {
    const url = String(input);
    if (url.endsWith('manifest.json'))
      return { ok: true, json: async () => horizonsManifest };

    const body = bodyOfUrl(url);
    const status = options.fail?.[body];
    if (status === 0) throw new TypeError('Failed to fetch');
    if (status !== undefined) {
      log.push({ body, range: null, bytes: 0, status });
      return { ok: false, status };
    }

    const file = fileOf(body);
    const header = (init?.headers as Record<string, string> | undefined)?.[
      'Range'
    ];
    if (!header || options.ignoreRanges) {
      log.push({
        body,
        range: header ?? null,
        bytes: file.byteLength,
        status: 200,
      });
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        arrayBuffer: async () => slice(file, 0, file.byteLength - 1),
      };
    }

    const match = /^bytes=(\d+)-(\d+)$/.exec(header);
    if (!match) throw new Error(`plage illisible : ${header}`);
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), file.byteLength - 1);
    const total = options.lieAboutTotal ? file.byteLength - 1 : file.byteLength;
    log.push({ body, range: header, bytes: end - start + 1, status: 206 });
    return {
      ok: true,
      status: 206,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === 'content-range'
            ? `bytes ${start}-${end}/${total}`
            : null,
      },
      arrayBuffer: async () => slice(file, start, end),
    };
  };
  return server as unknown as typeof fetch;
}

function slice(file: Buffer, start: number, end: number): ArrayBuffer {
  const view = file.subarray(start, end + 1);
  return view.buffer.slice(
    view.byteOffset,
    view.byteOffset + view.byteLength
  ) as ArrayBuffer;
}

export function stubBrowser(fetchImpl: typeof fetch): void {
  vi.stubGlobal('window', {
    location: { href: 'https://example.test/', origin: 'https://example.test' },
  });
  vi.stubGlobal('fetch', fetchImpl);
}
