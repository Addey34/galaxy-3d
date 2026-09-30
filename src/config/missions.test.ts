import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  missionStanding,
  sortMissions,
  type MissionRecord,
} from '@/core/missions';

/**
 * LES MISSIONS LIVRÉES : CE QUI EST SUR LE DISQUE EST CE QUE L'INDEX ANNONCE.
 *
 * L'index et les listes sont DÉRIVÉS du registre de contexte du PDS par
 * `pnpm missions:generate`, qui sait aussi dire en `--check` si un fichier livré a dérivé de sa
 * source. Cette garde-ci ne refait pas ce travail (il demande le réseau) : elle vérifie ce
 * qu'aucune régénération ne verrait, et surtout les DEUX pièges que la mesure du lot 40 a
 * trouvés dans cette source.
 *
 * PIÈGE 1 : la sentinelle. Le PDS écrit `3000-01-01` pour dire « pas de fin déclarée », et 31
 * autres missions écrivent `null` pour la même chose. Livrer la sentinelle telle quelle ferait
 * afficher « de 2018 à l'an 3000 » pour BepiColombo. Aucune borne livrée ne doit donc dépasser
 * l'an 2100, et le test le vérifie sur toutes les listes.
 *
 * PIÈGE 2 : `start_date` n'est PAS un lancement. Le PDS fait commencer « Voyager » le
 * 1972-07-01, alors que Voyager 1 a décollé le 1977-09-05 selon notre propre registre. Le test
 * CROISE les deux et exige qu'ils diffèrent, pour que personne ne « corrige » un jour l'un vers
 * l'autre en croyant réparer une incohérence.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DIR = join(ROOT, 'public/assets/missions');
const ENTITIES = join(ROOT, 'src/registry/entities');

interface Index {
  provider: { federates: string[]; citingGuidance: string } & Record<
    string,
    unknown
  >;
  retrieved: string;
  missions: number;
  bodies: Record<string, { count: number; bytes: number }>;
}

const index = JSON.parse(
  readFileSync(join(ROOT, 'src/config/missionIndex.json'), 'utf-8')
) as Index;

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.slice(0, -5))
  .sort();

const missionsOf = (body: string): MissionRecord[] =>
  JSON.parse(
    readFileSync(join(DIR, `${body}.json`), 'utf-8')
  ) as MissionRecord[];

const catalogue = readdirSync(ENTITIES)
  .filter((f) => f.endsWith('.json') && f !== 'order.json')
  .map((f) => f.slice(0, -5))
  .sort();

describe('missions livrées', () => {
  /**
   * L'INDEX COUVRE TOUT LE CATALOGUE, y compris les corps à zéro mission. C'est ce qui rend le
   * manque VISIBLE plutôt que silencieux : Éris n'a pas de fichier, mais l'index dit qu'elle est
   * à zéro, et l'application affiche la phrase qui l'explique. Ajouter un corps sans relancer le
   * générateur fait donc rougir cette garde, au lieu de livrer une fiche muette.
   */
  it('donne un compte à CHAQUE corps du catalogue', () => {
    expect(Object.keys(index.bodies).sort()).toEqual(catalogue);
  });

  it('a un fichier pour exactement les corps dont le compte n’est pas nul', () => {
    const declared = Object.entries(index.bodies)
      .filter(([, e]) => e.count > 0)
      .map(([body]) => body)
      .sort();
    expect(declared).toEqual(files);
    expect(files.length).toBeGreaterThanOrEqual(40);
  });

  it('compte et pèse ce que les fichiers contiennent vraiment', () => {
    for (const body of files) {
      const raw = readFileSync(join(DIR, `${body}.json`), 'utf-8');
      const entry = index.bodies[body]!;
      expect(JSON.parse(raw).length, `${body} : nombre annoncé`).toBe(
        entry.count
      );
      expect(Buffer.byteLength(raw), `${body} : octets annoncés`).toBe(
        entry.bytes
      );
    }
  });

  it('ne livre aucune borne au-delà de 2100 : la sentinelle du PDS est réécrite', () => {
    for (const body of files)
      for (const m of missionsOf(body)) {
        expect(m.start, `${body}/${m.name} début`).toMatch(/^\d{4}-\d\d-\d\d$/);
        expect(m.start < '2100-01-01', `${body}/${m.name} début`).toBe(true);
        if (m.end !== null) {
          expect(m.end, `${body}/${m.name} fin`).toMatch(/^\d{4}-\d\d-\d\d$/);
          expect(m.end < '2100-01-01', `${body}/${m.name} fin`).toBe(true);
        }
      }
  });

  it('déclare une fin absente par null, jamais par une chaîne vide ou « UNK »', () => {
    for (const body of files)
      for (const m of missionsOf(body))
        expect(
          m.end === null || m.end.length === 10,
          `${body}/${m.name} : fin « ${String(m.end)} »`
        ).toBe(true);
  });

  it('cite chaque mission par son identifiant logique PDS', () => {
    // Sans lui, un nom affiché ici ne serait plus vérifiable par personne. Les trois agences
    // fédérées par ce registre sont dans les préfixes : NASA, ESA/PSA et JAXA/DARTS.
    const agencies = new Set<string>();
    for (const body of files)
      for (const m of missionsOf(body)) {
        expect(m.lid, `${body}/${m.name}`).toMatch(
          /^urn:[a-z]+:[a-z]+:context:investigation:/
        );
        expect(m.name.length, `${body} : mission sans nom`).toBeGreaterThan(0);
        agencies.add(m.lid.split(':').slice(0, 3).join(':'));
      }
    // LA LISTE DÉCLARÉE EST CELLE DES IDENTIFIANTS LIVRÉS, croisée dans les deux sens : c'est
    // cette garde qui a trouvé que ma liste écrite à la main en oubliait deux (ISRO et KARI).
    expect([...agencies].sort()).toEqual(index.provider.federates);
  });

  it('est trié, et le tri du module pur est le même', () => {
    for (const body of files) {
      const list = missionsOf(body);
      expect(sortMissions(list), `${body} : ordre livré`).toEqual(list);
    }
  });

  it('ne cite pas deux fois la même mission pour un corps', () => {
    for (const body of files) {
      const lids = missionsOf(body).map((m) => m.lid);
      expect(new Set(lids).size, `${body} : doublon`).toBe(lids.length);
    }
  });

  /**
   * LE TÉMOIN DU LOT 40, et il est permanent. Si le début du PDS était un lancement, ces deux
   * dates seraient égales. Elles ne le sont pas, et l'écart est de plus de cinq ans : le champ
   * du PDS est un début de PROJET. Cette garde existe pour qu'on ne « corrige » jamais l'un
   * vers l'autre, et pour que le texte du bloc ne se mette jamais à dire « lancement ».
   */
  it('ne confond pas le début du projet avec un lancement (témoin Voyager)', () => {
    const voyager = missionsOf('triton').find((m) => m.name === 'Voyager');
    expect(voyager, 'Voyager absente de la liste de Triton').toBeDefined();
    const launch = (
      JSON.parse(
        readFileSync(
          join(ROOT, 'src/registry/spacecraft/voyager2.json'),
          'utf-8'
        )
      ) as { launchDate: string }
    ).launchDate;
    expect(voyager!.start).toBe('1972-07-01');
    expect(launch).toBe('1977-08-20');
    expect(voyager!.start < launch).toBe(true);
  });

  /**
   * LA MESURE DE FIN DE LA LIGNE 40.1 : le nombre de corps couverts. Écrit ici pour qu'une perte
   * de couverture se voie, et lu par `pnpm inventory:gaps` plutôt que recopié dans un document.
   */
  it('couvre les corps que la mesure du lot 40 a trouvés', () => {
    const covered = Object.values(index.bodies).filter(
      (e) => e.count > 0
    ).length;
    expect(covered).toBe(48);
    // 112 investigations DISTINCTES, pour 113 lignes rendues : le registre sert deux fois
    // `mission.venus_express` sous le même `lidvid`, et le générateur les fusionne parce
    // qu'elles sont identiques une fois la sentinelle réécrite. Le chiffre publié est celui
    // des missions, pas celui des lignes.
    expect(index.missions).toBe(112);
    // Les dix corps sans mission ne sont pas un trou : aucune mission n'a été jusque-là, et
    // l'application le DIT. Les nommer ici fait qu'un ajout de couverture se remarque.
    const none = Object.entries(index.bodies)
      .filter(([, e]) => e.count === 0)
      .map(([body]) => body)
      .sort();
    expect(none).toEqual([
      'eris',
      'gonggong',
      'haumea',
      'hygiea',
      'makemake',
      'orcus',
      'pallas',
      'quaoar',
      'sedna',
      'stars',
    ]);
  });

  it('classe chaque mission livrée à sa propre date de début', () => {
    // Croisement du module pur avec la donnée réelle : une mission doit être « commencée » le
    // jour de son début, quelle que soit la forme de sa fin.
    for (const body of files)
      for (const m of missionsOf(body))
        expect(
          missionStanding(m, new Date(`${m.start}T12:00:00Z`)),
          `${body}/${m.name}`
        ).toMatch(/^(underway|startedEndUndeclared)$/);
  });

  /**
   * LE QUATRIÈME ÉTAT N'EST PAS THÉORIQUE, et ce compte le prouve sur la donnée LIVRÉE plutôt que
   * dans une phrase. Il est écrit ici pour qu'une régénération qui le ferait tomber à zéro se
   * remarque : cela voudrait dire que le PDS a cessé de servir ses fins non déclarées, et que
   * `startedEndUndeclared` ne décrit plus rien.
   */
  it('livre des missions SANS fin déclarée, ce que le quatrième état existe pour dire', () => {
    const distinct = new Map<string, MissionRecord>();
    for (const body of files)
      for (const m of missionsOf(body)) distinct.set(m.lid, m);
    const noEnd = [...distinct.values()].filter((m) => m.end === null);
    expect(distinct.size).toBe(92);
    expect(noEnd.length).toBe(31);
    // Et le témoin qui donne son sens à l'état : Venera 4 s'est tue en 1967, et l'archive ne
    // déclare pas sa fin. La dire « en cours » afficherait une sonde soviétique encore active.
    const venera4 = noEnd.find((m) => m.name === 'Venera 4');
    expect(
      venera4,
      'Venera 4 absente des missions sans fin déclarée'
    ).toBeDefined();
    expect(missionStanding(venera4!, new Date('2026-01-01T00:00:00Z'))).toBe(
      'startedEndUndeclared'
    );
  });

  it('fait voyager la provenance AVEC la donnée', () => {
    const p = index.provider as Record<string, string | string[]>;
    expect(p.publisher).toBe('NASA Planetary Data System');
    // AUCUNE LICENCE N'EST REVENDIQUÉE, et la garde l'exige. J'avais écrit `public-domain` en
    // pointant la page de citation du PDS ; cette page ne dit rien de tel, et les pages de
    // politique du site rendent 404 (mesuré le 2026-09-30). On publie ce qu'on peut POINTER.
    expect(
      p.rights,
      'une licence revendiquée doit être citable'
    ).toBeUndefined();
    expect(String(p.citingGuidance)).toMatch(
      /^https:\/\/pds\.nasa\.gov\/datastandards\/citing\//
    );
    expect(String(p.citation)).toContain('Planetary Data System');
    // Le registre FÉDÈRE trois agences, et c'est la raison de le préférer à une source par
    // agence : la priorité ESA du projet est servie sans seconde source.
    // Cinq espaces de noms au 2026-09-30, DÉRIVÉS et non recopiés : NASA, ESA/PSA, JAXA/DARTS,
    // ISRO et KARI. Le seuil dit « au moins trois agences », la liste exacte étant croisée avec
    // les identifiants livrés par le test précédent.
    expect(p.federates.length).toBeGreaterThanOrEqual(3);
    expect(p.federates).toContain('urn:esa:psa');
    expect(p.federates).toContain('urn:nasa:pds');
    expect(index.retrieved).toMatch(/^20\d\d-\d\d-\d\d$/);
  });
});
