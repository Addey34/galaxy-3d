/**
 * PLACE OCCUPÉE À L'ÉCRAN PAR LES LIBELLÉS, TOUTES COUCHES CONFONDUES.
 *
 * Les noms projetés viennent de surfaces qui s'ignoraient : les libellés DOM de l'`ExploHud`
 * (qui, eux, évitaient déjà les panneaux et leurs voisins), et les libellés dessinés au canvas
 * par les couches d'instrument (sondes, objets interstellaires). Résultat observé le
 * 2026-09-15 : le 19 octobre 2017, « 1I/ʻOumuamua » s'imprimait par-dessus « Lune » et
 * « OSIRIS-REx ». Chaque couche avait raison de son côté ; personne ne tenait le compte commun.
 *
 * Ce module EST ce compte commun, et rien d'autre : pas de DOM, pas de canvas, pas de Three.js.
 * Une image = un `reset()` (avec les emprises des panneaux), puis chaque couche demande une
 * place et déclare celle qu'elle a prise, dans l'ordre où elle dessine.
 */
export interface LabelRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Marges de respiration entre deux libellés (px). Reprises du placement de l'ExploHud. */
export const LABEL_PAD_X = 4;
export const LABEL_PAD_Y = 3;

export function rectsCollide(
  a: LabelRect,
  b: LabelRect,
  padX = LABEL_PAD_X,
  padY = LABEL_PAD_Y
): boolean {
  return (
    a.left < b.right + padX &&
    a.right + padX > b.left &&
    a.top < b.bottom + padY &&
    a.bottom + padY > b.top
  );
}

/** Bornes de l'aire utile : les libellés ne débordent ni sous les docks ni hors de l'écran. */
export interface LabelBounds {
  width: number;
  height: number;
  top: number;
  bottom: number;
  side: number;
}

export class LabelSpace {
  private readonly rects: LabelRect[] = [];

  /** Nouvelle image : on repart des seules emprises fixes (panneaux, docks). */
  reset(initial: readonly LabelRect[] = []): void {
    this.rects.length = 0;
    for (const rect of initial) this.rects.push(rect);
  }

  /** Déclare une place prise — un libellé posé, un marqueur, une capsule de texte. */
  add(rect: LabelRect): void {
    this.rects.push(rect);
  }

  collides(rect: LabelRect): boolean {
    return this.rects.some((other) => rectsCollide(rect, other));
  }

  /** Nombre d'emprises enregistrées (diagnostic et tests). */
  get size(): number {
    return this.rects.length;
  }

  /**
   * Empreinte bon marché du contenu : change dès qu'une emprise apparaît, disparaît ou bouge.
   * Sert aux couches qui ne repeignent que si quelque chose a changé — sans elle, une couche
   * au repos garderait un nom posé à un endroit devenu occupé par une autre couche.
   */
  signature(): number {
    let value = this.rects.length;
    for (const rect of this.rects)
      value = (value * 31 + rect.left * 7 + rect.top * 13) % 2 ** 31;
    return value;
  }

  /**
   * Cherche une place pour un texte ancré en (`x`, `y`), en essayant les décalages dans
   * l'ordre donné — le premier est la position préférée. Renvoie `null` si aucun ne tient :
   * l'appelant dessine alors son marqueur SANS son nom, ce qui reste lisible, plutôt que deux
   * noms l'un sur l'autre, ce qui n'est lisible ni l'un ni l'autre.
   *
   * Ne réserve rien : c'est à l'appelant d'appeler `add` s'il dessine.
   */
  placeText(
    x: number,
    y: number,
    width: number,
    height: number,
    offsets: readonly (readonly [number, number])[],
    bounds: LabelBounds
  ): { dx: number; dy: number; rect: LabelRect } | null {
    for (const [dx, dy] of offsets) {
      const rect = {
        left: x + dx - width / 2,
        right: x + dx + width / 2,
        top: y + dy - height / 2,
        bottom: y + dy + height / 2,
      };
      if (
        rect.left < bounds.side ||
        rect.right > bounds.width - bounds.side ||
        rect.top < bounds.top ||
        rect.bottom > bounds.height - bounds.bottom
      )
        continue;
      if (this.collides(rect)) continue;
      return { dx, dy, rect };
    }
    return null;
  }
}

/** Hauteur de ligne d'un nom dessiné au canvas (police 11 px). */
export const MARKER_LABEL_HEIGHT = 13;
/** Écart entre le marqueur et le bord de son nom : au-delà du rayon du point ET de la marge. */
export const MARKER_LABEL_GAP = 8;

/**
 * Positions candidates du CENTRE d'un nom autour de son marqueur, par ordre de préférence :
 * à droite, collé au point (habitude de lecture), puis à gauche, dessus, dessous, diagonales.
 *
 * Elles dépendent de la LARGEUR du texte : « à gauche » d'un nom de 90 px n'est pas au même
 * endroit que d'un nom de 30 px. Des décalages constants avaient été livrés, avec un écart de
 * 6 px : le point du marqueur (±4 px) et la marge de respiration (4 px) rendaient alors la
 * position collée toujours « occupée », et chaque nom partait à +40 px, jusqu'à être coupé au
 * bord de l'écran. `MARKER_LABEL_GAP` dépasse désormais point + marge.
 */
export function markerLabelCandidates(
  textWidth: number
): (readonly [number, number])[] {
  const side = MARKER_LABEL_GAP + textWidth / 2;
  const row = MARKER_LABEL_HEIGHT;
  return [
    [side, 0],
    [-side, 0],
    [0, -row],
    [0, row],
    [side, -row],
    [-side, -row],
    [side, row],
    [-side, row],
  ];
}

/** Aire utile des couches canvas : sous le dock du haut, au-dessus du deck de commande. */
export function overlayLabelBounds(width: number, height: number): LabelBounds {
  return { width, height, top: 48, bottom: 46, side: 6 };
}
