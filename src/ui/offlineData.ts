/**
 * « PRÉPARER LE HORS-LIGNE » : le seul endroit où l'application demande explicitement de quoi
 * fonctionner sans réseau, et le seul qui DISE ce que l'appareil tient déjà.
 *
 * Phase 17E, option (a2) tranchée par l'utilisateur le 2026-09-23. Ce n'est pas un pis-aller :
 * une école à connexion pauvre est exactement la cible du projet, et « je prépare chez moi,
 * j'enseigne sans réseau » est une fonctionnalité. Le téléchargement est DEMANDÉ : 38 Mo pris
 * d'office sur le forfait de quelqu'un seraient une décision prise à sa place.
 *
 * Tout ce qui est affiché est LU (`HorizonsEphemerisService.offlineState`), jamais mémorisé :
 * un « c'est prêt » enregistré survivrait à une purge de quota du navigateur, et l'appareil
 * partirait en classe en ayant oublié ses fichiers. C'est la même règle que la disponibilité
 * MESURÉE des sondes depuis le lot 7e.
 *
 * Ce module ne sait rien des octets : il appelle le service et affiche ce qu'il répond.
 */
import type {
  HorizonsEphemerisService,
  OfflineState,
} from '@/core/HorizonsEphemerisService';
import { intlLocale, onLocaleChange, t } from '@/i18n';

/**
 * Mégaoctets DÉCIMAUX (10^6), arrondis au dixième, parce que c'est l'unité sous laquelle ces
 * fichiers sont chiffrés partout ailleurs dans le projet : 38 445 024 octets font 38,4 Mo
 * décimaux et 36,7 Mio binaires. Afficher les seconds sous le nom des premiers est exactement
 * le piège que `du -h` a déjà tendu à ce dépôt.
 */
function formatMegabytes(bytes: number): string {
  return (bytes / 1e6).toLocaleString(intlLocale(), {
    maximumFractionDigits: 1,
  });
}

export function setupOfflineData(service: HorizonsEphemerisService): void {
  const host = document.getElementById('settings-section-offline');
  if (!host) return;

  const status = document.createElement('p');
  status.id = 'offline-status';
  status.className = 'offline-status';

  /**
   * Ce qu'un lecteur d'écran entend, et SEULEMENT aux deux instants qui comptent : le début et
   * la fin. Mettre `aria-live` sur la ligne d'état annoncerait les 64 pas de progression l'un
   * après l'autre, ce qui rendrait le reste de l'interface inaudible pendant le téléchargement.
   */
  const announce = document.createElement('p');
  announce.className = 'sr-only';
  announce.setAttribute('role', 'status');
  announce.setAttribute('aria-live', 'polite');

  const actions = document.createElement('div');
  actions.className = 'offline-actions';

  const prepare = document.createElement('button');
  prepare.id = 'offline-prepare';
  prepare.type = 'button';
  prepare.className = 'offline-btn';

  const forget = document.createElement('button');
  forget.id = 'offline-forget';
  forget.type = 'button';
  forget.className = 'offline-btn offline-btn--quiet';
  forget.hidden = true;

  actions.append(prepare, forget);
  host.append(status, announce, actions);

  /** Dernier état LU. `null` tant qu'aucune lecture n'a abouti. */
  let state: OfflineState | null = null;
  /** Progression d'un téléchargement en cours, ou `null` quand il n'y en a pas. */
  let progress: { done: number; total: number } | null = null;
  let abort: AbortController | null = null;

  const render = (): void => {
    // Le libellé se pose d'abord, dans TOUS les cas : sans cela le bouton reste vide le temps
    // que le magasin réponde, et un bouton sans nom n'est pas une commande.
    prepare.textContent = progress ? t('offline.cancel') : t('offline.prepare');

    if (progress) {
      status.textContent = t('offline.progress', {
        done: progress.done,
        total: progress.total,
      });
      prepare.disabled = false;
      forget.hidden = true;
      return;
    }

    if (!state) {
      status.textContent = t('offline.reading');
      prepare.disabled = true;
      forget.hidden = true;
      return;
    }

    // Deux absences distinctes, et les confondre serait mentir : un navigateur SANS magasin ne
    // pourra jamais rien garder, alors qu'un manifeste qui n'est pas arrivé n'empêchera rien
    // une fois revenu.
    if (!state.available) {
      status.textContent = t('offline.unavailable');
      prepare.disabled = true;
      forget.hidden = true;
      return;
    }
    if (state.declaredFiles === 0) {
      status.textContent = t('offline.noManifest');
      prepare.disabled = true;
      forget.hidden = true;
      return;
    }

    const complete = state.completeFiles === state.declaredFiles;
    status.textContent = complete
      ? t('offline.ready', {
          files: state.declaredFiles,
          size: formatMegabytes(state.storedBytes),
        })
      : t('offline.partial', {
          files: state.completeFiles,
          total: state.declaredFiles,
          size: formatMegabytes(state.remainingBytes),
        });
    prepare.disabled = complete;
    // Rien à libérer tant que le magasin est vide ; une fenêtre de démarrage y suffit.
    forget.hidden = state.storedBytes === 0;
    forget.textContent = t('offline.forget', {
      size: formatMegabytes(state.storedBytes),
    });
  };

  const readState = async (): Promise<void> => {
    state = await service.offlineState();
    render();
  };

  prepare.addEventListener('click', () => {
    if (abort) {
      abort.abort();
      return;
    }
    abort = new AbortController();
    progress = { done: 0, total: state?.declaredFiles ?? 0 };
    announce.textContent = t('offline.started');
    render();
    void service
      .prepareOffline({
        signal: abort.signal,
        onProgress: (step) => {
          progress = step;
          render();
        },
      })
      .then((next) => {
        state = next;
        announce.textContent =
          next.completeFiles === next.declaredFiles
            ? t('offline.ready', {
                files: next.declaredFiles,
                size: formatMegabytes(next.storedBytes),
              })
            : t('offline.partial', {
                files: next.completeFiles,
                total: next.declaredFiles,
                size: formatMegabytes(next.remainingBytes),
              });
      })
      .finally(() => {
        abort = null;
        progress = null;
        render();
      });
  });

  forget.addEventListener('click', () => {
    forget.disabled = true;
    void service.forgetOffline().then((next) => {
      state = next;
      forget.disabled = false;
      render();
    });
  });

  render();
  void readState();
  onLocaleChange(render);
}
