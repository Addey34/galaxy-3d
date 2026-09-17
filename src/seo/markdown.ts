/**
 * Rendu Markdown MINIMAL, pour publier `THIRD_PARTY_NOTICES.md` sur `/sources` sans en garder
 * une copie HTML écrite à la main (qui dériverait du fichier au premier ajout de modèle).
 *
 * Volontairement limité au sous-ensemble que ce fichier emploie : titres, paragraphes, listes à
 * puces et numérotées avec lignes de continuation indentées, gras, italique, code en ligne,
 * liens `[texte](cible)` et `<https://…>`. Tout ce qui sort de ce sous-ensemble est rendu comme
 * du texte échappé, jamais comme du HTML : le fichier est versionné, mais une page publique ne
 * doit pas dépendre de ce qu'un contributeur y colle.
 *
 * Module PUR, build uniquement.
 */
import { escapeHtml } from './bodyLandingPage';

export interface MarkdownOptions {
  /**
   * Base à laquelle rattacher un lien RELATIF (`LICENSE.md`, `scripts/texture-sources.json`) :
   * sur le site, ces chemins n'existent pas, ils existent dans le dépôt public.
   */
  repositoryBlobUrl: string;
  /** Décalage des niveaux de titre : `#` du fichier devient `h{1 + shift}`. */
  headingShift: number;
}

/**
 * Marqueurs de réservation : caractères à usage privé, que `escapeHtml` ne touche pas et
 * qu'aucun texte réel du fichier ne contient.
 */
const CODE_MARK = String.fromCharCode(0xe000);
const LINK_MARK = String.fromCharCode(0xe001);
const codeSlot = new RegExp(`${CODE_MARK}(\\d+)${CODE_MARK}`, 'g');
const linkSlot = new RegExp(`${LINK_MARK}(\\d+)${LINK_MARK}`, 'g');

/** Gras, italique, code, liens : sur du texte DÉJÀ échappé, sauf les URL réinjectées. */
export function renderInline(text: string, options: MarkdownOptions): string {
  // Le code d'abord, mis de côté : son contenu ne doit subir aucune autre règle.
  const codes: string[] = [];
  let out = text.replace(/`([^`]+)`/g, (_, code: string) => {
    codes.push(`<code>${escapeHtml(code)}</code>`);
    return `${CODE_MARK}${codes.length - 1}${CODE_MARK}`;
  });
  const links: string[] = [];
  const link = (label: string, target: string): string => {
    const href = /^https?:\/\//.test(target)
      ? target
      : `${options.repositoryBlobUrl}/${target.replace(/^\.?\//, '')}`;
    links.push(
      `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${label}</a>`
    );
    return `${LINK_MARK}${links.length - 1}${LINK_MARK}`;
  };
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, target) =>
    link(
      escapeHtml(label).replace(codeSlot, (_m, i) => codes[Number(i)]!),
      target
    )
  );
  out = out.replace(/<(https?:\/\/[^>\s]+)>/g, (_, url: string) =>
    link(escapeHtml(url), url)
  );
  out = escapeHtml(out)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, '$1<em>$2</em>');
  return out
    .replace(linkSlot, (_, i) => links[Number(i)]!)
    .replace(codeSlot, (_, i) => codes[Number(i)]!);
}

interface ListItem {
  lines: string[];
}

/** Markdown → HTML, bloc par bloc. */
export function renderMarkdown(
  source: string,
  options: MarkdownOptions
): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: ListItem[] } | null = null;

  const flushParagraph = (): void => {
    if (paragraph.length === 0) return;
    html.push(`<p>${renderInline(paragraph.join(' '), options)}</p>`);
    paragraph = [];
  };
  const flushList = (): void => {
    if (!list) return;
    const tag = list.ordered ? 'ol' : 'ul';
    const items = list.items
      .map((item) => `<li>${renderInline(item.lines.join(' '), options)}</li>`)
      .join('');
    html.push(`<${tag}>${items}</${tag}>`);
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === '') {
      flushParagraph();
      // Une ligne vide ne ferme pas la liste : l'élément suivant peut encore la prolonger.
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(6, heading[1]!.length + options.headingShift);
      html.push(`<h${level}>${renderInline(heading[2]!, options)}</h${level}>`);
      continue;
    }
    const bullet = /^([-*]|\d+\.)\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      const ordered = /\d/.test(bullet[1]!);
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push({ lines: [bullet[2]!] });
      continue;
    }
    if (list && /^\s+\S/.test(line)) {
      list.items[list.items.length - 1]!.lines.push(line.trim());
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return html.join('\n');
}
