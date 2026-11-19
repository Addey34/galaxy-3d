/* global console, process, localStorage, window */
/**
 * ÉCLAIRAGE D'UN SITE DE SURFACE : Galaxy contre une référence indépendante (GAL-IMMERSION-001).
 *
 * Hors `verify`, pas un script `pnpm`, nécessite un serveur (dev ou preview) :
 *
 *   node scripts/measure-surface-light.mjs --origin http://localhost:5391
 *   node scripts/measure-surface-light.mjs --origin <url> --json reports/perf/surface-light.json
 *
 * CÔTÉ GALAXY : la sonde `?debug-light` (`src/ui/lightProbe.ts`) lit le graphe de scène réel :
 * le site posé par `surfacePointToWorld`, la direction de la PointLight solaire en ce site, le
 * point subsolaire par `worldPointToGeographic`. Normale GÉOMÉTRIQUE : ni relief, ni albédo.
 *
 * CÔTÉ RÉFÉRENCE (aucun code de Galaxy : ni `frames.ts`, ni la scène, ni `core/timeScale`) :
 *  - Lune et Mars : astronomy-engine `RotationAxis` = modèle de rotation IAU 2015 (α0, δ0, W),
 *    puis la définition IAU du repère fixe : R = Rz(W) · Rx(90° - δ0) · Rz(90° + α0) appliquée
 *    à la direction du Soleil (vecteur EQJ vu du CENTRE du corps). Longitude planétocentrique
 *    EST positive, comme la texture ;
 *  - Terre : `Observer` + `Equator` + `Horizon` (temps sidéral), comme `geoDebug`.
 * Les deux chemins ne partagent que la date, que la sonde RAPPORTE (la référence est calculée à
 * la date réellement affichée par la scène, pas à celle demandée).
 *
 * ÉCHELLES DE TEMPS : la référence passe la date UTC à astronomy-engine (TT = UTC + ΔT du modèle
 * de la bibliothèque, ~40 s en 1969 ; la Lune tourne de 0,55 arcsec/s : sans effet ici).
 */
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import {
  Body,
  Equator,
  GeoVector,
  Horizon,
  MakeTime,
  Observer,
  RotationAxis,
} from 'astronomy-engine';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const ORIGIN = flag('--origin', 'http://localhost:5391').replace(/\/$/, '');
const JSON_OUT = flag('--json', null);
const ONLY = flag('--only', null);

const D = Math.PI / 180;
const wrap180 = (x) => ((((x + 180) % 360) + 360) % 360) - 180;

const rz = (a, v) => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: c * v.x + s * v.y, y: -s * v.x + c * v.y, z: v.z };
};
const rx = (a, v) => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x, y: c * v.y + s * v.z, z: -s * v.y + c * v.z };
};
const unit = (v) => {
  const n = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / n, y: v.y / n, z: v.z / n };
};

/** Direction EQJ -> repère fixe IAU du corps (x au méridien origine, z au pôle nord). */
function toBodyFixed(astroBody, time, eqj) {
  const ax = RotationAxis(astroBody, time);
  return rz(
    ax.spin * D,
    rx(Math.PI / 2 - ax.dec * D, rz(Math.PI / 2 + ax.ra * 15 * D, eqj))
  );
}

/** Vecteur EQJ (AU) du Soleil / de la Terre vu du centre d'un corps : par astronomy-engine. */
function fromBody(astroBody, target, time) {
  const t = GeoVector(target, time, false);
  if (astroBody === Body.Earth) return t;
  const b = GeoVector(astroBody, time, false);
  return { x: t.x - b.x, y: t.y - b.y, z: t.z - b.z };
}

function referenceIau(astroBody, date, latDeg, lonDeg) {
  const time = MakeTime(date);
  const sun = toBodyFixed(
    astroBody,
    time,
    unit(fromBody(astroBody, Body.Sun, time))
  );
  const earthV =
    astroBody === Body.Earth
      ? null
      : unit(fromBody(astroBody, Body.Earth, time));
  const earth = earthV ? toBodyFixed(astroBody, time, earthV) : null;
  const lonLat = (v) => ({
    longitudeDeg: Math.atan2(v.y, v.x) / D,
    latitudeDeg: Math.asin(v.z) / D,
  });
  const lat = latDeg * D;
  const lon = lonDeg * D;
  const site = {
    x: Math.cos(lat) * Math.cos(lon),
    y: Math.cos(lat) * Math.sin(lon),
    z: Math.sin(lat),
  };
  const dot = site.x * sun.x + site.y * sun.y + site.z * sun.z;
  return {
    subsolar: lonLat(sun),
    subEarth: earth ? lonLat(earth) : null,
    dot,
    sunAltitudeDeg: Math.asin(dot) / D,
  };
}

function referenceEarth(date, latDeg, lonDeg) {
  const time = MakeTime(date);
  const observer = new Observer(latDeg, lonDeg, 0);
  const eq = Equator(Body.Sun, time, observer, true, true);
  const hor = Horizon(time, observer, eq.ra, eq.dec, 'normal');
  return {
    subsolar: null,
    subEarth: null,
    dot: Math.sin(hor.altitude * D),
    sunAltitudeDeg: hor.altitude,
    sunAzimuthDeg: hor.azimuth,
  };
}

/** La matrice : corps, instants, sites. Les instants du témoin Apollo 11 sont ceux de la NASA. */
const MOON_SITES = [
  { id: 'apollo11-statio-tranquillitatis', lat: 0.674, lon: 23.473 },
  { id: 'apollo14-fra-mauro', lat: -3.645, lon: -17.471 },
  { id: 'tycho', lat: -43.3, lon: -11.36 },
  { id: 'near-side-centre', lat: 0, lon: 0 },
  { id: 'east-limb', lat: 0, lon: 90 },
  { id: 'west-limb', lat: 0, lon: -90 },
  { id: 'far-side', lat: 0, lon: 180 },
  { id: 'north-60', lat: 60, lon: 30 },
];
const MOON_DATES = [
  '1969-07-20T20:17:40Z',
  '1969-07-24T12:00:00Z',
  '2000-01-06T18:14:00Z',
  '2026-11-20T06:00:00Z',
  '2026-12-05T12:00:00Z',
];
const MARS_SITES = [
  { id: 'jezero', lat: 18.44, lon: 77.45 },
  { id: 'gale', lat: -5.4, lon: 137.8 },
  { id: 'origin', lat: 0, lon: 0 },
  { id: 'antimeridian', lat: 0, lon: 180 },
  { id: 'west', lat: 30, lon: -100 },
];
const MARS_DATES = ['2000-01-01T12:00:00Z', '2026-06-01T00:00:00Z'];
const EARTH_SITES = [
  { id: 'greenwich', lat: 51.48, lon: 0 },
  { id: 'tokyo', lat: 35.68, lon: 139.69 },
  { id: 'quito', lat: -0.18, lon: -78.47 },
  { id: 'sydney', lat: -33.87, lon: 151.21 },
];
const EARTH_DATES = [
  '2024-03-20T03:06:00Z',
  '2024-06-21T12:00:00Z',
  '2026-11-19T18:00:00Z',
];

const CASES = [
  ...MOON_DATES.flatMap((date) => ({ body: 'moon', date, sites: MOON_SITES })),
  ...MARS_DATES.flatMap((date) => ({ body: 'mars', date, sites: MARS_SITES })),
  ...EARTH_DATES.flatMap((date) => ({
    body: 'earth',
    date,
    sites: EARTH_SITES,
  })),
].filter((c) => ONLY === null || c.body === ONLY);

const ASTRO = { moon: Body.Moon, mars: Body.Mars, earth: Body.Earth };

const browser = await chromium.launch({
  args: [
    '--disable-features=CalculateNativeWinOcclusion',
    '--disable-renderer-backgrounding',
    '--use-angle=d3d11',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
  ],
});
const rows = [];
for (const mode of ['educ', 'explo']) {
  for (const c of CASES) {
    const context = await browser.newContext({
      viewport: { width: 900, height: 600 },
    });
    await context.addInitScript(() => {
      localStorage.setItem('ssv-guided-tour-v1', '1');
      localStorage.setItem('ssv-explo-tour-nudge-v1', '1');
      localStorage.setItem('ssv-locale', 'en');
    });
    const page = await context.newPage();
    await page.goto(
      `${ORIGIN}/?debug-light&mode=${mode}&body=${c.body}&date=${c.date}`,
      { timeout: 180_000 }
    );
    await page
      .locator('#loader')
      .waitFor({ state: 'hidden', timeout: 180_000 });
    await page.waitForFunction(() => window.__galaxyLight !== undefined, null, {
      timeout: 60_000,
    });
    // La date n'est posée qu'à l'arrivée des éphémérides : attendre qu'elle soit celle demandée
    // (à 2 min près : l'horloge avance en temps réel), puis laisser la scène se poser.
    const wanted = Date.parse(c.date);
    await page.waitForFunction(
      ([body, w]) => {
        const m = window.__galaxyLight.measure(body, 0, 0);
        return m !== null && Math.abs(Date.parse(m.date) - w) < 120_000;
      },
      [c.body, wanted],
      { timeout: 90_000, polling: 250 }
    );
    await page.waitForTimeout(2500);
    for (const site of c.sites) {
      const m = await page.evaluate(
        ([body, lat, lon]) => window.__galaxyLight.measure(body, lat, lon),
        [c.body, site.lat, site.lon]
      );
      const date = new Date(m.date);
      const ref =
        c.body === 'earth'
          ? referenceEarth(date, site.lat, site.lon)
          : referenceIau(ASTRO[c.body], date, site.lat, site.lon);
      rows.push({
        mode,
        body: c.body,
        requested: c.date,
        sceneDate: m.date,
        site: site.id,
        lat: site.lat,
        lon: site.lon,
        galaxy: {
          altitudeDeg: m.site.sunAltitudeDeg,
          azimuthDeg: m.site.sunAzimuthDeg,
          dot: m.site.dot,
          subsolar: m.subsolar,
          subEarth: m.subEarth,
        },
        reference: ref,
        altitudeErrorDeg: m.site.sunAltitudeDeg - ref.sunAltitudeDeg,
        subsolarLonErrorDeg: ref.subsolar
          ? wrap180(m.subsolar.longitudeDeg - ref.subsolar.longitudeDeg)
          : null,
        subsolarLatErrorDeg: ref.subsolar
          ? m.subsolar.latitudeDeg - ref.subsolar.latitudeDeg
          : null,
        subEarthLonErrorDeg:
          ref.subEarth && m.subEarth
            ? wrap180(m.subEarth.longitudeDeg - ref.subEarth.longitudeDeg)
            : null,
        classificationAgrees: m.site.day === ref.dot > 0,
      });
    }
    await context.close();
  }
}
await browser.close();

const f = (x, n = 2) =>
  x === null || x === undefined ? '  n/a ' : x.toFixed(n).padStart(7);
console.log(
  'mode  corps date                  site                              alt.G   alt.réf  écart   Δlon.sub  Δlon.sub-Terre  jour/nuit'
);
for (const r of rows) {
  console.log(
    `${r.mode.padEnd(5)} ${r.body.padEnd(5)} ${r.sceneDate.slice(0, 19)} ${r.site.padEnd(32)} ${f(r.galaxy.altitudeDeg)} ${f(r.reference.sunAltitudeDeg)} ${f(r.altitudeErrorDeg)} ${f(r.subsolarLonErrorDeg)} ${f(r.subEarthLonErrorDeg)}  ${r.classificationAgrees ? 'ok' : 'DIFFÈRE'}`
  );
}
if (JSON_OUT) {
  const target = resolve(JSON_OUT);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(rows, null, 2) + '\n', 'utf8');
  console.log(`écrit ${target}`);
}
