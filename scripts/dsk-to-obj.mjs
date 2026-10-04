/* global console, process */
/**
 * Convertit un modèle de forme SPICE DSK (type 2, plaques triangulaires) en Wavefront OBJ, que
 * `decimate-shape-model.mjs` lit ensuite comme les autres sources.
 *
 *   node scripts/dsk-to-obj.mjs <entrée.bds> <sortie.obj>
 *
 * POURQUOI CE SCRIPT EXISTE (2026-10-04). Les modèles de Didymos et de Dimorphos publiés par DART
 * (`urn:nasa:pds:dart_shapemodel`) sont sur un hôte qui refusait tout accès (HTTP 403) ; les MÊMES
 * modèles SPC sont servis en DSK par l'archive SPICE PDS4 de DART chez NAIF. Aucune dépendance :
 * le format est publié par NAIF, et il est lu ici tel quel.
 *
 * LE FORMAT, en trois couches, chacune lue et non devinée :
 *   - DAS : enregistrements de 1 024 octets. L'enregistrement 1 est l'en-tête du fichier ; suivent
 *     les enregistrements réservés, les commentaires, puis une chaîne d'enregistrements-RÉPERTOIRES.
 *     Chaque répertoire (256 entiers) porte ses pointeurs, le type de sa première grappe, puis la
 *     taille de chaque grappe d'enregistrements de données qui le suivent. Les types se succèdent
 *     dans l'ordre cyclique caractère, double, entier. Une adresse logique d'un type se lit en
 *     parcourant ses grappes dans l'ordre.
 *   - DLA : les premiers entiers logiques chaînent les descripteurs de segments (8 entiers chacun :
 *     précédent, suivant, base et taille des entiers, des doubles, des caractères).
 *   - DSK type 2 (indices de `dsk02.inc`) : entiers 1-2 = nombre de sommets et de plaques, plaques
 *     à partir de l'entier 11 (indices de sommets comptés à partir de 1) ; doubles 1-24 = le
 *     descripteur du segment, sommets à partir du double 35, en km dans le repère du corps.
 *
 * Le script ne lit que des fichiers petit-boutistes (« LTL-IEEE »), et le VÉRIFIE : un autre
 * format binaire rendrait des nombres plausibles et faux.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error(
    'usage : node scripts/dsk-to-obj.mjs <entrée.bds> <sortie.obj>'
  );
  process.exit(2);
}

const RECORD = 1024;
const buffer = readFileSync(input);
const ascii = (from, to) => buffer.toString('latin1', from, to);

if (ascii(0, 8) !== 'DAS/DSK ')
  throw new Error(`${input} : pas un DSK (identifiant « ${ascii(0, 8)} »)`);
if (!ascii(0, RECORD).includes('LTL-IEEE'))
  throw new Error(`${input} : format binaire autre que LTL-IEEE, non lu ici`);

const int32 = (record, index) =>
  buffer.readInt32LE((record - 1) * RECORD + index * 4);
// En-tête : identifiant (8), nom interne (60), puis réservés et commentaires.
const reservedRecords = buffer.readInt32LE(68);
const commentRecords = buffer.readInt32LE(76);

/** Numéros d'enregistrement de chaque type, dans l'ordre des adresses logiques. */
const records = { 1: [], 2: [], 3: [] };
const NEXT = { 1: 2, 2: 3, 3: 1 };
let directory = 2 + reservedRecords + commentRecords;
while (directory > 0) {
  let type = int32(directory, 8);
  let next = directory + 1;
  for (let k = 9; k < 256; k++) {
    const size = int32(directory, k);
    if (size === 0) break;
    for (let r = 0; r < size; r++) records[type].push(next + r);
    next += size;
    type = NEXT[type];
  }
  directory = int32(directory, 1);
}

const PER_RECORD = { 2: 128, 3: 256 };
const read = (type, address) => {
  const per = PER_RECORD[type];
  const record = records[type][Math.floor((address - 1) / per)];
  if (record === undefined)
    throw new Error(`adresse ${address} de type ${type} hors du fichier`);
  const offset =
    (record - 1) * RECORD + ((address - 1) % per) * (type === 2 ? 8 : 4);
  return type === 2 ? buffer.readDoubleLE(offset) : buffer.readInt32LE(offset);
};
const int = (address) => read(3, address);
const dbl = (address) => read(2, address);

// DLA : entier 1 = version du format, entiers 2 et 3 = premier et dernier descripteur. On lit
// LE segment, et on REFUSE un fichier qui en porte plusieurs plutôt que d'en ignorer.
const first = int(2);
const last = int(3);
if (first !== last || first < 4)
  throw new Error(
    `${input} : descripteurs ${first} et ${last}, un seul segment attendu`
  );
const descriptor = first;
const intBase = int(descriptor + 2);
const dblBase = int(descriptor + 4);

const segmentType = dbl(dblBase + 4);
if (segmentType !== 2)
  throw new Error(
    `${input} : segment de type ${segmentType}, seul le type 2 est lu`
  );

const nv = int(intBase + 1);
const np = int(intBase + 2);
const lines = [`# ${input} : ${nv} sommets, ${np} plaques (DSK type 2, km)`];
for (let v = 0; v < nv; v++) {
  const a = dblBase + 35 + v * 3;
  lines.push(`v ${dbl(a)} ${dbl(a + 1)} ${dbl(a + 2)}`);
}
for (let p = 0; p < np; p++) {
  const a = intBase + 11 + p * 3;
  const [i, j, k] = [int(a), int(a + 1), int(a + 2)];
  if (![i, j, k].every((x) => x >= 1 && x <= nv))
    throw new Error(`plaque ${p + 1} : indice hors des sommets`);
  lines.push(`f ${i} ${j} ${k}`);
}
writeFileSync(output, `${lines.join('\n')}\n`);
console.log(`écrit ${output} : ${nv} sommets, ${np} plaques`);
