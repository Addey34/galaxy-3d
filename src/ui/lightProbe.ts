/**
 * Sonde d'ÉCLAIRAGE d'un point de surface, pour N'IMPORTE QUEL corps, activée par `?debug-light`
 * seulement (GAL-IMMERSION-001).
 *
 * Question posée : le Soleil que voit un site, TEL QUE RENDU, est-il celui du calcul
 * astronomique ? La sonde publie `window.__galaxyLight.measure(corps, lat, lon)` ; elle ne
 * calcule AUCUNE référence (la référence est indépendante : `scripts/measure-surface-light.mjs`,
 * astronomy-engine + modèle de rotation IAU, qui ne touche ni la scène ni `frames.ts`).
 *
 * Tout ce qui est publié vient du graphe de scène :
 *  - le site passe par `CelestialObject.surfacePointToWorld` (translation, pôle IAU, phase de
 *    rotation propre), la chaîne exacte qui pose les noms de lieux et les carreaux ;
 *  - le Soleil est la PointLight de la scène (à l'origine) : sa direction en un site est
 *    `origine - positionMondeDuSite`, ce que le matériau utilise réellement (relief et albédo
 *    exclus : c'est la normale GÉOMÉTRIQUE, sphère ou ellipsoïde du rendu) ;
 *  - le point subsolaire est lu par `worldPointToGeographic`, la réciproque de la précédente.
 */
import * as THREE from 'three';
import type { PublicAPI } from '@/SolarSystemApp';
import { RAD_TO_DEG as DEG } from '@/core/MathConstants';
import { hasDebugFlag } from '@/utils/debugFlags';

export interface LightMeasurement {
  /** Date de la scène (ISO) : à comparer à celle demandée, la mesure n'a de sens que stabilisée. */
  date: string;
  body: string;
  /** Point subsolaire rendu (degrés, longitude Est positive, convention de la texture). */
  subsolar: { latitudeDeg: number; longitudeDeg: number };
  /** Point sous la Terre (ou le parent) rendu ; null pour le Soleil ou sans parent défini. */
  subEarth: { latitudeDeg: number; longitudeDeg: number } | null;
  site: {
    latitudeDeg: number;
    longitudeDeg: number;
    /** Produit scalaire normale géométrique · direction du Soleil au site. */
    dot: number;
    /** Hauteur du Soleil sur l'horizon du site, degrés (asin du produit scalaire). */
    sunAltitudeDeg: number;
    /** Azimut du Soleil depuis le nord vers l'est, degrés, ou null aux pôles. */
    sunAzimuthDeg: number | null;
    day: boolean;
    /** Direction monde du Soleil vue du site : celle de la lumière du matériau. */
    lightDirection: [number, number, number];
  };
  sceneUnitsPerBodyRadius: number;
}

declare global {
  interface Window {
    __galaxyLight?: {
      measure: (
        body: string,
        latitudeDeg: number,
        longitudeDeg: number
      ) => LightMeasurement | null;
    };
  }
}

export function setupLightProbe(api: PublicAPI): () => void {
  if (!hasDebugFlag('debug-light')) return () => undefined;

  const sun = api.sceneSystem.getBody('sun');
  const earth = api.sceneSystem.getBody('earth');

  const measure = (
    bodyName: string,
    latitudeDeg: number,
    longitudeDeg: number
  ): LightMeasurement | null => {
    const body = api.sceneSystem.getBody(bodyName);
    if (!body || !sun) return null;
    const sunWorld = sun.group.getWorldPosition(new THREE.Vector3());
    const center = body.group.getWorldPosition(new THREE.Vector3());

    const toSun = sunWorld.clone().sub(center).normalize();
    const subsolar = body.worldPointToGeographic(center.clone().add(toSun));
    let subEarth: LightMeasurement['subEarth'] = null;
    if (earth && bodyName !== 'earth') {
      const earthWorld = earth.group.getWorldPosition(new THREE.Vector3());
      const toEarth = earthWorld.sub(center).normalize();
      subEarth = body.worldPointToGeographic(center.clone().add(toEarth));
    }

    const sitePoint = body.surfacePointToWorld(latitudeDeg, longitudeDeg);
    const normal = sitePoint.clone().sub(center).normalize();
    const light = sunWorld.clone().sub(sitePoint).normalize();
    const dot = normal.dot(light);

    // Repère local Est-Nord-Haut sur l'axe de rotation RENDU.
    const axis = body.getAxisDirection();
    const east = axis.clone().cross(normal);
    let azimuth: number | null = null;
    if (east.lengthSq() > 1e-12) {
      east.normalize();
      const north = normal.clone().cross(east).normalize();
      azimuth =
        (Math.atan2(light.dot(east), light.dot(north)) * DEG + 360) % 360;
    }

    return {
      date: api.orbitalMechanics.simulationDate.toISOString(),
      body: bodyName,
      subsolar,
      subEarth,
      site: {
        latitudeDeg,
        longitudeDeg,
        dot,
        sunAltitudeDeg: Math.asin(THREE.MathUtils.clamp(dot, -1, 1)) * DEG,
        sunAzimuthDeg: azimuth,
        day: dot > 0,
        lightDirection: [light.x, light.y, light.z],
      },
      sceneUnitsPerBodyRadius: sitePoint.distanceTo(center),
    };
  };

  window.__galaxyLight = { measure };
  return () => {
    delete window.__galaxyLight;
  };
}
