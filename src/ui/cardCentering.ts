/**
 * Le centrage de l'écran quand s'ouvre la fiche d'un objet du ciel (ciel profond, exoplanètes) :
 * l'objet arrive au centre, ou au milieu de la zone libre sous la fiche sur téléphone. Le calcul et
 * l'animation (`components/systems/SkyCenteringView`) ne sont chargés qu'à la première ouverture,
 * jamais au démarrage ; ce module partagé est la seule chose que les fiches importent.
 */
import type {
  SkyCenteringHost,
  SkyCenteringView,
} from '@/components/systems/SkyCenteringView';
import { freeBandAnchor } from '@/core/skyCentering';

/** Rend la fonction qui centre sur une direction (unitaire, repère de la scène) ; inerte sans caméra. */
export function createCardCentering(
  host: SkyCenteringHost | undefined
): (direction: readonly [number, number, number], card: HTMLElement) => void {
  let view: Promise<SkyCenteringView> | null = null;
  return (direction, card) => {
    if (!host) return;
    const anchor = freeBandAnchor(card.getBoundingClientRect(), {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    view ??= import('@/components/systems/SkyCenteringView').then(
      (m) => new m.SkyCenteringView(host)
    );
    void view.then((v) => v.center(direction, anchor));
  };
}
