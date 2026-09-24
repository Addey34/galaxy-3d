/**
 * DÉBIT OBSERVÉ, MESURÉ SUR LE TEMPS OCCUPÉ ET NON PAR REQUÊTE.
 *
 * Le plafond de vitesse de lecture (§ 9b du plan du lot 17, option (c) tranchée par
 * l'utilisateur le 2026-09-24) se calcule depuis un débit RÉEL. Il faut donc le mesurer, et la
 * façon évidente est fausse : diviser les octets d'une requête par sa durée sous-estime le lien
 * d'un facteur proche du nombre de requêtes en vol, puisque six requêtes simultanées se
 * partagent la bande passante. C'est exactement la mesure qui a trompé le lot 15 : 64 requêtes
 * lancées ensemble mettaient chacune 77 s là où le lien servait 77 s de trafic AU TOTAL.
 *
 * On mesure donc le TEMPS OCCUPÉ : la durée pendant laquelle au moins une requête était en
 * vol. Les octets de toutes les requêtes divisés par ce temps-là donnent le débit que le lien
 * a réellement soutenu, quelle que soit la simultanéité.
 *
 * Pas d'horloge à l'intérieur : l'appelant passe l'instant. Le module reste pur et testable
 * sans réseau, sans minuterie et sans attente.
 */

/**
 * En dessous de ces deux seuils il n'y a pas de mesure, seulement du bruit : une seule petite
 * plage servie depuis le cache du navigateur donnerait un débit fantaisiste, et c'est sur ce
 * débit qu'on plafonnerait la lecture.
 *
 * 32 768 octets, c'est l'ordre de grandeur de la fenêtre de démarrage d'une dizaine de corps
 * (987 168 octets pour les 62 couverts, mesuré au 2026-09-23) ; 120 ms est le temps occupé en
 * dessous duquel la granularité d'un `performance.now()` et l'établissement de la connexion
 * pèsent plus que le transfert.
 */
export const MIN_BYTES_FOR_RATE = 32_768;
export const MIN_BUSY_MS_FOR_RATE = 120;

/**
 * MÉMOIRE DU COMPTEUR : il mesure le lien RÉCENT, pas la moyenne de la session.
 *
 * Défaut trouvé en concevant la garde e2e de la phase 17D, pas à la relecture : un compteur
 * purement cumulatif n'oublie jamais. Un visiteur qui démarre sur la fibre puis passe sur un
 * lien de train garderait un plafond de vitesse calculé sur la fibre, et la date se remettrait
 * à attendre en silence — exactement ce que cette phase doit supprimer. L'inverse est vrai
 * aussi : un démarrage lent brimerait la lecture pour le reste de la session.
 *
 * Au-delà de ce volume, octets et temps occupé sont réduits dans la MÊME proportion : le débit
 * mesuré est inchangé à l'instant de la réduction, mais les mesures suivantes pèsent davantage.
 * Quatre mégaoctets, parce que la fenêtre de démarrage en pèse environ un (987 168 octets,
 * mesuré au 2026-09-23) : le démarrage n'est donc pas oublié aussitôt, et quelques mégaoctets
 * de navigation suffisent à ce qu'il ne décide plus.
 */
export const RATE_MEMORY_BYTES = 4 * 1024 * 1024;

export class TransferRateMeter {
  private _inFlight = 0;
  private _busySinceMs = 0;
  private _busyMs = 0;
  private _bytes = 0;

  /** Une requête part. `nowMs` est une horloge monotone quelconque, en millisecondes. */
  begin(nowMs: number): void {
    if (!Number.isFinite(nowMs)) return;
    if (this._inFlight === 0) this._busySinceMs = nowMs;
    this._inFlight += 1;
  }

  /**
   * Une requête finit, avec les octets qu'elle a rendus. Un échec passe ici aussi, avec 0
   * octet : le temps qu'il a occupé est du temps que le lien a passé à ne rien livrer, et
   * l'oublier ferait croire le lien plus rapide qu'il n'est.
   */
  end(nowMs: number, bytes: number): void {
    if (this._inFlight === 0) return;
    this._inFlight -= 1;
    if (Number.isFinite(bytes) && bytes > 0) this._bytes += bytes;
    if (this._inFlight === 0 && Number.isFinite(nowMs)) {
      const elapsed = nowMs - this._busySinceMs;
      if (elapsed > 0) this._busyMs += elapsed;
    }
    this._forget();
  }

  /** Réduit les deux accumulateurs dans la même proportion : le débit mesuré ne change pas. */
  private _forget(): void {
    if (this._bytes <= RATE_MEMORY_BYTES) return;
    const keep = RATE_MEMORY_BYTES / this._bytes;
    this._bytes *= keep;
    this._busyMs *= keep;
  }

  /** Temps pendant lequel au moins une requête était en vol, en millisecondes. */
  get busyMs(): number {
    return this._busyMs;
  }

  /** Octets rendus, toutes requêtes confondues. */
  get bytes(): number {
    return this._bytes;
  }

  /**
   * Le débit soutenu, en octets par seconde, ou `null` tant qu'il n'y a pas de quoi le
   * mesurer. `null` n'est pas un défaut : tant qu'il vaut `null`, RIEN n'est plafonné, parce
   * que plafonner sur une supposition est exactement ce que ce dépôt refuse.
   */
  get bytesPerSecond(): number | null {
    if (this._bytes < MIN_BYTES_FOR_RATE) return null;
    if (this._busyMs < MIN_BUSY_MS_FOR_RATE) return null;
    return (this._bytes * 1000) / this._busyMs;
  }
}
