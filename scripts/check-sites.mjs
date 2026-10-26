#!/usr/bin/env node
/* global console, process, fetch, AbortSignal */
/**
 * Les autres sites d'Adrian répondent-ils encore ? (2026-10-26)
 *
 * Firebase a répondu 509 sur tout le projet partagé `adrianguichard-apps` et plusieurs sites sont
 * restés morts une semaine sans que personne le voie. Ils sont passés sur Cloudflare Pages ;
 * `origin-health.yml` ne regarde que les origines des gros fichiers de Galaxy, et
 * `production-health.yml` que Galaxy. Cette sonde regarde les autres : HTTP 200, un mot qui
 * n'existe que dans CE site (un 509 ou la page d'erreur d'un hébergeur ne le portent pas), servi
 * par Cloudflare, et la CSP quand le site en déclare une.
 *
 * Elle ne mesure que la page d'accueil de chacun : ce n'est pas une suite de tests, c'est
 * l'alarme « le site est mort ».
 *
 * Sortie : 0 tout répond, 1 au moins un site est en défaut, 2 impossible de mesurer (réseau).
 */

/** Une ligne par site. `marker` : texte (sans casse) présent dans la page d'accueil. */
export const SITES = [
  {
    name: 'DevisFlow',
    url: 'https://devisflow.adrianguichard.dev/',
    marker: 'DevisFlow',
    csp: true,
  },
  {
    name: 'SiteGuardian',
    url: 'https://siteguardian.adrianguichard.dev/',
    marker: 'SiteGuardian',
    csp: false,
  },
  {
    name: 'NovaCalc',
    url: 'https://novacalc.adrianguichard.dev/',
    marker: 'novacalc',
    csp: true,
  },
  {
    name: 'MagNotes',
    url: 'https://magnotes.adrianguichard.dev/',
    marker: 'MagNotes',
    csp: true,
  },
  {
    name: 'MagNotes (app)',
    url: 'https://magnotes.adrianguichard.dev/app/',
    marker: 'MagNotes',
    csp: true,
  },
  {
    name: 'Ludora',
    url: 'https://ludora.adrianguichard.dev/',
    marker: 'Ludora',
    csp: true,
  },
  {
    name: 'Comparator',
    url: 'https://comparator-idy.pages.dev/',
    marker: 'Comparator',
    csp: true,
  },
  {
    name: 'Portfolio',
    url: 'https://www.adrianguichard.dev/',
    marker: 'Adrian Guichard',
    csp: true,
  },
];

/** Ce qu'une réponse d'accueil doit porter ; chaque écart est nommé. */
export function judgeSite(response, body, site) {
  const problems = [];
  if (response.status !== 200)
    problems.push(`HTTP ${response.status} au lieu de 200`);
  if (!body.toLowerCase().includes(site.marker.toLowerCase()))
    problems.push(`le texte « ${site.marker} » est absent de la page`);
  const server = (response.headers.get('server') ?? '').toLowerCase();
  if (server !== 'cloudflare')
    problems.push(`servi par « ${server || 'inconnu'} » et non par Cloudflare`);
  if (site.csp && !response.headers.get('content-security-policy'))
    problems.push('Content-Security-Policy absente');
  return problems;
}

async function probe(site) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(site.url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(20_000),
      });
      return { problems: judgeSite(response, await response.text(), site) };
    } catch (error) {
      lastError = error;
    }
  }
  return { unreachable: String(lastError?.cause?.code ?? lastError) };
}

async function main() {
  let broken = 0;
  let unreachable = 0;
  for (const site of SITES) {
    const result = await probe(site);
    if (result.unreachable) {
      unreachable++;
      console.error(
        `? ${site.name} (${site.url}) : illisible, ${result.unreachable}`
      );
    } else if (result.problems.length) {
      broken++;
      console.error(`X ${site.name} (${site.url})`);
      for (const p of result.problems) console.error(`    ${p}`);
    } else {
      console.log(`ok ${site.name} (${site.url})`);
    }
  }
  console.log(
    `${SITES.length - broken - unreachable} sur ${SITES.length} en bonne santé.`
  );
  if (broken) return 1;
  return unreachable ? 2 : 0;
}

if (process.argv[1]?.endsWith('check-sites.mjs'))
  process.exitCode = await main();
