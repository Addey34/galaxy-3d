/**
 * LA SCÈNE D'INSPECTION D'UN ENGIN (GAL-OBJECT-IMMERSION-001) : un modèle 3D, une caméra, une lumière.
 *
 * Elle n'a ni renderer ni boucle à elle : `ui/craftInspector` pose son rendu dans `AnimationSystem`
 * (`setRenderOverride`), comme la vue du voisinage solaire. Elle possède seulement ce qu'elle crée
 * (géométries, matériaux, textures, décodeur) et le libère dans `dispose()`.
 *
 * ÉCHELLE DE PRÉSENTATION : le modèle est recentré et ramené à une sphère englobante de rayon 1,
 * quelle que soit l'unité de son fichier (le Voyager mesure 0,3 unité, l'ISS 45). Cette échelle est
 * PROPRE à l'inspection ; la scène astronomique, elle, n'agrandit jamais un engin.
 *
 * Le fichier de la NASA est compressé en Draco. Le décodeur est la version JavaScript de three
 * (`public/assets/draco/<empreinte>/draco_decoder.js`), pas la version WebAssembly : la politique de sécurité du
 * site (`script-src 'self'`) ne déclare pas `wasm-unsafe-eval`, et seule la variante JavaScript est
 * DÉMONTRÉE sous cette politique (`e2e/built-craftInspector.spec.ts`, avec témoin sans politique).
 */
import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { DRACO_DECODER_DIR } from '@/config/craftModels';
import { fitDistance } from '@/core/craftFit';

export const CRAFT_FOV_DEG = 38;
const DECODER_PATH = `${import.meta.env.BASE_URL}${DRACO_DECODER_DIR.replace(/^\//, '')}`;
const HIGHLIGHT = new THREE.Color(0x3b82f6);

interface Highlighted {
  mesh: THREE.Mesh;
  original: THREE.Material | THREE.Material[];
  clones: THREE.Material[];
}

export class CraftScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** Rayon de la sphère englobante APRÈS normalisation : toujours 1 une fois chargé. */
  readonly radius = 1;
  private model: THREE.Object3D | null = null;
  private environment: THREE.WebGLRenderTarget | null = null;
  private highlighted: Highlighted[] = [];
  private decoder: DRACOLoader | null = null;
  private disposed = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(
      CRAFT_FOV_DEG,
      Math.max(aspect, 0.05),
      0.01,
      100
    );
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(3, 4, 5);
    this.scene.add(sun, new THREE.AmbientLight(0x8899bb, 0.35));
  }

  /** Distance de cadrage pour l'allure courante de la caméra. */
  homeDistance(): number {
    return fitDistance(this.radius, CRAFT_FOV_DEG, this.camera.aspect);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = Math.max(aspect, 0.05);
    this.camera.updateProjectionMatrix();
  }

  /** Charge le modèle ; rejette si le fichier est illisible ou vide (l'appelant le dit, rien n'est inventé). */
  async load(url: string, renderer: THREE.WebGLRenderer): Promise<void> {
    const draco = new DRACOLoader();
    draco.setDecoderPath(DECODER_PATH);
    draco.setDecoderConfig({ type: 'js' });
    this.decoder = draco;
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    const gltf = await loader.loadAsync(url);
    if (this.disposed) {
      this.disposeObject(gltf.scene);
      return;
    }
    this.useModel(gltf.scene);
    // Les matériaux PBR de la NASA sont presque noirs sans environnement : une pièce de studio neutre.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const target = pmrem.fromScene(new RoomEnvironment(), 0.04);
    pmrem.dispose();
    this.environment = target;
    this.scene.environment = target.texture;
  }

  /** Adopte un modèle chargé : recentré sur sa boîte, ramené à une sphère de rayon 1. Rejette un modèle sans maillage. */
  useModel(object: THREE.Object3D): void {
    let meshes = 0;
    object.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshes++;
    });
    if (meshes === 0) throw new Error('glTF sans maillage');
    const box = new THREE.Box3().setFromObject(object);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const holder = new THREE.Group();
    object.position.sub(sphere.center);
    holder.add(object);
    holder.scale.setScalar(this.radius / Math.max(sphere.radius, 1e-9));
    this.scene.add(holder);
    this.model = holder;
  }

  /** Nombre de triangles réellement présents dans la scène (garde contre un fichier substitué). */
  triangleCount(): number {
    let n = 0;
    this.model?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const g = mesh.geometry;
      n += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    });
    return n;
  }

  /** Les noms de noeuds présents dans le fichier (pour vérifier que les pièces déclarées existent). */
  nodeNames(): Set<string> {
    const names = new Set<string>();
    this.model?.traverse((o) => {
      if (o.name) names.add(o.name);
    });
    return names;
  }

  /** Éclaire une pièce (ses noeuds et leurs descendants) ; `null` éteint tout. */
  highlight(nodes: readonly string[] | null): void {
    this.clearHighlight();
    if (!nodes || !this.model) return;
    for (const name of nodes) {
      const node = this.model.getObjectByName(name);
      node?.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const original = mesh.material;
        const clones = (Array.isArray(original) ? original : [original]).map(
          (m) => {
            const clone = m.clone() as THREE.MeshStandardMaterial;
            if ('emissive' in clone) {
              clone.emissive = HIGHLIGHT.clone();
              clone.emissiveIntensity = 0.9;
            }
            return clone;
          }
        );
        mesh.material = Array.isArray(original) ? clones : clones[0]!;
        this.highlighted.push({ mesh, original, clones });
      });
    }
  }

  private clearHighlight(): void {
    for (const { mesh, original, clones } of this.highlighted) {
      mesh.material = original;
      for (const c of clones) c.dispose();
    }
    this.highlighted = [];
  }

  private disposeObject(root: THREE.Object3D): void {
    const textures = new Set<THREE.Texture>();
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const m of materials) {
        for (const value of Object.values(m))
          if (value && (value as THREE.Texture).isTexture)
            textures.add(value as THREE.Texture);
        m.dispose();
      }
    });
    for (const t of textures) {
      // Une texture issue d'un `ImageBitmap` le garde ouvert : on le ferme avec elle.
      const image = t.image as { close?: () => void } | undefined;
      t.dispose();
      image?.close?.();
    }
  }

  /** Libère tout ce que la scène a créé (GPU compris) ; sûre à appeler deux fois. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearHighlight();
    if (this.model) {
      this.scene.remove(this.model);
      this.disposeObject(this.model);
      this.model = null;
    }
    this.environment?.dispose();
    this.environment = null;
    this.scene.environment = null;
    this.decoder?.dispose();
    this.decoder = null;
  }
}
