/**
 * LE MAGASIN D'ÉPHÉMÉRIDES DE CET APPAREIL : ce que la machine tient déjà, et qui ne se
 * redemande donc pas.
 *
 * Phase 17E. Il répond à DEUX faits mesurés, et c'est le même mécanisme qui les traite :
 *
 *   - **la visite de retour**. Mesuré le 2026-09-24 sur le build livré de 17D, trois
 *     chargements successifs dans le même navigateur, service worker actif, octets comptés
 *     côté SERVEUR : la deuxième visite coûte **987 168 octets en 62 requêtes, et RIEN
 *     d'autre** — 100 % de la visite de retour est de l'éphéméride. Tout le reste (textures,
 *     modèles, JavaScript, page) est servi par le service worker. Une réponse 206 n'entre ni
 *     dans le cache du navigateur ni dans celui du service worker (`cacheableResponse:
 *     statuses [0, 200]`), donc depuis 17C ces octets se repaient à chaque visite, là où les
 *     38 Mo de fichiers entiers étaient auparavant en cache ;
 *   - **le hors-ligne**, que 17C a RETIRÉ pour la même raison : `ssv-assets` ne contient plus
 *     un seul `.bin` (le cache n'est même pas créé, vérifié), alors qu'il en tenait 64.
 *
 * L'option (a3) du plan — une règle de service worker rangeant les fenêtres sous une clé
 * synthétique — est écartée pour ce qu'elle ne sait pas faire : une clé par plage ne rend une
 * réponse que si la plage demandée est EXACTEMENT celle d'avant, et elle ignore le cas du
 * bouton « préparer le hors-ligne », qui range des fichiers ENTIERS. Ici, une seule question
 * est posée — « ce que je tiens contient-il ce que je veux ? », c'est-à-dire `windowContains`,
 * déjà écrite et déjà testée en 17A — et elle répond aux deux cas avec un seul magasin.
 *
 * Ce module ne fait AUCUNE requête : il lit et écrit un `Cache`. La fonction qui décide (quelle
 * clé, quoi garder) est pure et testée sans navigateur ; la classe n'est que l'entrée/sortie.
 */

import {
  BYTES_PER_SAMPLE,
  windowContains,
  type SampleWindow,
} from './ephemerisWindow';

/**
 * Nom du cache. Versionné : si la forme des clés changeait, un magasin écrit par une version
 * antérieure porterait un autre nom et serait donc ignoré, plutôt que relu de travers.
 */
export const EPHEMERIS_CACHE_NAME = 'ssv-ephemerides-v1';

/**
 * Préfixe des clés. Ce n'est PAS l'adresse du binaire, et c'est délibéré : une clé qui
 * ressemblerait à `/assets/ephemerides/mimas.<hash>.bin` pourrait être servie par la règle
 * `CacheFirst` du service worker à une requête réelle, avec des octets partiels présentés
 * comme le fichier entier. Un chemin qui n'a jamais existé sur le serveur ne peut répondre à
 * rien.
 */
const KEY_PREFIX = '/__ephemeris-store/';

/** Clé du manifeste dans le magasin (cf. `EphemerisStore.readManifest`). */
const MANIFEST_KEY = `${KEY_PREFIX}manifest.json`;

/** Une suite d'échantillons CONTIGUS tenue sur cet appareil, dans la grille du fichier. */
export interface HeldSpan {
  readonly firstIndex: number;
  readonly lastIndex: number;
}

/** Octets d'une tranche tenue. C'est la taille exacte que l'entrée doit avoir. */
export function spanByteLength(span: HeldSpan): number {
  return (span.lastIndex - span.firstIndex + 1) * BYTES_PER_SAMPLE;
}

/**
 * La clé d'une tranche. Le nom du fichier porte déjà un hachage de son contenu, donc deux
 * versions d'un même corps ne se confondent jamais : un redéploiement laisse des entrées
 * ORPHELINES, que `prune` retire en confrontant le magasin au manifeste courant.
 */
export function storeKey(file: string, span: HeldSpan): string {
  return `${KEY_PREFIX}${file}?samples=${span.firstIndex}-${span.lastIndex}`;
}

/** L'inverse, appliqué à une clé lue dans le cache. Rend `null` sur tout ce qui n'est pas à nous. */
export function parseStoreKey(
  url: string
): { file: string; span: HeldSpan } | null {
  const path = pathAndQuery(url);
  if (!path.startsWith(KEY_PREFIX)) return null;
  const rest = path.slice(KEY_PREFIX.length);
  const match = /^([a-z0-9-]+\.[a-f0-9]{12}\.bin)\?samples=(\d+)-(\d+)$/i.exec(
    rest
  );
  if (!match) return null;
  const firstIndex = Number(match[2]);
  const lastIndex = Number(match[3]);
  if (lastIndex < firstIndex) return null;
  return { file: match[1], span: { firstIndex, lastIndex } };
}

/** Le chemin et la requête d'une URL, absolue ou déjà relative. */
function pathAndQuery(url: string): string {
  const scheme = /^[a-z][a-z0-9+.-]*:/i.test(url);
  if (!scheme) return url;
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

/**
 * Ce qu'on garde quand une tranche arrive et qu'une autre est déjà là. UNE entrée par fichier,
 * et ce n'est pas une simplification : sans cette borne, un lecteur qui se promène dans le
 * temps accumulerait une entrée par date visitée, sans limite, jusqu'au quota du navigateur.
 *
 * La règle est celle de l'inclusion, la même que celle du service en mémoire :
 *
 *   - la nouvelle tranche est DÉJÀ contenue dans celle du magasin : on n'écrit rien, sans quoi
 *     une fenêtre de 96 octets remplacerait le fichier entier qu'un « préparer le hors-ligne »
 *     vient de ranger ;
 *   - sinon on écrit, et on retire l'ancienne. Deux tranches disjointes ne se fusionnent pas :
 *     les octets du trou n'ont jamais été téléchargés, et inventer une tranche qu'on ne tient
 *     pas ferait lire n'importe quoi.
 */
export function shouldReplace(
  held: HeldSpan | null,
  incoming: HeldSpan
): boolean {
  if (!held) return true;
  return !windowContains(asWindow(held), asWindow(incoming));
}

/**
 * Cette tranche répond-elle au plan ? Pure, donc falsifiable sans cache : c'est ici que se
 * décide « on ne demande rien au réseau », et une erreur y ferait lire des octets d'un autre
 * instant.
 */
export function spanSatisfies(
  span: HeldSpan,
  wanted: SampleWindow | 'full',
  sampleCount: number
): boolean {
  if (wanted === 'full')
    return span.firstIndex === 0 && span.lastIndex === sampleCount - 1;
  return windowContains(asWindow(span), wanted);
}

/** Une tranche vue comme la fenêtre que `ephemerisWindow` sait comparer. */
function asWindow(span: HeldSpan): SampleWindow {
  return {
    firstIndex: span.firstIndex,
    lastIndex: span.lastIndex,
    byteStart: span.firstIndex * BYTES_PER_SAMPLE,
    byteEnd: (span.lastIndex + 1) * BYTES_PER_SAMPLE - 1,
    byteLength: spanByteLength(span),
  };
}

/** Ce que le magasin tient d'un fichier, une fois les octets relus. */
export interface HeldBytes {
  readonly bytes: ArrayBuffer;
  readonly firstIndex: number;
}

/** Ce que le magasin tient, fichier par fichier. LU, jamais supposé. */
export interface StoreInventory {
  /** Tranche tenue par fichier. Un fichier absent n'a pas d'entrée. */
  readonly spans: ReadonlyMap<string, HeldSpan>;
  /** Octets tenus, tous fichiers confondus. */
  readonly bytes: number;
}

/**
 * La part du `Cache` dont ce module se sert. Déclarée pour qu'un test fournisse un faux
 * magasin : `caches` n'existe ni sous Node ni dans jsdom, et un module qui l'exigerait ne
 * serait testable que dans un navigateur.
 */
export interface EphemerisCacheLike {
  keys(): Promise<readonly { url: string }[]>;
  match(request: string): Promise<Response | undefined>;
  put(request: string, response: Response): Promise<void>;
  delete(request: string): Promise<boolean>;
}

export class EphemerisStore {
  constructor(private readonly cache: EphemerisCacheLike) {}

  /**
   * Ouvre le magasin, ou rend `null` quand cet appareil n'en a pas.
   *
   * `caches` manque en navigation privée sur certains navigateurs, sous Node et dans jsdom, et
   * son ouverture peut ÉCHOUER là où elle existe (mesuré le 2026-09-24 : un profil Chromium
   * sous un chemin Windows trop long rend « Failed to execute 'open' on 'CacheStorage':
   * Unexpected internal error »). Aucun de ces cas n'est une panne de l'application : elle
   * redemande alors ses fenêtres, comme avant cette phase.
   */
  static async open(
    name: string = EPHEMERIS_CACHE_NAME
  ): Promise<EphemerisStore | null> {
    if (typeof caches === 'undefined') return null;
    try {
      return new EphemerisStore(await caches.open(name));
    } catch {
      return null;
    }
  }

  /**
   * Ce qui est RÉELLEMENT là, relu du cache à chaque fois.
   *
   * Deux entrées pour un même fichier ne devraient pas exister : `write` range la nouvelle PUIS
   * retire l'ancienne, et cet ordre est le bon (l'inverse perdrait des octets déjà payés si le
   * navigateur s'arrêtait entre les deux). Un arrêt entre les deux laisse donc un doublon, et il
   * faut choisir sans hésiter : la tranche la plus large, qui répond à tout ce que l'autre
   * répondait. `prune` retire la perdante au démarrage suivant, ce qui est la cohérence que ce
   * magasin doit tenir lui-même (le coût annoncé au § 9a du plan du lot 17).
   */
  async inventory(): Promise<StoreInventory> {
    const spans = new Map<string, HeldSpan>();
    let bytes = 0;
    for (const request of await this.cache.keys()) {
      const parsed = parseStoreKey(request.url);
      if (!parsed) continue;
      const held = spans.get(parsed.file);
      if (held && !shouldReplace(held, parsed.span)) continue;
      if (held) bytes -= spanByteLength(held);
      spans.set(parsed.file, parsed.span);
      bytes += spanByteLength(parsed.span);
    }
    return { spans, bytes };
  }

  /**
   * Les octets d'une tranche annoncée par l'inventaire, ou `null`.
   *
   * L'inventaire se prend UNE fois par passage de chargement et se passe ici : sans cela,
   * chacun des 62 corps relirait les clés du cache entier.
   *
   * La taille de la réponse est CONFRONTÉE à la tranche que sa clé annonce, comme le chemin
   * HTTP confronte un `Content-Range` : une entrée tronquée (quota atteint pendant l'écriture,
   * cache corrompu) serait sinon lue comme si elle commençait au bon échantillon, et placerait
   * le corps à une autre date sans que rien ne le dise. Une entrée fausse est SUPPRIMÉE, pas
   * seulement ignorée : elle n'a aucune chance de redevenir juste.
   */
  async readSpan(file: string, span: HeldSpan): Promise<HeldBytes | null> {
    const key = storeKey(file, span);
    const response = await this.cache.match(key);
    if (!response) return null;
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== spanByteLength(span)) {
      await this.cache.delete(key);
      return null;
    }
    return { bytes, firstIndex: span.firstIndex };
  }

  /**
   * Range une tranche, et rend `true` si le magasin a changé.
   *
   * `held` est ce que l'inventaire du passage courant annonce pour ce fichier, et c'est un
   * PARAMÈTRE et non une relecture, pour une raison MESURÉE : relire l'inventaire ici coûtait
   * un `cache.keys()` par corps, soit **62 appels par passage de chargement, mesurés à
   * 12 184 ms** dans un vrai navigateur sur un magasin de 56 entrées (contre 3 725 ms pour les
   * 62 écritures elles-mêmes). Ces douze secondes tombaient en plein dans le chemin des
   * éphémérides : pendant une lecture accélérée, chaque glissement de fenêtre les repayait et
   * la date n'avançait plus. C'est la CI qui l'a attrapé, pas la suite locale, et c'est la même
   * règle que pour les lectures — l'inventaire se lit UNE fois par passage.
   *
   * Un quota atteint n'est pas une panne : le chargement suivant redemandera ses octets, comme
   * avant cette phase. On le rend donc comme un `false`, pas comme une exception.
   */
  async write(
    file: string,
    span: HeldSpan,
    bytes: ArrayBuffer,
    held: HeldSpan | null
  ): Promise<boolean> {
    if (bytes.byteLength !== spanByteLength(span)) return false;
    if (!shouldReplace(held, span)) return false;
    try {
      await this.cache.put(storeKey(file, span), new Response(bytes));
    } catch {
      return false;
    }
    if (
      held &&
      (held.firstIndex !== span.firstIndex || held.lastIndex !== span.lastIndex)
    )
      await this.cache.delete(storeKey(file, held));
    return true;
  }

  /**
   * Le manifeste, rangé pour que le hors-ligne existe VRAIMENT : il est servi en
   * `NetworkFirst` avec une péremption d'une heure (`ssv-ephemeris-manifest`), donc sans cette
   * copie, un appareil préparé le matin retomberait l'après-midi sur « aucune éphéméride
   * précise » alors que ses 64 fichiers sont là.
   */
  async readManifest(): Promise<unknown | null> {
    const response = await this.cache.match(MANIFEST_KEY);
    if (!response) return null;
    try {
      return (await response.json()) as unknown;
    } catch {
      return null;
    }
  }

  async writeManifest(raw: unknown): Promise<void> {
    try {
      await this.cache.put(
        MANIFEST_KEY,
        new Response(JSON.stringify(raw), {
          headers: { 'content-type': 'application/json' },
        })
      );
    } catch {
      /* quota : le hors-ligne ne sera pas préparé, et l'inventaire le dira. */
    }
  }

  /**
   * Retire ce que le manifeste courant ne nomme plus, ET les doublons de tranche. C'est la
   * cohérence que ce magasin doit tenir lui-même (le coût annoncé au § 9a du plan) : les
   * binaires sont nommés par le hachage de leur contenu, donc une régénération de données
   * laisse des entrées qui ne seront jamais relues et qui occuperaient la place jusqu'au
   * quota ; et un arrêt du navigateur au milieu d'une écriture laisse deux tranches pour un
   * même fichier, dont une seule sera jamais relue (cf. `inventory`).
   */
  async prune(keep: ReadonlySet<string>): Promise<number> {
    const { spans } = await this.inventory();
    let removed = 0;
    for (const request of await this.cache.keys()) {
      const parsed = parseStoreKey(request.url);
      if (!parsed) continue;
      const kept = spans.get(parsed.file);
      const isKept =
        keep.has(parsed.file) &&
        kept !== undefined &&
        kept.firstIndex === parsed.span.firstIndex &&
        kept.lastIndex === parsed.span.lastIndex;
      if (isKept) continue;
      if (await this.cache.delete(request.url)) removed++;
    }
    return removed;
  }

  /** Vide le magasin. L'utilisateur reprend ses 38 Mo quand il le décide. */
  async clear(): Promise<number> {
    let removed = 0;
    for (const request of await this.cache.keys())
      if (await this.cache.delete(request.url)) removed++;
    return removed;
  }
}
