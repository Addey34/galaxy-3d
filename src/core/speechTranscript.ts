/**
 * LIRE CE QU'UN LECTEUR D'ÉCRAN A DIT (lot 19).
 *
 * NVDA écrit chaque énoncé dans son journal, au niveau IO, sous la forme d'un `repr` Python :
 *
 *     Speaking [LangChangeCommand ('fr'), 'Fermer la visite', LangChangeCommand ('en'), 'button']
 *
 * Ce module transforme ces lignes en transcript lisible. Il est PUR et vit ici, et non dans le
 * script de capture, pour une raison que ce dépôt a déjà payée : **une mesure fausse est pire
 * qu'une mesure absente**. Le premier parseur écrit pour cette passe ne connaissait que
 * l'apostrophe ; or `repr` bascule sur le guillemet double dès que la chaîne en contient une,
 * si bien que « Réglages d'affichage » ressortait en « affichage", , ] ». Le relevé accusait
 * l'application d'un défaut qui était le mien. Le parseur est donc tenu par des tests, sur des
 * lignes RÉELLEMENT capturées.
 *
 * Ce module n'est importé que par `scripts/capture-screenreader.mjs` et par ses tests : il ne
 * fait pas partie du bundle servi (même propriété que `core/startupBudget.ts`).
 */

/** Un morceau d'une séquence de parole : du texte énoncé, ou un changement de langue. */
export type SpeechPart =
  { kind: 'text'; value: string } | { kind: 'lang'; value: string | null };

/**
 * Décompose la séquence journalisée (le contenu des crochets) en morceaux.
 *
 * Tout ce qui n'est ni une chaîne ni un changement de langue est ignoré : `CallbackCommand`,
 * `CancellableSpeech`, `EndUtteranceCommand`, `BeepCommand`, `PitchCommand`… Ce sont des
 * instructions pour la synthèse, pas des mots entendus.
 */
export function parseSpeechSequence(raw: string): SpeechPart[] {
  const parts: SpeechPart[] = [];
  let i = 0;
  while (i < raw.length) {
    const char = raw[i];
    // Les DEUX délimiteurs de Python. `repr("Réglages d'affichage")` rend une chaîne entre
    // guillemets DOUBLES ; n'en lire qu'un seul coupe l'énoncé en morceaux.
    if (char === "'" || char === '"') {
      const quote = char;
      let j = i + 1;
      let text = '';
      while (j < raw.length && raw[j] !== quote) {
        if (raw[j] === '\\') {
          text += raw[j] + (raw[j + 1] ?? '');
          j += 2;
          continue;
        }
        text += raw[j];
        j += 1;
      }
      parts.push({ kind: 'text', value: unescapePython(text) });
      i = j + 1;
      continue;
    }
    if (raw.startsWith('LangChangeCommand', i)) {
      const match = /^LangChangeCommand \((?:None|'([^']*)')\)/.exec(
        raw.slice(i)
      );
      if (match) {
        parts.push({ kind: 'lang', value: match[1] ?? null });
        i += match[0].length;
        continue;
      }
    }
    i += 1;
  }
  return parts;
}

/**
 * Les échappements que `repr` a posés. Le saut de ligne devient un symbole visible (`⏎`)
 * plutôt que de casser la ligne du tableau du relevé.
 */
export function unescapePython(text: string): string {
  return text
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/\\n/g, '\u23ce')
    .replace(/\\r/g, '')
    .replace(/\\t/g, ' ')
    .replace(/\\(['"\\])/g, '$1');
}

/**
 * Rend la séquence dans l'ORDRE où elle est énoncée.
 *
 * La langue n'est signalée que lorsqu'elle DIFFÈRE de celle de la page, parce que c'est le seul
 * cas qui change ce qu'on entend : du texte français annoncé sous une langue anglaise est lu
 * par une voix anglaise, et c'est un défaut que ce relevé doit pouvoir nommer.
 */
export function renderSequence(
  parts: readonly SpeechPart[],
  pageLang: string
): string[] {
  let lang: string | null = null;
  const out: string[] = [];
  for (const part of parts) {
    if (part.kind === 'lang') {
      lang = part.value;
      continue;
    }
    const text = part.value.replace(/\u00a0/g, ' ').trim();
    if (!text) continue;
    out.push(
      lang && lang.slice(0, 2) !== pageLang
        ? `${text} \u27e8${lang}\u27e9`
        : text
    );
  }
  return out;
}

/** Les séquences énoncées dans un fragment de journal, dans l'ordre, les vides écartées. */
export function extractSpeech(chunk: string, pageLang: string): string[][] {
  return chunk
    .split(/\r?\n/)
    .filter((line) => line.startsWith('Speaking ['))
    .map((line) => renderSequence(parseSpeechSequence(line.slice(9)), pageLang))
    .filter((sequence) => sequence.length > 0);
}
