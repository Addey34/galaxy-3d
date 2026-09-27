import { describe, expect, it } from 'vitest';
import {
  extractSpeech,
  parseSpeechSequence,
  renderSequence,
  unescapePython,
} from './speechTranscript';

/**
 * Toutes les lignes de ce fichier ont été CAPTURÉES par NVDA 2026.2 sur cette application le
 * 2026-09-27, et recopiées telles quelles. Un parseur validé sur des lignes inventées valide
 * l'imagination de celui qui les a écrites : ici, la seule chose qui compte est ce que NVDA
 * écrit vraiment.
 */
describe('parseSpeechSequence', () => {
  it('lit une séquence simple, langue puis texte puis rôle', () => {
    const parts = parseSpeechSequence(
      "[LangChangeCommand ('fr'), 'Couches météo', 'bouton', 'réduit']"
    );
    expect(parts).toEqual([
      { kind: 'lang', value: 'fr' },
      { kind: 'text', value: 'Couches météo' },
      { kind: 'text', value: 'bouton' },
      { kind: 'text', value: 'réduit' },
    ]);
  });

  /**
   * LE DÉFAUT QUI A FAIT NAÎTRE CE MODULE. `repr` de Python bascule sur le guillemet DOUBLE dès
   * que la chaîne contient une apostrophe. Un parseur qui ne connaît que l'apostrophe lit
   * « Réglages d » puis part en vrille sur le reste de la ligne, et le relevé accuse
   * l'application d'un énoncé cassé qui n'existe pas.
   */
  it('lit une chaîne que Python a écrite entre guillemets doubles, apostrophe comprise', () => {
    const parts = parseSpeechSequence(
      `[LangChangeCommand ('fr'), "Réglages d'affichage", 'bouton', 'réduit']`
    );
    expect(parts).toEqual([
      { kind: 'lang', value: 'fr' },
      { kind: 'text', value: "Réglages d'affichage" },
      { kind: 'text', value: 'bouton' },
      { kind: 'text', value: 'réduit' },
    ]);
  });

  it('mélange les deux délimiteurs dans une même séquence', () => {
    const parts = parseSpeechSequence(
      `[LangChangeCommand ('fr'), 'Soutenir ce projet sur Ko-fi', 'lien', "M'offrir un café"]`
    );
    expect(parts.filter((p) => p.kind === 'text').map((p) => p.value)).toEqual([
      'Soutenir ce projet sur Ko-fi',
      'lien',
      "M'offrir un café",
    ]);
  });

  it("écarte ce qui n'est pas entendu : rappels, annulations, mode caractère", () => {
    const parts = parseSpeechSequence(
      "[CallbackCommand(name=say-all:lineReached), LangChangeCommand ('en'), 'button', " +
        'CharacterModeCommand(True), CancellableSpeech (still valid)]'
    );
    expect(parts).toEqual([
      { kind: 'lang', value: 'en' },
      { kind: 'text', value: 'button' },
    ]);
  });

  it('accepte un changement de langue non déclaré', () => {
    expect(parseSpeechSequence('[LangChangeCommand (None), 0]')).toEqual([
      { kind: 'lang', value: null },
    ]);
  });
});

describe('unescapePython', () => {
  it('rend les octets échappés, dont l’espace insécable', () => {
    expect(unescapePython('1,2\\xa0Go')).toBe('1,2 Go');
  });

  it('rend un saut de ligne visible plutôt que de casser la ligne du relevé', () => {
    expect(unescapePython('Aller vers...\\n')).toBe('Aller vers...⏎');
  });

  it("rend l'apostrophe et le guillemet échappés", () => {
    expect(unescapePython("L\\'objet")).toBe("L'objet");
    expect(unescapePython('le \\"corps\\"')).toBe('le "corps"');
  });
});

describe('renderSequence', () => {
  /**
   * Le cas qui compte pour cette passe : du texte FRANÇAIS annoncé sous une langue anglaise est
   * lu par une voix anglaise. Le relevé doit le NOMMER, pas le lisser.
   */
  it('signale une langue qui diffère de celle de la page', () => {
    const rendered = renderSequence(
      parseSpeechSequence(
        "[LangChangeCommand ('fr'), 'Fermer la visite', LangChangeCommand ('en'), 'button']"
      ),
      'fr'
    );
    expect(rendered).toEqual(['Fermer la visite', 'button ⟨en⟩']);
  });

  it('ne signale rien quand la langue est celle de la page', () => {
    const rendered = renderSequence(
      parseSpeechSequence("[LangChangeCommand ('fr_FR'), 'Soleil', 'bouton']"),
      'fr'
    );
    expect(rendered).toEqual(['Soleil', 'bouton']);
  });

  it('écarte les morceaux vides', () => {
    expect(
      renderSequence(parseSpeechSequence("['', '  ', 'bouton']"), 'fr')
    ).toEqual(['bouton']);
  });
});

describe('extractSpeech', () => {
  it("ne garde que les lignes d'énoncé, dans l'ordre, et écarte les séquences vides", () => {
    const chunk = [
      'IO - speech.speak (05:13:57.730) - MainThread (40596):',
      "Speaking [LangChangeCommand ('fr'), 'Soleil', 'bouton']",
      'DEBUG - quelque chose qui ne se dit pas',
      'Speaking [CallbackCommand(name=say-all:stop)]',
      "Speaking [LangChangeCommand ('fr'), 'Mercure', 'bouton']",
    ].join('\n');
    expect(extractSpeech(chunk, 'fr')).toEqual([
      ['Soleil', 'bouton'],
      ['Mercure', 'bouton'],
    ]);
  });
});
