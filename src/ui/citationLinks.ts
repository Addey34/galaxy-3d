/**
 * Écrit une citation dont les DOI sont des liens (audit des panneaux, B4). Le texte reste celui
 * que le gabarit de la langue produit : seuls les DOI deviennent des ancres `doi.org`, filtrées
 * par hôte comme tout lien de la fiche (`safeExternalUrl`). Un DOI dont l'adresse est refusée
 * reste du texte.
 */
import { doiUrl, splitCitation } from '@/core/citationParts';
import { safeExternalUrl } from '@/utils/safeUrl';

const DOI_HOSTS: ReadonlySet<string> = new Set(['doi.org']);

export function setCitationText(
  element: HTMLElement,
  text: string,
  dois: readonly string[]
): void {
  const nodes = splitCitation(text, dois).map((part): Node => {
    if (part.kind === 'text') return document.createTextNode(part.text);
    const href = safeExternalUrl(doiUrl(part.doi), DOI_HOSTS);
    if (!href) return document.createTextNode(part.doi);
    const link = document.createElement('a');
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = part.doi;
    return link;
  });
  element.replaceChildren(...nodes);
}
