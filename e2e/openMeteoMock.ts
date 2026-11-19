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
    fixedHours?: number
  ): Promise<void> => {
    const body = route.request().postDataJSON() as {
      latitude?: number[];
      hourly?: string[];
      past_days?: number;
      forecast_days?: number;
    };
    // Comme l'API : la série couvre TOUTE la fenêtre demandée (passé + prévision). Une série plus
    // courte que l'heure lue rendrait une donnée ABSENTE (NaN), plus un zéro silencieux.
    const hours =
      fixedHours ?? ((body.past_days ?? 0) + (body.forecast_days ?? 1)) * 24;
    // TOUTES les variables demandées : le vent en demande deux dans la même requête.
    const variables = body.hourly?.length ? body.hourly : ['cloud_cover'];
    const points = (body.latitude ?? []).map(() => ({
      hourly: Object.fromEntries(
        variables.map((variable) => [
          variable,
          Array.from({ length: hours }, () => value),
        ])
      ),
    }));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(points),
    });
  };

  // Le service de données de Galaxy passe AVANT Open-Meteo (lot 46) : coupé ici, pour que ces
  // scénarios exercent le repli qu'ils décrivent et ne dépendent jamais du vrai serveur.
  await page.route('**/galaxy-data.adrianguichard.dev/**', (route) =>
    route.abort()
  );
  await page.route('**/api.open-meteo.com/**', (route) => respond(route));
  await page.route('**/archive-api.open-meteo.com/**', (route) =>
    respond(route, 24)
  );
}
