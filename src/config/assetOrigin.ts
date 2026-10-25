/**
 * D'OÙ VIENNENT LES GROS FICHIERS (textures, modèles de forme, éphémérides) : une adresse de base
 * posée AU BUILD, vide par défaut.
 *
 * Vide, ils viennent du site, comme toujours : la CI, les tests et le développement ne changent
 * pas. Posée (`VITE_ASSET_ORIGIN=https://galaxy-data.adrianguichard.dev`), ils viennent de ce
 * serveur, qui porte ce que Firebase Hosting facture à l'octet : sa limite mensuelle de transfert
 * a coupé le site le 2026-10-24 (10,3 Go pour une visite de 10 à 39 Mo).
 *
 * DEUX origines depuis le 2026-10-25 : les éphémérides se lisent par fenêtres (requêtes `Range`,
 * `core/ephemerisWindow.ts` exige un `Content-Range`), ce que les ressources statiques de Cloudflare
 * ne servent pas (mesuré : 200 et le fichier entier). Elles restent sur le serveur de données
 * (`VITE_ASSET_ORIGIN`) ; textures et modèles, ~280 Mo, viennent de `VITE_STATIC_ORIGIN`
 * (Cloudflare), à défaut de la première.
 *
 * Le build de production ne la pose qu'une fois les fichiers COPIÉS sur ce serveur : une origine
 * posée sans les fichiers rendrait des 404 sans CORS, que le navigateur ne distingue pas d'un
 * refus CORS.
 */
const raw = import.meta.env.VITE_ASSET_ORIGIN;

/** L'origine, sans barre finale, ou `''` quand les fichiers viennent du site. */
export const ASSET_ORIGIN: string =
  typeof raw === 'string' ? raw.trim().replace(/\/+$/, '') : '';

const rawStatic = import.meta.env.VITE_STATIC_ORIGIN;

/** L'origine des textures et modèles, ou celle des éphémérides à défaut. */
export const STATIC_ORIGIN: string =
  typeof rawStatic === 'string' && rawStatic.trim()
    ? rawStatic.trim().replace(/\/+$/, '')
    : ASSET_ORIGIN;

/** Les éphémérides sont lues par `Range` : seule leur origine le sert. */
export function originFor(
  path: string,
  ranged: string = ASSET_ORIGIN,
  whole: string = STATIC_ORIGIN
): string {
  return /^\/*assets\/ephemerides(\/|$)/.test(path) ? ranged : whole;
}

/**
 * Adresse d'un fichier lourd à partir de son chemin `assets/…` (sans barre initiale). Sans origine
 * posée, elle suit `BASE_URL`, qui garde les déploiements sous un sous-chemin.
 */
export function heavyAssetUrl(
  path: string,
  origin: string = originFor(path),
  baseUrl: string = import.meta.env.BASE_URL
): string {
  const clean = path.replace(/^\/+/, '');
  return origin ? `${origin}/${clean}` : `${baseUrl}${clean}`;
}
