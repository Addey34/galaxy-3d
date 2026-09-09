import type { Page, BrowserContext } from '@playwright/test';

/**
 * Lecture de l'ARBRE D'ACCESSIBILITÉ calculé par Chromium — la donnée qu'un lecteur d'écran
 * consomme réellement (rôle, nom accessible, états).
 *
 * Pourquoi passer par CDP : `page.accessibility.snapshot()` a été retiré de Playwright. CDP
 * `Accessibility.getFullAXTree` expose la même chose, en plus complet (les propriétés d'état).
 *
 * Ce que cela ajoute à axe-core, qui tourne déjà sur neuf panneaux : axe vérifie des RÈGLES et
 * passe tranquillement sur un bouton dont le nom accessible est « Button », sur une boîte de
 * dialogue sans nom, ou sur un interrupteur dont `aria-pressed` ne bouge jamais. Ici on lit les
 * valeurs elles-mêmes.
 *
 * Ce que cela n'est PAS : une vérification de ce qu'un lecteur d'écran ANNONCE. Cela dépend du
 * lecteur, de sa version, de sa verbosité et du navigateur, et aucune API ne permet de le
 * capturer. Le passage manuel NVDA/VoiceOver reste le vrai juge — voir `docs/TESTING.md`.
 */
export interface AXControl {
  role: string;
  name: string;
  states: Record<string, unknown>;
}

interface RawAXNode {
  role?: { value?: string };
  name?: { value?: string };
  ignored?: boolean;
  properties?: { name: string; value?: { value?: unknown } }[];
}

const STATE_NAMES = /^(expanded|pressed|checked|disabled|selected)$/;

/**
 * Normalise les valeurs d'état. Piège réel de CDP : `expanded` revient en BOOLÉEN et `pressed`
 * en CHAÎNE (« true »/« false »/« mixed », le type `tristate` de la spécification ARIA). Un
 * test qui compare naïvement à `true` passe donc pour l'un et échoue pour l'autre — ou, pire,
 * passe pour de mauvaises raisons si on compare de façon lâche.
 */
function normaliseState(value: unknown): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

/** Tous les contrôles interactifs exposés, avec leur nom et leurs états. */
export async function readAXControls(
  page: Page,
  context: BrowserContext
): Promise<AXControl[]> {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Accessibility.enable');
  const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as {
    nodes: RawAXNode[];
  };
  await cdp.detach();
  return nodes
    .filter(
      (node) =>
        !node.ignored &&
        /^(button|link|checkbox|switch|slider|combobox|dialog|tab)$/.test(
          node.role?.value ?? ''
        )
    )
    .map((node) => ({
      role: node.role?.value ?? '',
      name: node.name?.value ?? '',
      states: Object.fromEntries(
        (node.properties ?? [])
          .filter((property) => STATE_NAMES.test(property.name))
          .map((property) => [
            property.name,
            normaliseState(property.value?.value),
          ])
      ),
    }));
}

/** Le premier contrôle dont le nom accessible correspond, ou `undefined`. */
export function findControl(
  controls: AXControl[],
  name: string | RegExp
): AXControl | undefined {
  const test =
    typeof name === 'string'
      ? (v: string) => v === name
      : (v: string) => name.test(v);
  return controls.find((control) => test(control.name));
}
