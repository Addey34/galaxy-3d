/**
 * Coupe un texte en morceaux : du texte, ou une adresse https. Pur et sans DOM : la couche UI décide
 * quelles adresses elle accepte de rendre cliquables (`safeExternalUrl`). La ponctuation qui suit
 * une adresse (point, virgule, parenthèse fermante) reste du texte.
 */
export type TextPart = { kind: 'text' | 'url'; value: string };

const URL_PATTERN = /https:\/\/[^\s<>"]+/g;
const TRAILING = /[.,;:!?)\]]+$/;

export function splitUrls(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    const url = match[0].replace(TRAILING, '');
    if (start > last)
      parts.push({ kind: 'text', value: text.slice(last, start) });
    parts.push({ kind: 'url', value: url });
    last = start + url.length;
  }
  if (last < text.length) parts.push({ kind: 'text', value: text.slice(last) });
  return parts;
}
