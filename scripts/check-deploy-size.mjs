/* global console, process */
/**
 * Refuse un déploiement anormalement lourd, AVANT qu'il parte chez Firebase.
 *
 * POURQUOI. Firebase Hosting facture le stockage sur la somme des versions RETENUES, pas sur la
 * dernière : un fichier lourd se paie autant de fois qu'il y a de versions gardées. Le jour où
 * le noyau SPK de 638 Mo est parti par un `firebase deploy` local, le quota de 10 Go a fini par
 * sauter — et le message de Firebase (`HTTP 429`) ne nomme pas le fichier fautif. Il a fallu
 * mesurer `dist/` pour le trouver, puis purger des versions à la main dans la console.
 *
 * Ce script transforme cette panne opaque et manuelle en échec de build immédiat, qui NOMME les
 * plus gros fichiers. Il applique les exclusions de `firebase.json` : ce qu'il mesure est donc
 * ce que Firebase recevra, pas le contenu brut de `dist/`.
 *
 * Le seuil n'est pas une limite technique, c'est un cran d'arrêt. Le dépasser légitimement se
 * fait en le relevant sciemment, dans un commit qui l'explique — pas par accident.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { dirname, join, relative, resolve, sep } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MEGABYTE = 1024 * 1024;

/**
 * Repère d'attention — PAS un plafond.
 *
 * Une première version faisait échouer le build au-delà de 260 Mo. Mauvaise idée : les textures
 * sont la raison d'être du produit et le catalogue a vocation à grandir, donc ce garde-fou
 * aurait fini par bloquer un ajout parfaitement légitime. Un outil qui freine le projet qu'il
 * est censé protéger se fait désactiver, et alors il ne protège plus rien.
 *
 * Le script se contente donc de MESURER et de signaler. Ce qui empêche réellement l'accident
 * du noyau SPK, c'est son exclusion dans `firebase.json`, verrouillée par
 * `src/config/hostingPayload.test.ts` : une règle précise sur un fichier précis, qui ne dit
 * rien sur la taille que le projet a le droit d'atteindre.
 */
const NOTICE_MB = Number(process.env.DEPLOY_SIZE_NOTICE_MB ?? 260);

const firebase = JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8'));
const publicDir = join(ROOT, firebase.hosting.public ?? 'dist');
const ignore = firebase.hosting.ignore ?? [];

/**
 * Traduit un motif glob de firebase.json en expression régulière.
 *
 * Écrit caractère par caractère plutôt qu'en chaînant des `replace` autour d'un marqueur
 * temporaire : la première version passait par un caractère de remplacement invisible, qui
 * s'est retrouvé écrit comme un octet NUL dans le fichier. ESLint l'a vu, pas moi.
 */
function toRegExp(pattern) {
  const SPECIAL = '.+^${}()|[]\\?';
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c !== '*') {
      out += SPECIAL.includes(c) ? `\\${c}` : c;
      continue;
    }
    if (pattern[i + 1] !== '*') {
      out += '[^/]*'; // `*` ne franchit pas un séparateur
      continue;
    }
    i++;
    if (pattern[i + 1] === '/') {
      i++;
      out += '(?:.*/)?'; // `**/` accepte aussi zéro répertoire
    } else {
      out += '.*';
    }
  }
  return new RegExp(`^${out}$`);
}
const ignoreRes = ignore.map(toRegExp);
const isIgnored = (rel) => ignoreRes.some((re) => re.test(rel));

const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(publicDir, full).split(sep).join('/');
    if (entry.isDirectory()) {
      // Un répertoire entièrement exclu n'est même pas parcouru.
      if (isIgnored(rel) || isIgnored(`${rel}/`)) continue;
      walk(full);
    } else if (!isIgnored(rel)) {
      files.push({ rel, size: statSync(full).size });
    }
  }
}

try {
  walk(publicDir);
} catch (error) {
  console.error(
    `Impossible de lire ${publicDir} — lancer \`pnpm build\` d'abord.\n${String(error)}`
  );
  process.exit(1);
}

const total = files.reduce((sum, f) => sum + f.size, 0);
const totalMb = total / MEGABYTE;

const byDir = new Map();
for (const f of files) {
  const top = f.rel.split('/').slice(0, 2).join('/');
  byDir.set(top, (byDir.get(top) ?? 0) + f.size);
}

console.log(
  `Charge utile du déploiement : ${totalMb.toFixed(1)} Mo en ${files.length} fichiers`
);
for (const [name, size] of [...byDir.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 6))
  console.log(`  ${(size / MEGABYTE).toFixed(1).padStart(7)} Mo  ${name}`);

if (totalMb > NOTICE_MB) {
  const worst = [...files].sort((a, b) => b.size - a.size).slice(0, 5);
  console.log(
    `\nÀ REGARDER : ${totalMb.toFixed(1)} Mo, au-dessus du repère de ${NOTICE_MB} Mo.\n` +
      `Firebase garde une copie par version retenue, donc ce poids se multiplie. Si cette\n` +
      `croissance est voulue, il n'y a rien à faire : vérifier simplement que le nombre de\n` +
      `versions conservées est borné côté console. Les plus gros fichiers :`
  );
  for (const f of worst)
    console.log(`  ${(f.size / MEGABYTE).toFixed(1).padStart(7)} Mo  ${f.rel}`);
}
// Volontairement AUCUN code de sortie non nul : ce script informe, il ne bloque pas.
