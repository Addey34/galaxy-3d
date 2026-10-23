import { describe, expect, it } from 'vitest';
import {
  resolveShortcut,
  SHORTCUT_KEYS,
  type ShortcutContext,
  type ShortcutEvent,
} from './keyboardShortcuts';

const key = (k: string, extra: Partial<ShortcutEvent> = {}): ShortcutEvent => ({
  key: k,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  defaultPrevented: false,
  repeat: false,
  ...extra,
});
const free: ShortcutContext = {
  target: 'other',
  tourActive: false,
  modalOpen: false,
  loading: false,
};

describe('raccourcis clavier : ce que chaque touche commande', () => {
  it.each([
    [' ', 'playPause'],
    ['k', 'playPause'],
    ['K', 'playPause'],
    ['/', 'search'],
    ['?', 'help'],
    ['f', 'fullscreen'],
    ['F', 'fullscreen'],
    ['t', 'today'],
    ['m', 'toggleMode'],
  ])('« %s » commande %s', (k, command) => {
    expect(resolveShortcut(key(k), free)).toBe(command);
  });

  it('une touche inconnue ne commande rien', () => {
    for (const k of ['a', 'Enter', 'Escape', 'ArrowLeft', 'Tab'])
      expect(resolveShortcut(key(k), free)).toBeNull();
  });

  it("l'aide et les tests lisent la même liste", () => {
    expect(SHORTCUT_KEYS.map((s) => s.command).sort()).toEqual(
      [
        'fullscreen',
        'help',
        'playPause',
        'playPause',
        'search',
        'today',
        'toggleMode',
      ].sort()
    );
  });
});

describe('raccourcis clavier : quand ils se taisent (falsifié)', () => {
  it('dans un champ de saisie, toute touche appartient au champ', () => {
    for (const k of [' ', '/', 'f', 't', 'm', 'k'])
      expect(
        resolveShortcut(key(k), { ...free, target: 'editable' })
      ).toBeNull();
  });

  it('sur un bouton, Espace est le geste natif et n’est pas doublé, mais une lettre agit', () => {
    const onButton = { ...free, target: 'interactive' } as const;
    expect(resolveShortcut(key(' '), onButton)).toBeNull();
    expect(resolveShortcut(key('f'), onButton)).toBe('fullscreen');
  });

  it('Ctrl, Alt et Méta sont ceux du navigateur', () => {
    for (const mod of ['ctrlKey', 'altKey', 'metaKey'] as const)
      expect(resolveShortcut(key('f', { [mod]: true }), free)).toBeNull();
  });

  it('Maj reste permis : « ? » et, sur AZERTY, « / » en ont besoin', () => {
    expect(resolveShortcut(key('?'), free)).toBe('help');
  });

  it('une touche tenue, un événement déjà traité, un dialogue, une visite ou le chargeur coupent tout', () => {
    expect(resolveShortcut(key(' ', { repeat: true }), free)).toBeNull();
    expect(
      resolveShortcut(key(' ', { defaultPrevented: true }), free)
    ).toBeNull();
    for (const patch of [
      { modalOpen: true },
      { tourActive: true },
      { loading: true },
    ])
      expect(resolveShortcut(key(' '), { ...free, ...patch })).toBeNull();
  });
});
