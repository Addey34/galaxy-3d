/**
 * Casse et accents pliés, apostrophes et tirets unifiés : « Ōkina », « ʻOumuamua » ou « Rhéa »
 * se trouvent comme on les tape sur un clavier sans accents.
 */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ʻʼ’'`´]/g, '')
    .replace(/[-‐‑–_/]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
