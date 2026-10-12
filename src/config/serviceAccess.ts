/**
 * COMMENT CHAQUE SERVICE EXTERNE EST BRANCHÉ (lot 46, 2026-10-12), décidé UNE fois par service.
 *
 * Le lot 46 est né d'une API branchée dans le navigateur alors qu'elle comptait son quota par
 * adresse IP : chaque visiteur redemandait la même grille mondiale, et l'épuisait. La règle qui
 * en sort vaut pour toute API à venir. Un service que le navigateur peut joindre (la directive
 * `connect-src` de la CSP, `firebase.json`) est d'une de ces formes, et d'aucune autre :
 *
 *   - `public-tiles` : fait pour servir le public en masse (tuiles, images, flux d'événements),
 *     sans clé et sans quota par point. Joint DIRECTEMENT par le navigateur.
 *   - `own-service` : notre propre service, qui récupère une source une fois et la sert à tous.
 *   - `quota-fallback` : un calcul à la demande, à quota par adresse IP. Jamais la voie
 *     principale : seulement le repli quand notre service ne couvre pas ou ne répond pas, et la
 *     raison est écrite.
 *   - `analytics` : pas une source de données.
 *
 * Une clé d'API n'est JAMAIS dans le navigateur : un service à clé passe par `own-service`.
 * `serviceAccess.test.ts` exige que les hôtes de la CSP et ceux de cette table soient les mêmes,
 * donc brancher une API sans la classer fait échouer `pnpm verify`.
 */
export type ServiceAccess =
  'public-tiles' | 'own-service' | 'quota-fallback' | 'analytics';

export const SERVICE_ACCESS: Readonly<
  Record<string, { access: ServiceAccess; why: string }>
> = {
  'galaxy-data.adrianguichard.dev': {
    access: 'own-service',
    why: 'Le modèle GFS de la NOAA, récupéré une fois par cycle, et l’archive ERA5 construite une fois par heure demandée, servis à tous (lot 46).',
  },
  'gibs.earthdata.nasa.gov': {
    access: 'public-tiles',
    why: 'Service de tuiles et d’images de la NASA (EOSDIS), conçu pour la diffusion publique, sans clé.',
  },
  'trek.nasa.gov': {
    access: 'public-tiles',
    why: 'Tuiles WMTS de surface des Treks de la NASA, sans clé, demandées seulement à l’approche.',
  },
  'earthquake.usgs.gov': {
    access: 'public-tiles',
    why: 'Flux GeoJSON public de l’USGS, une requête par fenêtre de temps, seulement si la couche est active.',
  },
  'eonet.gsfc.nasa.gov': {
    access: 'public-tiles',
    why: 'Flux public d’événements de la NASA (EONET), seulement si la couche est active.',
  },
  'api.open-meteo.com': {
    access: 'quota-fallback',
    why: 'Repli des couches de modèle quand le service de données ne répond pas : quota par IP.',
  },
  'archive-api.open-meteo.com': {
    access: 'quota-fallback',
    why: 'Repli de l’archive ERA5 quand le service ne répond pas ou a atteint son plafond horaire ; quota par IP.',
  },
  'cloudflareinsights.com': {
    access: 'analytics',
    why: 'Comptage de visites sans cookie, décrit dans la politique de confidentialité.',
  },
};
