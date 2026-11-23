import { expect, type Page, type Route } from '@playwright/test';
import sharp from 'sharp';

/**
 * LE COMBLEMENT DES COINS NOIRS DE FAUCHÉE (GAL-CLOUD-VISUAL-001, `core/cloudComposite`,
 * `ui/cloudComplement`) de bout en bout, sur un GIBS SIMULÉ. Les scénarios sont écrits une fois ici
 * et joués par deux fichiers : `cloudComplement.spec.ts` (Chromium, en CI) et
 * `device-cloudComplement.spec.ts` (Pixel 7 et iPhone 15 émulés, hors CI).
 *
 * Ce qu'ils prouvent et que la NASA ne rend pas à la demande : le repli quand le complément manque
 * (la couche doit marcher comme avant), VIIRS qui n'est pas complété, et le badge de traçabilité qui
 * nomme les deux instruments. Le rendu sur les VRAIES données est mesuré à part
 * (docs/ARCHITECTURE.md, § « Combler les coins noirs de fauchée »).
 */

const W = 256;
const H = 128;

/** Une image de bruit clair (donc au-dessus du seuil de tuile vide), avec une fente sans donnée. */
export async function noisy(
  gap: [number, number] | null,
  seed: number
): Promise<Buffer> {
  const raw = Buffer.alloc(W * H * 3);
  let state = seed;
  for (let i = 0; i < raw.length; i++) {
    state = (state * 1664525 + 1013904223) >>> 0;
    raw[i] = 90 + ((state >>> 24) % 160);
  }
  if (gap)
    for (let y = 0; y < H; y++)
      for (let x = gap[0]; x <= gap[1]; x++) {
        const o = (y * W + x) * 3;
        raw[o] = raw[o + 1] = raw[o + 2] = 0;
      }
  return sharp(raw, { raw: { width: W, height: H, channels: 3 } })
    .jpeg({ quality: 92 })
    .toBuffer();
}

/** Une image presque noire de quelques centaines d'octets : GIBS sans donnée pour ce jour. */
export async function emptyDay(): Promise<Buffer> {
  return sharp({
    create: { width: 16, height: 8, channels: 3, background: '#000000' },
  })
    .jpeg()
    .toBuffer();
}

export interface Behaviour {
  viirs: Buffer | 'fail';
  terra: Buffer | 'fail';
  aqua: Buffer | 'fail';
}

export async function serveGibs(
  page: Page,
  behaviour: Behaviour,
  seen: string[]
): Promise<void> {
  await page.route('**gibs.earthdata.nasa.gov/**', async (route: Route) => {
    const layers = new URL(route.request().url()).searchParams.get('LAYERS');
    seen.push(layers ?? '?');
    const pick =
      layers === 'VIIRS_SNPP_CorrectedReflectance_TrueColor'
        ? behaviour.viirs
        : layers === 'MODIS_Terra_CorrectedReflectance_TrueColor'
          ? behaviour.terra
          : layers === 'MODIS_Aqua_CorrectedReflectance_TrueColor'
            ? behaviour.aqua
            : 'fail';
    if (pick === 'fail') return route.abort();
    return route.fulfill({
      status: 200,
      contentType: 'image/jpeg',
      headers: { 'access-control-allow-origin': '*' },
      body: pick,
    });
  });
}

export interface Run {
  complement: () => string | undefined;
  source: () => string;
}

/**
 * Charge la Terre et attend que l'image de nuages soit appliquée. `onDemand` : sur un téléphone la
 * couche des nuages ne démarre qu'à la demande, on la coche dans le panneau météo.
 */
export async function boot(page: Page, onDemand = false): Promise<Run> {
  const logs: string[] = [];
  page.on('console', (m) => {
    if (m.text().startsWith('[cloud-debug]')) logs.push(m.text());
  });
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
    localStorage.setItem('ssv-locale', 'en');
  });
  await page.goto('/?body=earth&mode=educ&debug-clouds');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 90_000 });
  if (onDemand) {
    await page.locator('#weather-trigger').tap();
    await expect(page.locator('#weather-layers')).toBeVisible();
    await page.locator('#weather-layers input[data-layer="clouds"]').check();
  }
  await expect
    .poll(() => logs.some((l) => l.includes('true-color source')), {
      timeout: 90_000,
    })
    .toBe(true);
  return {
    complement: () =>
      logs.find((l) => l.startsWith('[cloud-debug] complement')),
    source: () => logs.find((l) => l.includes('true-color source')) ?? '',
  };
}

interface Counts {
  primaryMissing: number;
  filled: number;
  stillMissing: number;
}
const counts = (run: Run): Counts =>
  JSON.parse(
    run.complement()!.replace('[cloud-debug] complement ', '')
  ) as Counts;

/** VIIRS absent, Terra a une fente qu'Aqua observe : elle est comblée et le badge nomme les deux. */
export async function scenarioFill(
  page: Page,
  onDemand = false
): Promise<void> {
  const seen: string[] = [];
  await serveGibs(
    page,
    {
      viirs: await emptyDay(),
      terra: await noisy([100, 119], 1),
      aqua: await noisy([200, 219], 2),
    },
    seen
  );
  const run = await boot(page, onDemand);
  const info = counts(run);
  // La fente de Terra (20 colonnes sur 128 rangées ; la compression JPEG adoucit ses bords, donc un
  // peu moins de pixels passent sous le seuil) est entièrement observée par Aqua.
  expect(info.primaryMissing).toBeGreaterThan(18 * H);
  expect(info.primaryMissing).toBeLessThanOrEqual(20 * H);
  expect(info.filled).toBe(info.primaryMissing);
  expect(info.stillMissing).toBe(0);
  expect(run.source()).toContain('label: MODIS Terra + MODIS Aqua');
  // Une seule requête par instrument pour la même image : le complément ne multiplie rien.
  expect(seen.filter((l) => l.startsWith('MODIS_Aqua_Corrected')).length).toBe(
    1
  );
}

/** Ce que les deux instruments n'ont pas vu reste sans donnée, et le compte le dit. */
export async function scenarioBothMissing(page: Page): Promise<void> {
  await serveGibs(
    page,
    {
      viirs: await emptyDay(),
      terra: await noisy([100, 119], 3),
      // Aqua a, elle aussi, un trou qui recouvre une partie de celui de Terra.
      aqua: await noisy([110, 129], 4),
    },
    []
  );
  const run = await boot(page);
  const info = counts(run);
  expect(info.primaryMissing).toBeGreaterThan(18 * H);
  expect(info.stillMissing).toBeGreaterThan(0);
  expect(info.filled + info.stillMissing).toBe(info.primaryMissing);
}

/** Sans Aqua (échec réseau) : la couche marche comme avant, image seule, badge inchangé, aucune erreur. */
export async function scenarioNoAqua(
  page: Page,
  onDemand = false
): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await serveGibs(
    page,
    {
      viirs: await emptyDay(),
      terra: await noisy([100, 119], 5),
      aqua: 'fail',
    },
    []
  );
  const run = await boot(page, onDemand);
  expect(run.complement()).toBeUndefined();
  expect(run.source()).toContain('label: MODIS Terra,');
  expect(run.source()).not.toContain('Aqua');
  expect(errors).toEqual([]);
}

/** Un jour vide chez Aqua n'est pas recopié : image seule. */
export async function scenarioEmptyAqua(page: Page): Promise<void> {
  await serveGibs(
    page,
    {
      viirs: await emptyDay(),
      terra: await noisy([100, 119], 6),
      aqua: await emptyDay(),
    },
    []
  );
  const run = await boot(page);
  expect(run.complement()).toBeUndefined();
  expect(run.source()).toContain('label: MODIS Terra,');
}

/** VIIRS n'est pas complété : aucune requête MODIS, badge VIIRS. */
export async function scenarioViirsAlone(page: Page): Promise<void> {
  const seen: string[] = [];
  await serveGibs(
    page,
    {
      viirs: await noisy([100, 119], 7),
      terra: await noisy(null, 8),
      aqua: await noisy(null, 9),
    },
    seen
  );
  const run = await boot(page);
  expect(run.complement()).toBeUndefined();
  expect(run.source()).toContain('label: VIIRS');
  expect(
    seen.some((l) => l.startsWith('MODIS_Terra_CorrectedReflectance'))
  ).toBe(false);
  expect(
    seen.some((l) => l.startsWith('MODIS_Aqua_CorrectedReflectance'))
  ).toBe(false);
}
