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
import type * as THREE from 'three';

/**
 * Ce que le corps lit d'un modèle : sa scène. Le lecteur minimal (`shapeGlb.ts`) sert les modèles de forme,
 * tous du même sous-ensemble de glTF ; le chargeur complet de three (44 729 octets) n'est importé QUE pour
 * un fichier qui en sort (GAL-ENGINE-CAPACITY-002).
 */
export interface ShapeModel {
  scene: THREE.Object3D;
}

export const MAX_PARALLEL = 2;

let reader: Promise<typeof import('./shapeGlb')> | null = null;
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
  reader ??= import('./shapeGlb');
  // Un échec ici n'est pas une erreur : le prochain vrai chargement réessaie.
  reader.catch(() => {
    reader = null;
  });
}

/** Le chargeur complet, pour un fichier hors du sous-ensemble des modèles de forme. */
async function loadWithFullLoader(url: string): Promise<ShapeModel> {
  const { GLTFLoader } =
    await import('three/examples/jsm/loaders/GLTFLoader.js');
  return new GLTFLoader().loadAsync(url);
}

/** Charge un modèle de forme, sous le plafond de chargements simultanés. */
export function loadShapeGltf(
  url: string,
  urgent = false
): Promise<ShapeModel> {
  return new Promise<ShapeModel>((resolve, reject) => {
    const run = (): void => {
      active += 1;
      reader ??= import('./shapeGlb');
      reader
        .then(async (m) => {
          try {
            return await m.loadShapeGlb(url);
          } catch (error) {
            // Hors du sous-ensemble : le chargeur complet, qui sait tout lire.
            if (error instanceof m.UnsupportedGlb)
              return loadWithFullLoader(url);
            throw error;
          }
        })
        .then(resolve, (error: unknown) => {
          // Un import qui échoue ne doit pas figer le lecteur pour la visite : on le retente au suivant.
          reader = null;
          reject(error);
        })
        .finally(next);
    };
    if (active < MAX_PARALLEL) run();
    else if (urgent) waiting.unshift(run);
    else waiting.push(run);
  });
}
