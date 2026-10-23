/**
 * LES RACCOURCIS CLAVIER : la DÉCISION, sans DOM (testée).
 *
 * Quelle commande une frappe déclenche, ou aucune. `ui/keyboardShortcuts.ts` la lit et clique le
 * bouton qui porte déjà la commande : un raccourci n'est pas une seconde voie, c'est la même.
 *
 * Les touches sont celles des lecteurs vidéo et des sites qu'on a déjà pratiqués : Espace (et K)
 * lecture/pause, `/` la recherche, `?` l'aide, `F` le plein écran. S'y ajoutent `T` (le présent,
 * « today ») et `M` (l'autre mode). On lit `key` et non `code` : sur un clavier AZERTY, `/` et `?`
 * ne sont pas aux places d'un clavier américain, et seul `key` suit la disposition.
 */

export type ShortcutCommand =
  'playPause' | 'search' | 'help' | 'fullscreen' | 'today' | 'toggleMode';

/** Ce que la cible de la frappe est, vu du raccourci. */
export type ShortcutTarget =
  /** Un champ où l'on écrit : toute touche lui appartient. */
  | 'editable'
  /** Un bouton, un lien, un curseur… : Espace l'ACTIVE déjà, on ne le double pas. */
  | 'interactive'
  | 'other';

export interface ShortcutEvent {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  defaultPrevented: boolean;
  /** `KeyboardEvent.repeat` : une touche tenue ne bascule pas vingt fois la lecture. */
  repeat: boolean;
}

export interface ShortcutContext {
  target: ShortcutTarget;
  /** Une visite guidée tourne : elle a ses propres touches (Espace la met en pause). */
  tourActive: boolean;
  /** Un dialogue modal est ouvert : le clavier lui appartient. */
  modalOpen: boolean;
  /** Le chargeur est encore à l'écran : rien n'est prêt à être commandé. */
  loading: boolean;
}

const BY_KEY: Readonly<Record<string, ShortcutCommand>> = {
  ' ': 'playPause',
  k: 'playPause',
  '/': 'search',
  '?': 'help',
  f: 'fullscreen',
  t: 'today',
  m: 'toggleMode',
};

/** Les raccourcis, pour l'aide et pour les tests : une seule liste, lue par les deux. */
export const SHORTCUT_KEYS: readonly {
  key: string;
  command: ShortcutCommand;
}[] = Object.entries(BY_KEY).map(([key, command]) => ({ key, command }));

export function resolveShortcut(
  event: ShortcutEvent,
  context: ShortcutContext
): ShortcutCommand | null {
  if (event.defaultPrevented || event.repeat) return null;
  // Ctrl, Alt et Méta sont ceux du navigateur et du système (Ctrl+F, Cmd+T…). Maj reste permis :
  // `?` en a besoin, et sur AZERTY `/` aussi.
  if (event.ctrlKey || event.altKey || event.metaKey) return null;
  if (context.loading || context.modalOpen || context.tourActive) return null;
  if (context.target === 'editable') return null;

  const command =
    BY_KEY[event.key.length === 1 ? event.key.toLowerCase() : event.key];
  if (!command) return null;
  // Sur un bouton, Espace (et Entrée) est le geste natif : le doubler ferait agir deux fois.
  if (event.key === ' ' && context.target === 'interactive') return null;
  return command;
}
