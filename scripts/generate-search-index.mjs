#!/usr/bin/env node
/* global console, process */
/**
 * L'INDEX DE LA RECHERCHE UNIVERSELLE (lot 47, 2026-10-12), DÉRIVÉ des fichiers livrés : aucune
 * entrée n'est écrite à la main, et ajouter une formation, une mission, un instrument ou un
 * survol à sa source l'ajoute ici au prochain passage.
 *
 * POURQUOI UN FICHIER SERVI ET NON LE BUNDLE : les seuls noms de surface de l'UAI (16 067 sur 36
 * corps) pèsent 79 ko gzip, quinze fois la marge du budget JS du démarrage (5 396 o, mesuré le
 * 2026-10-12). Le fichier n'est demandé qu'à la PREMIÈRE FRAPPE utile dans la palette.
 *
 * Sources, toutes déjà livrées :
 *   - lieux        public/assets/gazetteer/{corps}.json          (pnpm gazetteer:generate)
 *   - missions     src/seo/missionCatalogue.json                 (pnpm missions:generate)
 *   - instruments  public/assets/instruments/{sonde}.json        (pnpm instruments:generate)
 *   - survols      src/seo/flybyEvents.json                      (pnpm flybys:generate)
 *   - mises en orbite src/seo/orbitInsertions.json               (pnpm orbits:generate)
 *   - contacts     src/seo/surfaceContacts.json                  (pnpm contacts:generate)
 *   - découvertes  public/assets/discovery/{parent}.json et src/config/discoveryIndex.json
 *                                                                (pnpm discovery:generate)
 * La sonde d'une mission se DÉRIVE : le fichier d'instruments d'une sonde déclare les
 * investigations où elle figure, par identifiant PDS.
 *
 * Écrit public/assets/search/index.json. `--check` n'écrit rien et sort en code 1 si le fichier
 * livré a dérivé de ses sources.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/assets/search/index.json');
const read = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
const jsonFiles = (dir) =>
  readdirSync(join(ROOT, dir))
    .filter((f) => f.endsWith('.json'))
    .sort();

export function buildSearchIndex() {
  // Les NOMS seulement, groupés par corps : la position d'une formation est dans le fichier du
  // gazetteer de son corps, que l'application charge déjà à l'approche. Avec latitude, longitude
  // et diamètre, l'index pesait 213 ko gzip ; sans, il en pèse le tiers (mesuré le 2026-10-12).
  const places = {};
  for (const file of jsonFiles('public/assets/gazetteer')) {
    const body = file.slice(0, -5);
    places[body] = read(`public/assets/gazetteer/${file}`).map((f) => f.name);
  }
  // LA TERRE (lot 53), que l'UAI ne nomme pas : ses noms de Natural Earth, dans les quatre
  // langues que la source publie, pour que « mer Méditerranée » se trouve en français comme
  // « Mediterranean Sea » en anglais. La position se relit dans le fichier servi à l'approche.
  places.earth = [
    ...new Set(
      read('public/assets/earth-names/earth.json').flatMap((n) => [
        n.name,
        ...Object.values(n.names ?? {}),
      ])
    ),
  ];

  const probeOfInvestigation = new Map();
  const instruments = [];
  for (const file of jsonFiles('public/assets/instruments')) {
    const probe = file.slice(0, -5);
    const data = read(`public/assets/instruments/${file}`);
    for (const investigation of data.investigations ?? [])
      if (!probeOfInvestigation.has(investigation.lid))
        probeOfInvestigation.set(investigation.lid, probe);
    const seen = new Set();
    for (const instrument of data.instruments ?? []) {
      if (seen.has(instrument.name)) continue;
      seen.add(instrument.name);
      // [nom, sonde]
      instruments.push([instrument.name, probe]);
    }
  }

  // [nom, slug de sa page, sonde dessinée ou null, cible du catalogue si elle est UNIQUE]
  // Unique et non « la première » : la première cible de Cassini-Huygens est Masursky, un
  // astéroïde croisé en route, et celle de Juno la Terre (mesuré le 2026-10-12). Une mission à
  // plusieurs cibles se lit sur sa page, qui les donne toutes.
  const missions = read('src/seo/missionCatalogue.json').missions.map((m) => {
    const bodies = [
      ...new Set(m.targets.map((target) => target.body).filter(Boolean)),
    ];
    return [
      m.name,
      m.slug,
      probeOfInvestigation.get(m.lid) ?? null,
      bodies.length === 1 ? bodies[0] : null,
    ];
  });

  // [sonde, corps survolé, instant du point le plus proche]
  const flybys = read('src/seo/flybyEvents.json').events.map((e) => [
    e.probe,
    e.body,
    e.closestAt,
  ]);

  // [sonde, corps, premier instant lié] : les mises en orbite (lot 49), même forme et même geste.
  const orbitInsertions = read('src/seo/orbitInsertions.json').insertions.map(
    (i) => [i.probe, i.body, i.at]
  );

  // [sonde, corps, instant où la scène s'ouvre] : les contacts (lot 49, pas 3). L'instant de la
  // SCÈNE et non celui du contact : sous le niveau de 1 bar, la sonde n'est plus dessinée.
  const contacts = read('src/seo/surfaceContacts.json').contacts.map((c) => [
    c.probe,
    c.body,
    c.sceneAt,
  ]);

  // [nom, corps à montrer, quand (jour ou année), découvreurs]. Les satellites viennent des
  // fichiers de chaque système, y compris ceux qu'on ne dessine pas (Pan pour Saturne) : on montre
  // alors leur parent, dont la fiche dit ce qu'on savait à cette date. Les corps du catalogue sans
  // fichier de système viennent de l'index, revendication DATÉE seulement : « préhistorique »,
  // « antique » et un retour PRÉDIT (Halley, 1758, que NASA Science requalifie) ne sont pas une
  // découverte à ce jour-là.
  const discoveries = [];
  const covered = new Set();
  for (const file of jsonFiles('public/assets/discovery')) {
    const parent = file.slice(0, -5);
    for (const moon of read(`public/assets/discovery/${file}`)) {
      if (moon.body) covered.add(moon.body);
      discoveries.push([
        moon.name,
        moon.body ?? parent,
        String(moon.years[0]),
        moon.who ?? null,
      ]);
    }
  }
  const index = read('src/config/discoveryIndex.json').bodies;
  for (const [body, entry] of Object.entries(index)) {
    if (covered.has(body)) continue;
    const claim = (entry.claims ?? []).find(
      (c) => !c.role && (c.form === 'day' || c.form === 'years')
    );
    if (!claim) continue;
    discoveries.push([
      null,
      body,
      claim.form === 'day' ? claim.day : String(claim.years[0]),
      claim.who ?? null,
    ]);
  }

  return {
    format: 1,
    places,
    missions,
    instruments,
    flybys,
    orbitInsertions,
    contacts,
    discoveries,
  };
}

const serialize = (index) => JSON.stringify(index) + '\n';

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = serialize(buildSearchIndex());
  if (process.argv.includes('--check')) {
    let shipped = '';
    try {
      shipped = readFileSync(OUT, 'utf8');
    } catch {
      // absent : la comparaison échoue ci-dessous, et le message le dit
    }
    if (shipped !== text) {
      console.error(
        'public/assets/search/index.json a dérivé de ses sources : pnpm search:generate'
      );
      process.exit(1);
    }
    console.log('index de recherche à jour');
  } else {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, text);
    const index = JSON.parse(text);
    console.log(
      `index de recherche : ${Object.values(index.places).flat().length} lieux, ${index.missions.length} missions, ` +
        `${index.instruments.length} instruments, ${index.flybys.length} survols, ` +
        `${index.orbitInsertions.length} mises en orbite, ${index.contacts.length} contacts, ` +
        `${index.discoveries.length} découvertes, ${text.length} o`
    );
  }
}
