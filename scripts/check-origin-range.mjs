#!/usr/bin/env node
/* global console, process, fetch */
/**
 * La VM sert-elle encore les éphémérides PAR PLAGE, comme le lecteur l'exige ?
 *
 * `core/ephemerisWindow.ts` demande des fenêtres d'octets (`Range`) et lit `Content-Range` : un
 * serveur qui répond 200 avec le fichier entier (ce que font les ressources statiques de
 * Cloudflare, mesuré le 2026-10-25) ou qui n'expose pas `Content-Range` à l'origine du site rend
 * toutes les éphémérides muettes, sans qu'aucune page ne le dise. `check-asset-origin.mjs` ne
 * voit que la présence et la taille ; cette sonde regarde la plage.
 *
 * Sortie : 0 la plage est servie, 1 elle ne l'est pas, 2 origine illisible.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const PAGE_ORIGIN = 'https://galaxy.adrianguichard.dev';
const LENGTH = 1024;

/** Ce qu'une réponse à `Range: bytes=0-1023` doit porter ; chaque écart est nommé. */
export function judgeRange(response, pageOrigin = PAGE_ORIGIN) {
  const problems = [];
  const header = (name) => response.headers.get(name);
  if (response.status !== 206)
    problems.push(
      `HTTP ${response.status} au lieu de 206 : la plage n'est pas servie`
    );
  const contentRange = header('content-range');
  if (!contentRange || !contentRange.startsWith(`bytes 0-${LENGTH - 1}/`))
    problems.push(`Content-Range absent ou inattendu : ${contentRange}`);
  const allow = header('access-control-allow-origin');
  if (allow !== '*' && allow !== pageOrigin)
    problems.push(`CORS refuse ${pageOrigin} : ${allow}`);
  const exposed = (header('access-control-expose-headers') ?? '')
    .toLowerCase()
    .split(',')
    .map((name) => name.trim());
  if (!exposed.includes('content-range'))
    problems.push(
      `Content-Range n'est pas exposé au navigateur : ${exposed.join(',')}`
    );
  return problems;
}

async function main() {
  const origin = (process.env.VITE_ASSET_ORIGIN ?? '')
    .trim()
    .replace(/\/+$/, '');
  if (!origin) {
    console.error('VITE_ASSET_ORIGIN vide : rien à sonder.');
    return 2;
  }
  const dir = join(process.env.DIST_DIR ?? 'public', 'assets/ephemerides');
  const bin = readdirSync(dir).find((name) => name.endsWith('.bin'));
  if (!bin) {
    console.error(`aucun .bin dans ${dir}`);
    return 2;
  }
  let response;
  try {
    response = await fetch(`${origin}/assets/ephemerides/${bin}`, {
      headers: {
        Range: `bytes=0-${LENGTH - 1}`,
        Origin: PAGE_ORIGIN,
        'Accept-Encoding': 'identity',
      },
    });
  } catch (error) {
    console.error(`${origin} injoignable : ${error?.cause?.code ?? error}`);
    return 2;
  }
  const problems = judgeRange(response);
  if (problems.length) {
    console.error(`plage refusée par ${origin} (${bin}) :`);
    for (const p of problems) console.error(`  ${p}`);
    return 1;
  }
  console.log(`${origin} sert ${bin} par plage (206, Content-Range exposé).`);
  return 0;
}

if (process.argv[1]?.endsWith('check-origin-range.mjs'))
  process.exitCode = await main();
