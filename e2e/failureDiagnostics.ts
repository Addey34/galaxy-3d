import type { Page, TestInfo } from '@playwright/test';

/**
 * DIAGNOSTICS D'ÉCHEC, ET SEULEMENT D'ÉCHEC (GAL-CI-STABILITY-001B).
 *
 * Trois scénarios de la CI ne passaient qu'au réessai (`formationMarker`, `gazetteer`,
 * `tourPlayer`) et leur journal ne disait que « timeout » ou « 0 nom » : impossible de savoir si
 * la scène bougeait encore, si des tuiles restaient en vol ou si la couche n'avait rien écrit.
 *
 * Rien n'est lu pendant que le test réussit : l'instantané ne part que dans un `afterEach` dont
 * le test a échoué (ou expiré). Rien n'entre dans le produit : on lit les attributs que l'appli
 * publie déjà sur le canvas et sur la couche des noms. L'instantané est borné dans le temps (un
 * fil principal saturé ne doit pas retenir le test) et ne lève JAMAIS : l'erreur d'origine reste
 * la seule raison de l'échec.
 */

/** Ce qu'une page publie déjà, lu d'un seul aller-retour. `null` = attribut absent. */
interface SceneState {
  readonly names: string | null;
  readonly drawn: string | null;
  readonly surfaceBusy: string | null;
  readonly texturesLoading: string | null;
  readonly sceneMoving: string | null;
  readonly searchFocus: string | null;
  readonly marker: string | null;
  readonly markerCount: number;
  readonly url: string;
}

/** Au-delà, on renonce à lire la page : un fil principal bloqué est lui-même une information. */
const SNAPSHOT_DEADLINE_MS = 5_000;

/**
 * Pistes propres à un test (ses dernières observations), rangées par test pour que deux tests
 * d'un même fichier ne se mélangent pas. Un tableau borné : on garde les dernières.
 */
const trails = new Map<string, string[]>();
const TRAIL_LIMIT = 40;

/** Ajoute une observation à la piste du test courant. Coût : une chaîne en mémoire. */
export function noteTrail(testInfo: TestInfo, line: string): void {
  const trail = trails.get(testInfo.testId) ?? [];
  trail.push(line);
  if (trail.length > TRAIL_LIMIT) trail.shift();
  trails.set(testInfo.testId, trail);
}

async function readState(page: Page): Promise<SceneState> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const overlay = document.getElementById('gazetteer-overlay');
    const marker = document.getElementById('formation-marker');
    return {
      names: overlay?.getAttribute('data-names') ?? null,
      drawn: overlay?.getAttribute('data-drawn') ?? null,
      surfaceBusy: canvas?.getAttribute('data-surface-busy') ?? null,
      texturesLoading: canvas?.getAttribute('data-textures-loading') ?? null,
      sceneMoving: canvas?.getAttribute('data-scene-moving') ?? null,
      searchFocus: canvas?.getAttribute('data-search-focus') ?? null,
      marker: marker?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      markerCount: document.querySelectorAll('#formation-marker').length,
      url: location.pathname + location.search,
    };
  });
}

/**
 * À appeler dans un `test.afterEach`. Écrit l'instantané dans la sortie (donc dans le journal de
 * la CI) et le joint au rapport. La distance de la caméra n'est publiée par aucun attribut hors
 * `?debug-surface` : elle est donc déclarée absente plutôt que devinée.
 */
export async function reportFailureDiagnostics(
  page: Page,
  testInfo: TestInfo
): Promise<void> {
  const failed =
    testInfo.status !== testInfo.expectedStatus &&
    testInfo.status !== 'skipped' &&
    testInfo.status !== 'interrupted';
  const trail = trails.get(testInfo.testId) ?? [];
  trails.delete(testInfo.testId);
  if (!failed) return;
  try {
    let state: SceneState | string;
    try {
      state = await Promise.race([
        readState(page),
        new Promise<string>((resolve) =>
          setTimeout(
            () =>
              resolve(
                `page injoignable en ${SNAPSHOT_DEADLINE_MS} ms (fil principal saturé ou page fermée)`
              ),
            SNAPSHOT_DEADLINE_MS
          )
        ),
      ]);
    } catch (error) {
      state = `lecture impossible : ${(error as Error).message.split('\n')[0]}`;
    }
    const body = [
      `[diagnostic ${testInfo.title}] tentative ${testInfo.retry}, ${testInfo.status}`,
      `état de la scène : ${JSON.stringify(state)}`,
      'distance caméra : non publiée (hors ?debug-surface)',
      `dernières observations (${trail.length}) :`,
      ...trail.map((line) => `  ${line}`),
    ].join('\n');
    console.log(body);
    await testInfo.attach('failure-diagnostics', {
      body,
      contentType: 'text/plain',
    });
  } catch {
    // Un diagnostic raté ne doit jamais remplacer l'erreur du test.
  }
}
