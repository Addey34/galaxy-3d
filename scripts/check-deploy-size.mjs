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
 * Plafond de la charge utile déployée.
 *
 * Mesuré au moment de l'écriture : environ 200 Mo, dont 164 Mo de textures — celles-ci sont la
 * raison d'être du produit, elles ont vocation à grossir un peu. La marge laisse la place à
 * cette croissance normale tout en arrêtant net un fichier qui n'aurait rien à faire là.
 */
const LIMIT_MB = Number(process.env.DEPLOY_SIZE_LIMIT_MB ?? 260);

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
  `Charge utile du déploiement : ${totalMb.toFixed(1)} Mo en ${files.length} fichiers (plafond ${LIMIT_MB} Mo)`
);
for (const [name, size] of [...byDir.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 6))
  console.log(`  ${(size / MEGABYTE).toFixed(1).padStart(7)} Mo  ${name}`);

if (totalMb > LIMIT_MB) {
  const worst = [...files].sort((a, b) => b.size - a.size).slice(0, 5);
  console.error(
    `\nÉCHEC : ${totalMb.toFixed(1)} Mo dépassent le plafond de ${LIMIT_MB} Mo.\n` +
      `Firebase conserve une copie par version retenue : ce poids se multiplie et finit par\n` +
      `saturer le quota, avec une erreur 429 qui ne dit pas quel fichier est en cause.\n\n` +
      `Les plus gros fichiers de cette charge utile :`
  );
  for (const f of worst)
    console.error(
      `  ${(f.size / MEGABYTE).toFixed(1).padStart(7)} Mo  ${f.rel}`
    );
  console.error(
    `\nSi ce poids est VOULU, relever le plafond dans ce script en expliquant pourquoi.\n` +
      `Sinon, exclure le fichier via \`hosting.ignore\` dans firebase.json.`
  );
  process.exit(1);
}
