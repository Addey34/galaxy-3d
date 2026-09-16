import { describe, expect, it } from 'vitest';
import {
  LabelSpace,
  MARKER_LABEL_GAP,
  MARKER_LABEL_HEIGHT,
  markerLabelCandidates,
  overlayLabelBounds,
  rectsCollide,
} from './labelSpace';
import type { LabelBounds, LabelRect } from './labelSpace';

const rect = (
  left: number,
  top: number,
  width = 60,
  height = 20
): LabelRect => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

const BOUNDS: LabelBounds = {
  width: 1440,
  height: 900,
  top: 48,
  bottom: 46,
  side: 6,
};

/** Décalages des couches d'instrument : à droite du marqueur, puis à gauche, puis dessus. */
const OFFSETS = [
  [40, 0],
  [-40, 0],
  [0, -16],
  [0, 16],
] as const;

describe('place occupée par les libellés', () => {
  it('ne considère pas voisins deux rectangles séparés', () => {
    expect(rectsCollide(rect(0, 0), rect(200, 0))).toBe(false);
    expect(rectsCollide(rect(0, 0), rect(0, 200))).toBe(false);
  });

  it('compte comme collision un simple frôlement (marge de respiration)', () => {
    // Bord à bord : sans marge ils ne se recouvrent pas, mais les deux capsules se touchent.
    expect(rectsCollide(rect(0, 0), rect(60, 0))).toBe(true);
    expect(rectsCollide(rect(0, 0), rect(66, 0))).toBe(false);
  });

  it('prend la position préférée quand elle est libre', () => {
    const space = new LabelSpace();
    const placed = space.placeText(700, 400, 60, 18, OFFSETS, BOUNDS);
    expect(placed?.dx).toBe(40);
    expect(placed?.dy).toBe(0);
  });

  /**
   * LE CAS SIGNALÉ : le 19 octobre 2017, « 1I/ʻOumuamua » s'imprimait par-dessus « Lune ».
   * Le libellé du HUD est posé d'abord ; la couche d'instrument doit passer à côté, pas dessus.
   */
  it('contourne un libellé déjà posé par une autre couche', () => {
    const space = new LabelSpace();
    const moon = rect(700, 392, 70, 20); // capsule « Lune » du HUD, déjà placée
    space.add(moon);
    const placed = space.placeText(700, 400, 60, 18, OFFSETS, BOUNDS);
    expect(placed).not.toBeNull();
    expect(rectsCollide(placed!.rect, moon)).toBe(false);
  });

  it('renvoie null plutôt qu’un libellé illisible quand tout est pris', () => {
    const space = new LabelSpace();
    for (const [dx, dy] of OFFSETS)
      space.add(rect(700 + dx - 30, 400 + dy - 9, 60, 18));
    expect(space.placeText(700, 400, 60, 18, OFFSETS, BOUNDS)).toBeNull();
  });

  it('refuse les positions hors de l’aire utile (docks compris)', () => {
    const space = new LabelSpace();
    // Juste sous le dock du haut : seule la position vers le bas dégage la bande réservée.
    const placed = space.placeText(700, 44, 60, 18, OFFSETS, BOUNDS);
    expect(placed?.dy).toBe(16);
    // Franchement dessous, aucune position ne tient : pas de libellé plutôt qu'un libellé caché.
    expect(space.placeText(700, 20, 60, 18, OFFSETS, BOUNDS)).toBeNull();
    // Contre le bord droit : la position préférée sort de l'écran, on bascule à gauche.
    expect(space.placeText(1430, 400, 60, 18, OFFSETS, BOUNDS)?.dx).toBe(-40);
  });

  it('repart à zéro à chaque image, en gardant les emprises fixes', () => {
    const space = new LabelSpace();
    space.add(rect(0, 0));
    space.reset([rect(500, 500)]);
    expect(space.size).toBe(1);
    expect(space.collides(rect(0, 0))).toBe(false);
    expect(space.collides(rect(500, 500))).toBe(true);
  });

  /**
   * L'empreinte sert aux couches qui ne repeignent QUE si quelque chose a changé. Si elle ne
   * bouge pas quand un libellé se déplace, cette couche garde un nom posé là où une autre vient
   * d'écrire — le défaut revient sans qu'aucune collision ne soit mal calculée.
   */
  it('change quand une emprise bouge, même à nombre constant', () => {
    const space = new LabelSpace();
    space.reset([rect(100, 100)]);
    const before = space.signature();
    space.reset([rect(101, 100)]);
    expect(space.signature()).not.toBe(before);
    space.reset([rect(100, 100)]);
    expect(space.signature()).toBe(before);
    space.add(rect(300, 300));
    expect(space.signature()).not.toBe(before);
  });

  /**
   * RÉGRESSION LIVRÉE : chaque nom était écarté de 40 px de son marqueur, jusqu'à sortir de
   * l'écran. Deux causes : des décalages constants, et le marqueur réservé AVANT son propre nom,
   * qui rendait la position naturelle toujours « occupée ». Le nom doit rester collé au point.
   */
  it('pose un nom collé à droite de son marqueur quand la place est libre', () => {
    const space = new LabelSpace();
    const textWidth = 52;
    const placed = space.placeText(
      700,
      400,
      textWidth,
      MARKER_LABEL_HEIGHT,
      markerLabelCandidates(textWidth),
      overlayLabelBounds(1440, 900)
    );
    expect(placed!.rect.left).toBeCloseTo(700 + MARKER_LABEL_GAP, 9);
    expect(placed!.dy).toBe(0);
  });

  it('passe à gauche du marqueur, collé aussi, contre le bord droit', () => {
    const space = new LabelSpace();
    const textWidth = 52;
    const placed = space.placeText(
      1400,
      400,
      textWidth,
      MARKER_LABEL_HEIGHT,
      markerLabelCandidates(textWidth),
      overlayLabelBounds(1440, 900)
    );
    expect(placed!.rect.right).toBeCloseTo(1400 - MARKER_LABEL_GAP, 9);
  });

  it('ne se laisse pas repousser par son propre marqueur, même réservé avant', () => {
    // Le point (±4 px) plus la marge de respiration (4 px) doivent rester EN DEÇÀ de l'écart
    // marqueur-nom : sinon le point rend la position collée « occupée » et chasse son nom.
    // C'est ce qui arrivait avec un écart de 6 px — l'ordre des appels n'y changeait rien.
    const space = new LabelSpace();
    space.add({ left: 696, right: 704, top: 396, bottom: 404 });
    const placed = space.placeText(
      700,
      400,
      52,
      MARKER_LABEL_HEIGHT,
      markerLabelCandidates(52),
      overlayLabelBounds(1440, 900)
    );
    expect(placed!.rect.left).toBeCloseTo(700 + MARKER_LABEL_GAP, 9);
  });
});
