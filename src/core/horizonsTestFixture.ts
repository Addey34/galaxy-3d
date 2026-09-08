import { readFileSync } from 'node:fs';
import { CELESTIAL_CONFIG } from '@/config/bodies';
import { bodyDynamics } from '@/config/gravity';
import { HorizonsEphemerisService } from './HorizonsEphemerisService';

/**
 * Charge le service Horizons sur les binaires RÉELLEMENT COMMITTÉS, pour les tests.
 *
 * Pourquoi ce fixture existe. `HorizonsEphemerisService.load()` passe par `fetch` et
 * `window.location`, absents sous Vitest en environnement `node`. Un test qui veut exercer le
 * chemin de PRODUCTION — celui que voit l'utilisateur — doit donc reconstruire la même
 * structure interne depuis le disque. Trois fichiers de test le faisaient chacun de leur côté,
 * et chacun pouvait diverger de la vraie configuration sans que rien ne le signale : oublier
 * d'injecter la table `bodyDynamics`, par exemple, désactive silencieusement l'interpolation
 * dynamique et fait mesurer au test un comportement que personne n'exécute jamais.
 *
 * D'où un seul point de vérité, aligné sur ce que fait `SolarSystemApp` au démarrage.
 *
 * Ce n'est PAS un mock : les données sont les vrais fichiers du dépôt. Un test bâti dessus
 * échouera légitimement si un futur `pnpm ephemeris:generate` change le pas, la couverture ou
 * le centre d'un corps — c'est le but, ces fichiers font partie du produit.
 */

export const EPHEMERIDES_DIR = 'public/assets/ephemerides/';

export interface HorizonsManifestEntry {
  file: string;
  center?: string;
  stepDays: number;
  startJdTdb: number;
  sampleCount: number;
}

/** Le manifeste committé, tel quel. */
export const horizonsManifest = JSON.parse(
  readFileSync(EPHEMERIDES_DIR + 'manifest.json', 'utf-8')
) as { bodies: Record<string, HorizonsManifestEntry> };

/**
 * Instancie le service sur les fichiers du dépôt, avec la MÊME table de dynamique que la
 * couche de composition — sans elle, le service retomberait sur l'interpolation cubique seule
 * et le test n'exercerait pas le chemin réel.
 */
export function horizonsServiceFromDisk(): HorizonsEphemerisService {
  const dynamics = bodyDynamics(CELESTIAL_CONFIG);
  const loaded = new Map<string, unknown>();

  for (const [name, entry] of Object.entries(horizonsManifest.bodies)) {
    const file = readFileSync(EPHEMERIDES_DIR + entry.file);
    loaded.set(name, {
      manifest: entry,
      samples: new Float64Array(
        file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
      ),
      ...(dynamics[name] !== undefined ? { dynamics: dynamics[name] } : {}),
    });
  }

  // Le constructeur est `private` côté TypeScript seulement : au runtime c'est un
  // constructeur ordinaire, et c'est la seule voie pour construire le service hors du
  // navigateur. Le cast est délibéré et confiné ici.
  type Ctor = new (bodies: Map<string, unknown>) => HorizonsEphemerisService;
  return new (HorizonsEphemerisService as unknown as Ctor)(loaded);
}
