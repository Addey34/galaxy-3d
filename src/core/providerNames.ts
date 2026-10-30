/**
 * UN NOM PAR FOURNISSEUR (audit des panneaux, B5). Le badge d'une couche, le libellé d'une case
 * et l'attribution du panneau nommaient la même source de trois façons (« ERA5 » et « ECMWF ERA5 »,
 * « NOAA GFS » et « NOAA NCEP GFS », « NASA EONET » et « NASA Earth Observatory (EONET) »). Ces
 * noms vivent ici et nulle part ailleurs ; `providerNames.test.ts` refuse un nom écrit en dur
 * dans les modules qui les affichent et confronte `index.html` et le dictionnaire à ce registre.
 * Le nom d'une donnée est celui de son PRODUCTEUR ; le chemin par lequel elle arrive
 * (service Galaxy, Open-Meteo) se dit à part, dans le badge.
 */
export const PROVIDER_NAMES = {
  era5: 'ECMWF ERA5',
  era5t: 'ECMWF ERA5T',
  gfs: 'NOAA GFS',
  openMeteo: 'Open-Meteo',
  usgs: 'USGS',
  eonet: 'NASA EONET',
} as const;

export type ProviderId = keyof typeof PROVIDER_NAMES;
