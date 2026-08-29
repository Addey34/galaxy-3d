/**
 * Panneau d'info flottant en 3D — équivalent VR de la fiche `#body-info` (overlay DOM 2D, sans
 * sens en stéréo : apparaîtrait plat par-dessus les deux yeux, casserait la profondeur). Aucune
 * infrastructure de texte 3D n'existe ailleurs dans ce projet — approche neuve, seule solution
 * disponible sans dépendance : texture canvas sur un plan, orienté face caméra chaque frame.
 */
import * as THREE from 'three';

const FONT_STACK = "system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
const CANVAS_W = 512;
const CANVAS_H = 256;

export interface XRInfoPanel {
  mesh: THREE.Mesh;
  /** `worldPos` = position du corps ; `bodyRadius` (unités scène) sert à décaler le panneau au-dessus. */
  show(title: string, lines: string[], worldPos: THREE.Vector3, bodyRadius: number): void;
  hide(): void;
  /** À appeler chaque frame tant que le panneau est visible. */
  updateBillboard(camera: THREE.Camera): void;
}

export function createInfoPanel(): XRInfoPanel {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.6, 0.3),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthTest: false, // évite le clipping en s'approchant d'une grosse planète
    })
  );
  mesh.visible = false;
  mesh.renderOrder = 999;

  const draw = (title: string, lines: string[]): void => {
    if (!ctx) return;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = 'rgba(10, 14, 22, 0.78)';
    ctx.beginPath();
    ctx.roundRect(0, 0, CANVAS_W, CANVAS_H, 24);
    ctx.fill();

    ctx.fillStyle = 'rgba(240, 245, 255, 0.98)';
    ctx.font = `700 40px ${FONT_STACK}`;
    ctx.fillText(title, 28, 64);

    ctx.fillStyle = 'rgba(205, 220, 245, 0.88)';
    ctx.font = `400 28px ${FONT_STACK}`;
    lines.forEach((line, i) => ctx.fillText(line, 28, 116 + i * 40));

    texture.needsUpdate = true;
  };

  return {
    mesh,
    show(title, lines, worldPos, bodyRadius) {
      draw(title, lines);
      mesh.position
        .copy(worldPos)
        .add(new THREE.Vector3(0, bodyRadius * 2.5 + 0.05, 0));
      mesh.visible = true;
    },
    hide() {
      mesh.visible = false;
    },
    updateBillboard(camera) {
      if (mesh.visible) mesh.quaternion.copy(camera.quaternion);
    },
  };
}
