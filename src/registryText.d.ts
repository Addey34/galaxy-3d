/**
 * Les modules VIRTUELS du texte de registre, déclarés pour TypeScript.
 *
 * Ils n'existent pas sur le disque : le greffon `deriveRegistryText` de `vite.config.ts` les
 * construit depuis les fiches au moment où on les demande (une carte « anglais -> traduction »
 * par langue). Sans cette déclaration, `import('virtual:registry-text/es')` ne compile pas, et
 * l'écrire en `any` ferait perdre le seul type qui compte ici : c'est bien un dictionnaire de
 * chaînes, pas un objet quelconque.
 */
declare module 'virtual:registry-text/catalogue-fr' {
  const map: Record<string, string>;
  export default map;
}
declare module 'virtual:registry-text/catalogue-es' {
  const map: Record<string, string>;
  export default map;
}
declare module 'virtual:registry-text/catalogue-pt-BR' {
  const map: Record<string, string>;
  export default map;
}
// Le texte LONG des fiches, dans les quatre langues : chargé à la première ouverture d'une fiche
// (`config/cardText.ts`).
declare module 'virtual:registry-text/card-en' {
  const map: Record<string, string>;
  export default map;
}
declare module 'virtual:registry-text/card-fr' {
  const map: Record<string, string>;
  export default map;
}
declare module 'virtual:registry-text/card-es' {
  const map: Record<string, string>;
  export default map;
}
declare module 'virtual:registry-text/card-pt-BR' {
  const map: Record<string, string>;
  export default map;
}
