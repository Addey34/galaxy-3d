import type { Page } from '@playwright/test';

/**
 * Répond aux appels Open-Meteo avec une grille CONSTANTE, pour exercer le chemin WebGL des
 * couches modèle hors ligne.
 *
 * Une valeur unique partout est délibérée : ce qu'on teste n'est jamais la donnée mais le
 * rendu qu'elle traverse (matériau, terminateur, mesh cible). Une couverture nuageuse
 * uniforme et forte est même le pire cas utile — elle couvre tout le globe, donc une couche
 * qui ne s'éteint pas la nuit se voit immédiatement.
 *
 * Extrait de `weather-model.spec.ts`, où il vivait en double, quand `terminator.spec.ts` a eu
 * besoin du même chemin hors ligne.
 */
export async function mockOpenMeteo(page: Page, value = 70): Promise<void> {
  const respond = async (
    route: Parameters<Parameters<Page['route']>[1]>[0],
    hours: number
  ): Promise<void> => {
    const body = route.request().postDataJSON() as {
      latitude?: number[];
      hourly?: string[];
    };
    const variable = body.hourly?.[0] ?? 'cloud_cover';
    const points = (body.latitude ?? []).map(() => ({
      hourly: { [variable]: Array.from({ length: hours }, () => value) },
    }));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(points),
    });
  };

  await page.route('**/api.open-meteo.com/**', (route) => respond(route, 48));
  await page.route('**/archive-api.open-meteo.com/**', (route) =>
    respond(route, 24)
  );
}
