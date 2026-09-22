import { expect, test } from '@playwright/test';
import { blockExternalNetwork } from './netBlock';

/**
 * LES OBJETS D'INSTRUMENT PORTENT ENFIN DES CHIFFRES SOURCÉS. Leurs fiches de registre
 * portaient une date de lancement sans champ `source`, et un fait sans provenance ne s'affiche
 * pas : les onze sondes et les trois interstellaires ouvraient donc une fiche vide de toute
 * valeur. Ce qui se vérifie ici est ce qu'un visiteur voit, pas ce que le catalogue contient.
 */
test.beforeEach(async ({ page }) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('ssv-guided-tour-v1', '1');
    localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
  });
});

test('a probe card shows its launch date and mass, each citing a source', async ({
  page,
}) => {
  // Le permalien d'un objet d'instrument doit aussi le ROUVRIR : l'application écrivait
  // `?body=voyager1` en le sélectionnant, puis refusait de le relire au chargement.
  await page.goto('/?body=voyager1');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  const card = page.locator('#body-info');
  await expect(card).toBeVisible();
  await expect(card.locator('.bi-name')).toHaveText('Voyager 1');

  const rows = card.locator('.bi-stats dt');
  await expect(rows.filter({ hasText: 'Launch date' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'Mass' })).toHaveCount(1);

  // La masse d'une sonde se lit en kilogrammes : la notation scientifique, indispensable pour
  // une planète, donnait « 7,22 × 10² kg » pour 721,9 kg publiés.
  const mass = card.locator('.bi-stats dd').filter({ hasText: 'kg' }).first();
  await expect(mass).toContainText('721.9 kg');
  await expect(mass).not.toContainText('×');

  // Chaque valeur renvoie à une source numérotée, et la source est bien le catalogue NSSDCA.
  await expect(card.locator('.bi-sources')).toContainText('NSSDCA');

  // Lot 10 : le lanceur et le site, recopiés tels que le catalogue NSSDCA les écrit.
  const vehicle = card.locator('.bi-stats dt', { hasText: 'Launch vehicle' });
  await expect(vehicle).toHaveCount(1);
  await expect(vehicle.locator('+ dd')).toContainText('Titan IIIE-Centaur');
  const site = card.locator('.bi-stats dt', { hasText: 'Launch site' });
  await expect(site.locator('+ dd')).toContainText(
    'Cape Canaveral, United States'
  );
});

test('an interstellar asteroid shows its absolute magnitude, a comet says why it cannot', async ({
  page,
}) => {
  // La SBDB publie H pour ʻOumuamua, et M1 (magnitude totale, chevelure comprise) pour les
  // deux comètes : une autre grandeur, donc une raison au lieu d'un chiffre.
  await page.goto('/?body=oumuamua');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  const card = page.locator('#body-info');
  await expect(card).toBeVisible();
  const magnitude = card.locator('.bi-stats dt', {
    hasText: 'Absolute magnitude',
  });
  await expect(magnitude.locator('+ dd')).toContainText('22.08 (± 0.45)');

  await page.goto('/?body=borisov');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });
  await expect(card).toBeVisible();
  const refused = card
    .locator('.bi-stats dt', { hasText: 'Absolute magnitude' })
    .locator('+ dd');
  await expect(refused).toHaveClass(/is-unknown/);
  await expect(refused).toHaveAttribute('title', /M1/);
});

test('a value the source does not describe is refused, with its reason', async ({
  page,
}) => {
  // Le catalogue NSSDCA donne 365 kg pour BepiColombo, que sa PROPRE page attribue au seul
  // module de propulsion (la pile du MPO pesait 1229 kg au lancement). La fiche ne montre donc
  // pas de masse, et dit pourquoi : une ligne absente ne se distinguerait pas d'un oubli.
  await page.goto('/?body=bepicolombo');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  const card = page.locator('#body-info');
  await expect(card).toBeVisible();
  const unknown = card.locator('dd.is-unknown[title^="No published value"]');
  await expect(unknown).toHaveCount(1);
  await expect(unknown).toHaveAttribute('title', /365 kg/);
});

test('an interstellar object shows the eccentricity that makes it interstellar', async ({
  page,
}) => {
  await page.goto('/?body=atlas');
  await expect(page.locator('#loader')).toBeHidden({ timeout: 30_000 });

  const card = page.locator('#body-info');
  await expect(card).toBeVisible();
  const stats = card.locator('.bi-stats');
  await expect(
    stats.locator('dt').filter({ hasText: 'Eccentricity' })
  ).toHaveCount(1);
  // 6,14 : très au-dessus de 1, donc une orbite ouverte. La valeur vient des éléments du
  // registre, la provenance de la SBDB, et `factProvenance.test.ts` confronte les deux.
  await expect(stats).toContainText('6.141');
  await expect(
    stats.locator('dt').filter({ hasText: 'First observation' })
  ).toHaveCount(1);
});
