/**
 * LE CHARGEMENT PARTAGÉ DES MODÈLES DE FORME (GAL-ENGINE-HEADROOM-001).
 *
 * Quinze corps irréguliers ont un maillage ; chacun le demandait dès sa création, donc le chargeur glTF
 * (44 Kio) et quinze fichiers (~1 Mio) partaient au démarrage pour des corps de quelques pixels. Ce
 * module est le point UNIQUE de ces chargements : le chargeur n'est importé qu'au premier besoin (un
 * seul `import()` partagé), une seule instance sert tous les corps, et au plus `MAX_PARALLEL` fichiers
 * voyagent à la fois (une salve de corps qui franchissent ensemble le seuil d'approche ne se dispute
 * plus la bande passante). Un chargement `urgent` (le corps que l'on vient de cibler) passe devant
 * les autres.
 */
import type {
  GLTF,
  GLTFLoader,
} from 'three/examples/jsm/loaders/GLTFLoader.js';

export const MAX_PARALLEL = 2;

let loader: Promise<GLTFLoader> | null = null;
let active = 0;
const waiting: Array<() => void> = [];

/** Nombre de chargements en vol et en attente (lu par les tests et les mesures). */
export function shapeLoadState(): { active: number; waiting: number } {
  return { active, waiting: waiting.length };
}

function next(): void {
  active -= 1;
  waiting.shift()?.();
}

/**
 * Lance l'import du chargeur sans charger de fichier : l'ouverture de la palette suffit à le chauffer, de
 * sorte qu'un corps choisi quelques secondes plus tard n'attend plus que son maillage.
 */
export function warmShapeLoader(): void {
  loader ??= import('three/examples/jsm/loaders/GLTFLoader.js').then(
    (m) => new m.GLTFLoader()
  );
  // Un échec ici n'est pas une erreur : le prochain vrai chargement réessaie.
  loader.catch(() => {
    loader = null;
  });
}

/** Charge un glTF avec le chargeur partagé, sous le plafond de chargements simultanés. */
export function loadShapeGltf(url: string, urgent = false): Promise<GLTF> {
  return new Promise<GLTF>((resolve, reject) => {
    const run = (): void => {
      active += 1;
      loader ??= import('three/examples/jsm/loaders/GLTFLoader.js').then(
        (m) => new m.GLTFLoader()
      );
      loader
        .then((l) => l.loadAsync(url))
        .then(resolve, (error: unknown) => {
          // Un import qui échoue ne doit pas figer le chargeur pour la visite : on le retente au suivant.
          loader = null;
          reject(error);
        })
        .finally(next);
    };
    if (active < MAX_PARALLEL) run();
    else if (urgent) waiting.unshift(run);
    else waiting.push(run);
  });
}
