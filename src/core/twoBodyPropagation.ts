/**
 * Propagation deux-corps d'un ÉTAT (position + vitesse) — fonction pure, testée.
 *
 * Complémentaire de `kepler.ts`, qui part d'éléments orbitaux publiés. Ici on part d'un
 * état instantané, ce que fournissent les éphémérides numériques (Horizons, SPK), et on
 * avance le long de la conique osculatrice à cet instant.
 *
 * À quoi cela sert dans ce projet : les fichiers Horizons sont échantillonnés à pas fixe
 * (`stepDays`), et l'interpolation de Hermite entre deux échantillons suppose que le
 * mouvement est LISSE sur l'intervalle. Pour un satellite dont la période est plus courte
 * que le pas, cette hypothèse est fausse — le corps a fait plusieurs tours entre les deux
 * échantillons, et la cubique ne reconstruit rien du tout (mesuré : Phobos balayait 2° au
 * lieu de 360° sur une période, Encelade s'éloignait de Saturne d'un facteur 11). La
 * dynamique, elle, sait franchir un intervalle qui contient dix révolutions : c'est
 * exactement ce que fait cette fonction.
 *
 * Forme elliptique seulement (e < 1), via les fonctions f et g. C'est le cas de tous les
 * corps du catalogue ; un état non elliptique renvoie `null` plutôt qu'une position
 * silencieusement fausse, à charge de l'appelant de retomber sur son interpolation.
 */
import * as THREE from 'three';
import { solveKepler } from './kepler';

/** Constante de Gauss (UA^1.5·jour⁻¹) — μ☉ = k² en UA³/jour². */
const GAUSS_K = 0.017_202_098_95;

/** Paramètre gravitationnel du Soleil, en UA³/jour². */
export const MU_SUN_AU3_PER_DAY2 = GAUSS_K * GAUSS_K;

/**
 * Constante de la gravitation, en UA³·kg⁻¹·jour⁻².
 *
 * G = 6,674 30e-11 m³·kg⁻¹·s⁻² (CODATA 2018), converti :
 *   1 m = 1 / 1,495 978 707e11 UA   →   m³ = (1,495 978 707e11)⁻³ UA³
 *   1 s = 1 / 86 400 jour           →   s⁻² = 86 400² jour⁻²
 */
const METRES_PER_AU = 1.495_978_707e11;
export const G_AU3_PER_KG_DAY2 =
  (6.674_30e-11 / (METRES_PER_AU * METRES_PER_AU * METRES_PER_AU)) *
  (86_400 * 86_400);

/** Paramètre gravitationnel μ = G·M (UA³/jour²) d'un corps de masse `massKg`. */
export function gravitationalParameter(massKg: number): number {
  return G_AU3_PER_KG_DAY2 * massKg;
}

/**
 * Avance un état (position UA, vitesse UA/jour) de `deltaDays` le long de sa conique
 * osculatrice. `deltaDays` peut être négatif (propagation vers le passé).
 *
 * Renvoie `null` si l'état n'est pas elliptique — orbite ouverte, μ nul, ou position
 * dégénérée — cas où aucune conique fermée ne passe par cet état.
 *
 * @param position  position relative au corps central (UA)
 * @param velocity  vitesse relative au corps central (UA/jour)
 * @param deltaDays intervalle de propagation (jours, signé)
 * @param mu        paramètre gravitationnel du corps central (UA³/jour²)
 * @param out       vecteur de sortie réutilisable (évite une allocation par appel)
 */
export function propagateTwoBody(
  position: THREE.Vector3,
  velocity: THREE.Vector3,
  deltaDays: number,
  mu: number,
  out = new THREE.Vector3()
): THREE.Vector3 | null {
  const r0 = position.length();
  if (!(r0 > 0) || !(mu > 0)) return null;

  // Demi-grand axe par l'énergie spécifique : ε = v²/2 − μ/r = −μ/(2a).
  const v2 = velocity.lengthSq();
  const energy = v2 / 2 - mu / r0;
  if (energy >= 0) return null; // parabolique ou hyperbolique
  const a = -mu / (2 * energy);
  if (!Number.isFinite(a) || a <= 0) return null;

  const sqrtMuA = Math.sqrt(mu * a);
  const rDotV = position.dot(velocity);

  // Anomalie excentrique de départ. Écrite sous forme d'atan2 des NUMÉRATEURS :
  //   sin E₀ = (r·v) / (e√(μa))   et   cos E₀ = (1 − r/a) / e
  // partagent le même 1/e, qui se simplifie dans le rapport. C'est ce qui rend l'extraction
  // stable jusqu'à e = 0 exactement — le cas d'une orbite circulaire, où la forme naïve
  // divise par zéro. La plupart des lunes régulières ont e < 0,005 : le cas limite est ici
  // la règle, pas l'exception.
  const eccentricAnomaly0 = Math.atan2(rDotV / sqrtMuA, 1 - r0 / a);

  // Excentricité par la norme du couple (e·cos E₀, e·sin E₀), seule voie fiable près de e = 0.
  const eccentricity = Math.hypot(1 - r0 / a, rDotV / sqrtMuA);
  if (eccentricity >= 1) return null;

  const meanMotion = Math.sqrt(mu / (a * a * a));
  const deltaM = meanMotion * deltaDays;
  const meanAnomaly0 =
    eccentricAnomaly0 - eccentricity * Math.sin(eccentricAnomaly0);
  const eccentricAnomaly = solveKepler(meanAnomaly0 + deltaM, eccentricity);

  // DÉROULEMENT des tours complets — indispensable, et c'est tout l'objet de cette fonction.
  // `solveKepler` ramène l'anomalie moyenne dans [-π, π] : E revient donc sur sa branche
  // principale et la différence brute E - E₀ a perdu le compte des révolutions. `f` n'en
  // souffrirait pas (elle ne dépend que de cos ΔE, périodique), mais `g` compose ce ΔE avec
  // le Δt réel : les deux doivent parler du même nombre de tours, sinon la position renvoyée
  // est fausse dès que l'intervalle dépasse une période — précisément le cas qui motive ce
  // module (Phobos fait 12,5 tours entre deux échantillons Horizons).
  //
  // L'équation de Kepler donne ΔE - e(sin E - sin E₀) = ΔM, donc |ΔE - ΔM| ≤ 2e < 2 < π :
  // l'arrondi au multiple de 2π le plus proche de ΔM retrouve le compte sans ambiguïté.
  const twoPi = 2 * Math.PI;
  const rawDeltaE = eccentricAnomaly - eccentricAnomaly0;
  const deltaE = rawDeltaE + twoPi * Math.round((deltaM - rawDeltaE) / twoPi);

  // Fonctions f et g : la nouvelle position est une combinaison linéaire de l'état de
  // départ, ce qui conserve exactement le plan orbital sans jamais reconstruire i, Ω ni ω.
  const f = 1 - (a / r0) * (1 - Math.cos(deltaE));
  const g = deltaDays - (deltaE - Math.sin(deltaE)) / meanMotion;

  return out.copy(position).multiplyScalar(f).addScaledVector(velocity, g);
}
