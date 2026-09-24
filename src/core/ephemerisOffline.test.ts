import { afterEach, describe, expect, it, vi } from 'vitest';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { bodyDynamics } from '@/config/gravity';
import { flattenBodies } from '@/config/catalog';
import { HorizonsEphemerisService } from './HorizonsEphemerisService';
import type { SceneWindowRequest } from './HorizonsEphemerisService';
import { EphemerisStore, type EphemerisCacheLike } from './ephemerisStore';
import {
  horizonsManifest,
  serveRealEphemerides,
  stubBrowser,
  type Served,
} from './horizonsTestFixture';

/**
 * LE MAGASIN DE L'APPAREIL, VU DU SERVICE (lot 17, phase 17E).
 *
 * Deux faits MESURÉS le 2026-09-24 sur le build livré de 17D, octets comptés côté serveur,
 * service worker actif, trois chargements successifs dans le même navigateur :
 *
 *   - la visite de RETOUR coûtait **987 168 octets en 62 requêtes, et rien d'autre** : 100 %
 *     de la visite était de l'éphéméride, tout le reste venant du service worker ;
 *   - le cache `ssv-assets` ne contenait **aucun `.bin`** (il n'était même pas créé), là où il
 *     en tenait 64 avant 17C : les éphémérides n'étaient plus disponibles hors ligne.
 *
 * Ces gardes exercent le chemin de PRODUCTION (`load`, son `fetch`, son en-tête `Range`)
 * contre les binaires RÉELLEMENT livrés, avec un cache en mémoire à la place de celui du
 * navigateur. Ce qu'elles vérifient n'est pas « le cache fonctionne » mais « plus une seule
 * requête ne part », ce qui est la seule chose que l'utilisateur constate.
 */

const MANIFEST_URL = 'https://example.test/assets/ephemerides/manifest.json';
const SCENE_DATE = new Date('2026-09-23T00:00:00Z');

const PERIODS: Record<string, number> = {};
for (const [name, cfg] of flattenBodies(CELESTIAL_CONFIG)) {
  const period = cfg.realData?.orbitPeriodDays;
  if (period !== undefined && period > 0) PERIODS[name] = period;
}

const sceneRequest = (date: Date): SceneWindowRequest => ({
  date,
  leadDays: 0,
  orbitPeriodDays: PERIODS,
});

/** Un cache en mémoire, à l'image du `Cache` du navigateur. */
function fakeCache(): EphemerisCacheLike {
  const entries = new Map<string, ArrayBuffer>();
  return {
    async keys() {
      return [...entries.keys()].map((url) => ({ url }));
    },
    async match(request: string) {
      const bytes = entries.get(request);
      return bytes === undefined ? undefined : new Response(bytes);
    },
    async put(request: string, response: Response) {
      entries.set(request, await response.arrayBuffer());
    },
    async delete(request: string) {
      return entries.delete(request);
    },
  };
}

interface Visit {
  log: Served[];
  service: HorizonsEphemerisService;
}

/**
 * Une visite : un hôte neuf, un journal neuf, et le MÊME magasin que la visite précédente.
 *
 * L'horloge est INJECTÉE et avance de 10 ms à chaque lecture, pour que le débit mesuré ne
 * dépende pas de la machine. C'est ce qui rend falsifiable la garde du compteur de débit :
 * sous une horloge réelle, 62 lectures locales occupent quelques millisecondes et le compteur
 * rendrait `null` par son seuil de bruit, donc pour la MAUVAISE raison.
 */
async function visit(
  store: EphemerisStore | null,
  date: Date = SCENE_DATE
): Promise<Visit> {
  const log: Served[] = [];
  stubBrowser(serveRealEphemerides(log));
  let clock = 0;
  const service = await HorizonsEphemerisService.load(
    MANIFEST_URL,
    bodyDynamics(CELESTIAL_CONFIG),
    {
      scene: sceneRequest(date),
      retryDelaysMs: [],
      store,
      now: () => (clock += 10),
    }
  );
  // Les écritures du magasin sont volontairement HORS du chemin de chargement (cf.
  // `_store`) : une garde qui enchaînerait deux visites sans les attendre mesurerait une
  // course, pas le magasin.
  await service.whenStored();
  return { log, service };
}

/** Les requêtes de BINAIRES, manifeste exclu : c'est ce que la visite de retour coûte. */
const binaryBytes = (log: Served[]): number =>
  log.reduce((total, served) => total + served.bytes, 0);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('la visite de retour', () => {
  it('ne redemande PAS les fenêtres déjà rangées', async () => {
    const store = new EphemerisStore(fakeCache());

    const first = await visit(store);
    expect(first.log.length).toBeGreaterThan(50);
    const firstBytes = binaryBytes(first.log);
    expect(firstBytes).toBeGreaterThan(500_000);

    const second = await visit(store);
    expect(second.log).toEqual([]);
    expect(binaryBytes(second.log)).toBe(0);

    // Et ce n'est pas une scène vide : les corps sont placés au même endroit qu'à la
    // première visite, aux octets près, puisque ce sont les mêmes octets.
    for (const name of ['mercury', 'uranus', 'mimas', 'bennu']) {
      const before = first.service.getHeliocentricAU(name, SCENE_DATE);
      const after = second.service.getHeliocentricAU(name, SCENE_DATE);
      expect(after).not.toBeNull();
      expect(after!.distanceTo(before!)).toBe(0);
    }
  });

  it('ne fait JAMAIS attendre le chargement sur une écriture du magasin', async () => {
    // Défaut trouvé par la CI, DEUX fois, et invisible sur cette machine : l'écriture était
    // attendue entre deux téléchargements. Or `OrbitalMechanics._requestWindows` ne garde
    // qu'UNE demande en vol, donc un passage prolongé retarde la fenêtre suivante et
    // l'horloge cale pendant une lecture accélérée. Rien ne dépend de la fin d'une écriture :
    // les octets sont déjà en mémoire.
    //
    // Une écriture qui ne finit JAMAIS est la formulation exacte de cette règle.
    const store = new EphemerisStore({
      ...fakeCache(),
      put: () => new Promise<void>(() => {}),
    });
    const log: Served[] = [];
    stubBrowser(serveRealEphemerides(log));

    const issue = HorizonsEphemerisService.load(
      MANIFEST_URL,
      bodyDynamics(CELESTIAL_CONFIG),
      { scene: sceneRequest(SCENE_DATE), retryDelaysMs: [], store }
    ).then(() => 'chargé' as const);
    const verdict = await Promise.race([
      issue,
      new Promise<'figé'>((resolve) =>
        setTimeout(() => resolve('figé'), 3_000)
      ),
    ]);

    expect(verdict).toBe('chargé');
    expect(log.length).toBeGreaterThan(50);
  });

  it('redemande ce que le magasin ne contient pas, et lui seul', async () => {
    const store = new EphemerisStore(fakeCache());
    await visit(store);

    // Une date éloignée sort des fenêtres rangées : les corps concernés repayent, les autres
    // non. Sans cette distinction, le magasin ne servirait qu'à la date de sa création.
    const far = await visit(store, new Date('2080-03-01T00:00:00Z'));
    expect(far.log.length).toBeGreaterThan(0);
    expect(far.log.length).toBeLessThan(
      Object.keys(horizonsManifest.bodies).length
    );
  });

  it('ne fait PAS passer une lecture du magasin pour un débit du lien', async () => {
    // Défaut vu en écrivant cette phase : des octets relus localement gonflent le débit
    // observé, donc le plafond de vitesse de lecture (lot 17D) devient plus haut que ce que
    // le lien soutient — et la date se remet à attendre EN SILENCE à la première fenêtre
    // réellement manquante, ce que 17D existe pour supprimer.
    const store = new EphemerisStore(fakeCache());
    const first = await visit(store);
    // Le premier passage, lui, mesure bien quelque chose : sinon la garde ne dirait rien.
    expect(first.service.observedBytesPerSecond).not.toBeNull();

    const second = await visit(store);
    expect(second.service.observedBytesPerSecond).toBeNull();
  });
});

describe('préparer le hors-ligne', () => {
  it('télécharge les fichiers entiers, et l’état est LU dans le magasin', async () => {
    const store = new EphemerisStore(fakeCache());
    const { service } = await visit(store);

    const before = await service.offlineState();
    expect(before.available).toBe(true);
    expect(before.declaredFiles).toBe(
      Object.keys(horizonsManifest.bodies).length
    );
    expect(before.completeFiles).toBe(0);

    const steps: number[] = [];
    const after = await service.prepareOffline({
      onProgress: ({ done }) => steps.push(done),
    });

    expect(after.completeFiles).toBe(after.declaredFiles);
    expect(after.storedBytes).toBe(after.declaredBytes);
    expect(steps.at(-1)).toBe(after.declaredFiles);
    // Ce qu'une préparation annonce est ce qu'elle téléchargerait MAINTENANT : tout au départ,
    // plus rien à l'arrivée. Promettre 38,4 Mo à qui en tient déjà la moitié serait faux.
    expect(before.remainingBytes).toBe(before.declaredBytes);
    expect(after.remainingBytes).toBe(0);

    // Le nombre affiché est relu, pas mémorisé : un magasin vidé sous la pression du quota
    // doit se voir immédiatement.
    await service.forgetOffline();
    expect((await service.offlineState()).completeFiles).toBe(0);
  });

  it('rend ensuite une visite entière SANS le moindre octet', async () => {
    const store = new EphemerisStore(fakeCache());
    const { service } = await visit(store);
    await service.prepareOffline();

    // N'importe quelle date de la couverture, pas seulement celle qui a été visitée.
    const later = await visit(store, new Date('2080-03-01T00:00:00Z'));
    expect(later.log).toEqual([]);
    expect(
      later.service.getHeliocentricAU('uranus', new Date('2080-03-01'))
    ).not.toBeNull();
  });

  it('ne range PAS des octets servis à la mauvaise taille', async () => {
    // Un hôte qui tronque (proxy, page d'erreur servie en 200) ferait sinon croire l'appareil
    // prêt, et la classe partirait avec des fichiers illisibles.
    const store = new EphemerisStore(fakeCache());
    const { service } = await visit(store);
    await service.forgetOffline();
    stubBrowser((async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      arrayBuffer: async () => new ArrayBuffer(64),
    })) as unknown as typeof fetch);

    const after = await service.prepareOffline();
    expect(after.completeFiles).toBe(0);
    expect(after.storedBytes).toBe(0);
  });

  it('retire du budget de vitesse les corps entièrement tenus', async () => {
    // Conséquence vraie de la préparation : ces corps ne demanderont plus un octet, donc les
    // compter plafonnerait la lecture au nom d'un trafic qui n'aura pas lieu (lot 17D).
    const store = new EphemerisStore(fakeCache());
    const { service } = await visit(store);
    expect(service.budgetGrids(SCENE_DATE).length).toBeGreaterThan(50);
    await service.prepareOffline();
    expect(service.budgetGrids(SCENE_DATE)).toEqual([]);
  });
});

describe('sans réseau', () => {
  it('place les corps depuis le magasin quand le manifeste ne répond plus', async () => {
    const store = new EphemerisStore(fakeCache());
    const { service } = await visit(store);
    await service.prepareOffline();
    const expected = service.getHeliocentricAU('mercury', SCENE_DATE);

    // Plus rien ne répond : ni le manifeste, ni les binaires. C'est l'état d'un appareil
    // emporté en classe, et c'est ce que la copie du manifeste rend possible.
    const log: Served[] = [];
    stubBrowser((() => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch);
    const offline = await HorizonsEphemerisService.load(
      MANIFEST_URL,
      bodyDynamics(CELESTIAL_CONFIG),
      { scene: sceneRequest(SCENE_DATE), retryDelaysMs: [], store }
    );
    expect(log).toEqual([]);
    expect(offline.report.manifestFailed).toBe(false);
    expect(offline.report.missing).toEqual([]);
    const got = offline.getHeliocentricAU('mercury', SCENE_DATE);
    expect(got).not.toBeNull();
    expect(got!.distanceTo(expected!)).toBe(0);
  });

  it('dit honnêtement qu’il n’a rien quand le magasin est vide', async () => {
    // Sans copie, un manifeste injoignable reste un échec, avec sa reprenabilité d'origine :
    // le magasin ne doit pas transformer une panne en silence.
    const store = new EphemerisStore(fakeCache());
    stubBrowser((() => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch);
    const service = await HorizonsEphemerisService.load(
      MANIFEST_URL,
      bodyDynamics(CELESTIAL_CONFIG),
      { scene: sceneRequest(SCENE_DATE), retryDelaysMs: [], store }
    );
    expect(service.report.manifestFailed).toBe(true);
    expect(service.report.retryable).toBe(true);
  });
});
