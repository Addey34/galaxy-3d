/**
 * Conversion de distances UA → unités Three.js selon le mode d'échelle.
 *
 * MODE ÉDUCATIF ('educ')
 *   Compression racine carrée : scene_units = √(distance_AU) × K.
 *   OrbitalMechanics calcule directement r = √(distanceAU) × SQRT_K (même formule).
 *   Constante K = 35 choisie pour que la Terre (1 UA) → 35 unités.
 *
 * MODE EXPLORATION ('explo')
 *   Vraie proportionnalité linéaire : scene_units = distance_AU × K.
 *   auVectorToScene() applique cette échelle aux positions Kepler réelles.
 *
 * Dans les deux modes, la Terre (1 UA) tombe à 35 unités ; ils ne diffèrent que par
 * la façon dont les autres distances se compressent (√ en Éducatif, linéaire en Explo).
 */

import * as THREE from 'three';

export type ScaleMode = 'educ' | 'explo';

export const SQRT_K = 35; // Terre (1 UA) → 35 unités

/** Kilomètres par unité astronomique — conversion rayon physique ↔ UA. */
export const KM_PER_AU = 149_597_870;

export class ScaleService {
  private _mode: ScaleMode = 'educ';

  get mode(): ScaleMode {
    return this._mode;
  }
  set mode(m: ScaleMode) {
    this._mode = m;
  }

  /**
   * Convertit une distance en UA vers des unités Three.js.
   *   educ : sqrt(AU) × K  — compression visuelle, distances proches
   *   explo : AU × K        — vraie proportionnalité (Neptune ~30× Terre)
   */
  auToScene(distanceAU: number): number {
    const d = Math.max(distanceAU, 0);
    return this._mode === 'explo' ? d * SQRT_K : Math.sqrt(d) * SQRT_K;
  }

  /**
   * Convertit un vecteur en UA vers le repère Three.js.
   * Préserve la direction, applique auToScene sur la magnitude.
   */
  auVectorToScene(v: THREE.Vector3): THREE.Vector3 {
    const dist = v.length();
    if (dist < 1e-12) return new THREE.Vector3(0, 0, 0);
    const scaledDist = this.auToScene(dist);
    return v.clone().normalize().multiplyScalar(scaledDist);
  }
}

// ── Helpers statiques ────────────────────────────────────────────────────────

/**
 * Rayon d'orbite en échelle compressée √(AU) × SQRT_K — l'échelle du mode ÉDUCATIF
 * (le mode Explo, lui, est linéaire AU × SQRT_K et recalculé par OrbitalMechanics).
 * Sert de valeur `orbitalRadius` par défaut dans le config et de position initiale
 * placeholder, écrasée au premier frame.
 */
export const educRadius = (distanceAU: number): number =>
  Math.sqrt(Math.max(distanceAU, 0)) * SQRT_K;

/**
 * Distance caméra en mode Explo depuis le rayon physique en km.
 * Formule : (radiusKm / AU_KM) × SQRT_K × VIEW_FACTOR
 * VIEW_FACTOR = 7 → angle apparent ~8° (confortable).
 */
const VIEW_FACTOR = 7;
export const exploCameraDistance = (radiusKm: number): number =>
  (radiusKm / KM_PER_AU) * SQRT_K * VIEW_FACTOR;
