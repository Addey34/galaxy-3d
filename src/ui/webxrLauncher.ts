/**
 * Entrée VR (WebXR) : LANCEUR. Détection de capacité, bouton du dock et demande de session restent
 * ici, au démarrage ; tout le reste (contrôleurs, locomotion, sélection, panneau d'information, soit
 * `ui/webxr.ts` et ses trois voisins) n'est chargé que sur un appareil capable de VR, donc jamais sur
 * Safari/iOS ni sur un navigateur sans casque. Safari/iOS n'expose pas `navigator.xr` : repli
 * silencieux plutôt qu'un bouton mort.
 *
 * GESTE UTILISATEUR : `requestSession` est appelé SYNCHRONIQUEMENT dans le gestionnaire de clic,
 * avant tout `await`, comme avant le découpage ; le module différé est déjà demandé dès la détection
 * et le résultat n'est attendu qu'APRÈS l'obtention de la session, pour poser les écouteurs avant
 * `setSession`. Un échec de chargement est DIT (annonceur) et le prochain clic réessaie.
 */
import type { CameraSystem } from '@/components/systems/CameraSystem';
import type { SceneSystem } from '@/components/systems/SceneSystem';
import type { AnimationSystem } from '@/components/systems/AnimationSystem';
import { t } from '@/i18n';
import type { PlanetNavigation } from './planetNav';
import { getAnnouncer } from './announcer';

export interface WebXRHandle {
  /** À appeler depuis le callback de bascule de mode (Éduc ↔ Explo). */
  setMode(mode: 'educ' | 'explo'): void;
}

export function setupWebXR(
  camera: CameraSystem,
  scene: SceneSystem,
  animationSystem: AnimationSystem,
  nav: PlanetNavigation,
  bodyNames: ReadonlySet<string>
): WebXRHandle {
  let mode: 'educ' | 'explo' = 'educ';
  const handle: WebXRHandle = {
    setMode: (next) => {
      mode = next;
    },
  };

  const button = document.getElementById('webxr-btn');
  if (!navigator.xr || !button) return handle;

  void navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
    if (!supported) return;
    button.hidden = false;

    // Demandé UNE fois, dès que la VR est possible ; un échec est réessayé au clic suivant.
    let attached: Promise<void> | null = null;
    const attach = (): Promise<void> => {
      attached ??= import('./webxr')
        .then((m) =>
          m.attachWebXR(
            camera,
            scene,
            animationSystem,
            nav,
            bodyNames,
            () => mode
          )
        )
        .catch((err: unknown) => {
          attached = null;
          throw err;
        });
      return attached;
    };
    attach().catch(() => undefined); // l'échec est dit au clic, quand l'utilisateur en a besoin

    let activeSession: XRSession | null = null;
    const setButtonLabel = (entering: boolean): void => {
      button.setAttribute(
        'title',
        t(entering ? 'webxr.btn.enter.title' : 'webxr.btn.exit.title')
      );
      button.setAttribute(
        'aria-label',
        t(entering ? 'webxr.btn.enter.aria' : 'webxr.btn.exit.aria')
      );
    };

    button.addEventListener('click', () => {
      if (activeSession) {
        void activeSession.end();
        return;
      }
      void navigator.xr
        ?.requestSession('immersive-vr', {
          optionalFeatures: ['local-floor', 'bounded-floor'],
        })
        .then(async (session) => {
          try {
            await attach();
          } catch {
            await session.end();
            getAnnouncer().announce(t('feature.loadFailed'));
            return;
          }
          activeSession = session;
          setButtonLabel(false);
          session.addEventListener('end', () => {
            activeSession = null;
            setButtonLabel(true);
          });
          void camera.renderer.xr.setSession(session);
        })
        .catch(() => {
          // Capacité déjà confirmée par isSessionSupported ; un rejet ici signifie que
          // l'utilisateur a refusé la permission ou qu'aucun runtime XR n'a répondu : le bouton
          // reste utilisable pour réessayer.
        });
    });
  });

  return handle;
}
