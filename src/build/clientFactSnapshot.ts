/**
 * LE RELEVÉ DES FAITS TEL QUE LE NAVIGATEUR LE REÇOIT : les seuls rayons publiés (lot 52, B).
 *
 * `src/config/factSources.snapshot.json` (163 483 octets) n'a qu'un lecteur dans l'application,
 * `config/bodyFigure.ts`, qui n'y lit que `naifRotation.bodies[corps].radiiKm`. L'élagage de Vite
 * s'arrête à la clé de premier niveau : il embarquait donc toute la section `naifRotation`
 * (11 342 octets mesurés : identifiants NAIF, systèmes, coefficients de rotation) pour 1 047
 * octets de rayons. Le greffon `clientFactSnapshot` de `vite.config.ts` remplace, côté client
 * seulement, le relevé par ce que rend cette fonction ; les tests et les pages générées lisent
 * toujours le fichier entier.
 *
 * Deux gardes la tiennent (`clientFactSnapshot.test.ts`) : chaque corps garde EXACTEMENT ses
 * rayons, et aucun autre module livré n'importe le relevé, sans quoi il recevrait un objet
 * amputé sans le savoir.
 */
type RadiiEntry = { readonly radiiKm?: readonly number[] | null };

export function clientFactSnapshot(snapshot: {
  naifRotation: { bodies: Record<string, RadiiEntry> };
}): { naifRotation: { bodies: Record<string, { radiiKm: number[] }> } } {
  const bodies: Record<string, { radiiKm: number[] }> = {};
  for (const [name, entry] of Object.entries(snapshot.naifRotation.bodies))
    if (Array.isArray(entry.radiiKm))
      bodies[name] = { radiiKm: [...entry.radiiKm] };
  return { naifRotation: { bodies } };
}
