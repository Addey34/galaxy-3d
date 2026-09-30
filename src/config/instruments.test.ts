import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  groupByHost,
  sortInstruments,
  type SpacecraftArchive,
} from '@/core/instruments';
import { sortMissions } from '@/core/missions';

/**
 * L'ARCHIVE DES SONDES LIVRÉE : CE QUI EST SUR LE DISQUE EST CE QUE L'INDEX ANNONCE.
 *
 * L'index et les listes sont DÉRIVÉS du registre de contexte du PDS par
 * `pnpm instruments:generate`, qui sait aussi dire en `--check` si un fichier livré a dérivé de sa
 * source. Cette garde-ci ne refait pas ce travail (il demande le réseau) : elle vérifie ce
 * qu'aucune régénération ne verrait, et les pièges que la mesure du 2026-09-30 a trouvés.
 *
 * PIÈGE 1 : LA PARITÉ. Chaque sonde du registre doit être SOIT jointe à l'archive SOIT déclarée
 * absente avec sa raison, jamais ni l'un ni l'autre. C'est la règle de l'utilisateur rendue
 * mécanique : un manque est comblé ou écrit, jamais laissé de côté sans le dire.
 *
 * PIÈGE 2 : LA SENTINELLE. Le PDS écrit `3000-01-01` pour dire « pas de fin déclarée ». La livrer
 * telle quelle ferait afficher « de 2018 à l'an 3000 » pour BepiColombo.
 *
 * PIÈGE 3 : UN IDENTIFIANT NAIF QUI N'EST PAS UN NOMBRE. Le PDS écrit la phrase « not applicable »
 * dans ce champ. Aucun `naif` livré ne doit donc être autre chose qu'un entier.
 *
 * PIÈGE 4 : UN PORTEUR SANS INSTRUMENT DOIT SURVIVRE. L'orbiteur magnétosphérique de BepiColombo
 * (MMO) n'en déclare AUCUN : le regroupement doit le rendre quand même, sinon un tiers de la sonde
 * disparaît de la fiche sans que rien ne le dise.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = join(ROOT, 'public/assets/instruments');
const SPACECRAFT = join(ROOT, 'src/registry/spacecraft');

interface Index {
  provider: { federates: string[]; citingGuidance: string } & Record<
    string,
    unknown
  >;
  retrieved: string;
  spacecraft: Record<
    string,
    {
      hosts: number;
      investigations: number;
      instruments: number;
      bytes: number;
    }
  >;
  absent: Record<string, true>;
}

const index = JSON.parse(
  readFileSync(join(ROOT, 'src/config/instrumentIndex.json'), 'utf-8')
) as Index;

const targets = JSON.parse(
  readFileSync(join(ROOT, 'scripts/pds-archive-targets.json'), 'utf-8')
) as {
  spacecraft: Record<
    string,
    { instrumentHosts?: string[]; absent?: string; note?: string }
  >;
};

const order = (
  JSON.parse(readFileSync(join(SPACECRAFT, 'order.json'), 'utf-8')) as {
    order: string[];
  }
).order;

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.slice(0, -5))
  .sort();

const archiveOf = (id: string): SpacecraftArchive =>
  JSON.parse(
    readFileSync(join(DIR, `${id}.json`), 'utf-8')
  ) as SpacecraftArchive;

describe('archive des sondes livrée', () => {
  it('trouve bien un index et des fichiers', () => {
    // Borne : un relevé vide rendrait tout le reste vert sans rien prouver.
    expect(order.length).toBeGreaterThanOrEqual(11);
    expect(files.length).toBeGreaterThan(0);
  });

  it('déclare CHAQUE sonde du registre, jointe ou absente avec sa raison', () => {
    const covered = [
      ...Object.keys(index.spacecraft),
      ...Object.keys(index.absent),
    ].sort();
    expect(covered).toEqual([...order].sort());
    for (const id of order) {
      const entry = targets.spacecraft[id];
      expect(
        entry,
        `${id} n’est pas déclarée dans pds-archive-targets.json`
      ).toBeDefined();
      const joined = id in index.spacecraft;
      expect(Array.isArray(entry?.instrumentHosts)).toBe(joined);
      expect(typeof entry?.absent === 'string').toBe(!joined);
    }
  });

  it('donne une RAISON mesurée, et pas une excuse, à chaque sonde absente', () => {
    expect(Object.keys(index.absent).length).toBeGreaterThan(0);
    for (const id of Object.keys(index.absent)) {
      const reason = targets.spacecraft[id]?.absent ?? '';
      // Une raison doit dire ce qui a été CHERCHÉ et avec quel TÉMOIN, sinon ce n'est pas une
      // mesure. Le témoin est ce qui distingue « la source ne le déclare pas » de « ma requête
      // était muette » : c'est le piège que ce dépôt a déjà payé sur l'API du PDS.
      expect(reason.length).toBeGreaterThan(120);
      expect(reason).toMatch(/témoin/);
      expect(reason).toMatch(/404/);
    }
  });

  it('a un fichier pour exactement les sondes jointes', () => {
    expect(files).toEqual([...Object.keys(index.spacecraft)].sort());
  });

  it('compte et pèse ce que les fichiers contiennent vraiment', () => {
    for (const [id, entry] of Object.entries(index.spacecraft)) {
      const archive = archiveOf(id);
      expect(archive.hosts.length, id).toBe(entry.hosts);
      expect(archive.investigations.length, id).toBe(entry.investigations);
      expect(archive.instruments.length, id).toBe(entry.instruments);
      expect(Buffer.byteLength(readFileSync(join(DIR, `${id}.json`))), id).toBe(
        entry.bytes
      );
    }
  });

  it('ne livre aucune borne au-delà de 2100 : la sentinelle du PDS est réécrite', () => {
    for (const id of files)
      for (const investigation of archiveOf(id).investigations) {
        expect(investigation.start.slice(0, 4), id).toMatch(/^(19|20)\d\d$/);
        if (investigation.end !== null)
          expect(investigation.end.slice(0, 4), id).toMatch(/^(19|20)\d\d$/);
      }
  });

  it('ne publie un identifiant NAIF que lorsqu’il est un ENTIER', () => {
    let published = 0;
    for (const id of files)
      for (const instrument of archiveOf(id).instruments)
        if ('naif' in instrument) {
          published += 1;
          expect(Number.isInteger(instrument.naif), instrument.lid).toBe(true);
        }
    // Borne : si plus aucun n'était publié, ce test passerait sans rien vérifier. Le PDS en
    // publie (Hayabusa2 le fait pour ses instruments), donc zéro voudrait dire que la lecture a
    // cessé de fonctionner.
    expect(published).toBeGreaterThan(0);
  });

  it('cite chaque porteur, chaque investigation et chaque instrument par son lid PDS', () => {
    for (const id of files) {
      const archive = archiveOf(id);
      for (const item of [
        ...archive.hosts,
        ...archive.investigations,
        ...archive.instruments,
      ]) {
        expect(item.lid, id).toMatch(/^urn:[a-z]+:[a-z]+:context:/);
        expect(item.name.length, item.lid).toBeGreaterThan(0);
      }
    }
  });

  it('est trié, et le tri des modules purs est le même', () => {
    for (const id of files) {
      const archive = archiveOf(id);
      expect(sortInstruments(archive.instruments), id).toEqual(
        archive.instruments
      );
      expect(sortMissions(archive.investigations), id).toEqual(
        archive.investigations
      );
    }
  });

  it('rattache chaque instrument à un porteur que la sonde possède', () => {
    for (const id of files) {
      const archive = archiveOf(id);
      const { orphans } = groupByHost(archive);
      // Aucun orphelin sur la donnée livrée : le chemin existe dans le module pur parce qu'une
      // source peut changer, pas parce que ce cas serait normal.
      expect(
        orphans.map((o) => o.lid),
        id
      ).toEqual([]);
    }
  });

  it('garde un porteur SANS instrument, témoin BepiColombo', () => {
    const bepi = archiveOf('bepicolombo');
    // Trois engins sous une seule investigation, mesuré le 2026-09-30 : l'orbiteur planétaire, son
    // homologue magnétosphérique japonais et le module de transfert.
    expect(bepi.hosts).toHaveLength(3);
    const { groups } = groupByHost(bepi);
    expect(groups).toHaveLength(3);
    const empty = groups.filter((g) => g.instruments.length === 0);
    expect(
      empty.length,
      'MMO ne déclare aucun instrument : le regroupement doit le rendre quand même'
    ).toBe(1);
    expect(groups.reduce((n, g) => n + g.instruments.length, 0)).toBe(
      bepi.instruments.length
    );
  });

  it('livre l’extension que seul le SECOND sens de la jointure déclare', () => {
    // MESURÉ le 2026-09-30 : `mission.apex` (OSIRIS-APEX) cite `spacecraft.orex` comme porteur,
    // alors que le produit `spacecraft.orex` ne cite PAS `mission.apex`. Lire un seul sens
    // perdrait une mission entière, et c'est pour cela que le générateur prend l'union.
    const orex = archiveOf('osiris-rex');
    const lids = orex.investigations.map((i) => i.lid);
    expect(lids).toContain('urn:nasa:pds:context:investigation:mission.apex');
    expect(lids).toContain('urn:nasa:pds:context:investigation:mission.orex');
  });

  it('ne dit pas « phase » là où la source dit « investigation », témoin Voyager 2', () => {
    // La SECONDE investigation de Voyager 2 est la campagne d'observation de la collision de
    // Shoemaker-Levy 9 sur Jupiter, qui n'est pas une phase de la mission Voyager. Ce témoin
    // existe pour qu'on ne renomme jamais ce champ « phases » en croyant clarifier.
    const vg2 = archiveOf('voyager2');
    expect(vg2.investigations.length).toBeGreaterThan(1);
    expect(vg2.investigations.map((i) => i.lid)).toContain(
      'urn:nasa:pds:context:investigation:mission.comet_sl9-jupiter_collision'
    );
  });

  it('fait voyager la provenance AVEC la donnée', () => {
    expect(index.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(index.provider.citingGuidance).toMatch(
      /^https:\/\/pds\.nasa\.gov\//
    );
    // Les agences fédérées sont DÉRIVÉES des identifiants livrés (leçon du lot 40 : la liste
    // écrite à la main en oubliait deux).
    const seen = new Set<string>();
    for (const id of files)
      for (const item of [
        ...archiveOf(id).hosts,
        ...archiveOf(id).investigations,
        ...archiveOf(id).instruments,
      ])
        seen.add(item.lid.split(':').slice(0, 3).join(':'));
    expect([...seen].sort()).toEqual([...index.provider.federates].sort());
  });

  it('NE REVENDIQUE AUCUNE LICENCE, parce que le PDS n’en déclare pas', () => {
    // Lu à la source le 2026-09-30 : la page de citation du PDS donne des consignes de citation
    // et rien de plus. Une licence se lit, ou elle ne s'écrit pas.
    expect('rights' in index.provider).toBe(false);
  });
});
