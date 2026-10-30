/**
 * Découpe un texte de citation en morceaux de texte et en DOI (audit des panneaux, B4).
 *
 * La fiche de Titan citait le DOI du paquet PDS en TEXTE : un identifiant stable qu'on ne pouvait
 * pas suivre. Chaque DOI donné et présent dans le texte devient un morceau `doi`, que l'interface
 * écrit en lien `doi.org` ; le reste reste du texte. Pur : ni DOM ni langue. Un DOI absent du
 * texte (le gabarit d'une langue peut l'omettre) ne produit rien.
 */
export type CitationPart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'doi'; readonly doi: string };

/** L'adresse `doi.org` d'un DOI, ses caractères réservés encodés. */
export function doiUrl(doi: string): string {
  return `https://doi.org/${encodeURI(doi)}`;
}

export function splitCitation(
  text: string,
  dois: readonly string[]
): CitationPart[] {
  const parts: CitationPart[] = [];
  let rest = text;
  for (;;) {
    let best: { index: number; doi: string } | null = null;
    for (const doi of dois) {
      if (!doi) continue;
      const index = rest.indexOf(doi);
      // Le plus tôt gagne ; à égalité, le plus long (un DOI peut préfixer un autre).
      if (
        index >= 0 &&
        (best === null ||
          index < best.index ||
          (index === best.index && doi.length > best.doi.length))
      )
        best = { index, doi };
    }
    if (best === null) break;
    if (best.index > 0)
      parts.push({ kind: 'text', text: rest.slice(0, best.index) });
    parts.push({ kind: 'doi', doi: best.doi });
    rest = rest.slice(best.index + best.doi.length);
  }
  if (rest) parts.push({ kind: 'text', text: rest });
  return parts;
}
