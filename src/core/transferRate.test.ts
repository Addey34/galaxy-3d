import { describe, expect, it } from 'vitest';
import {
  MIN_BUSY_MS_FOR_RATE,
  MIN_BYTES_FOR_RATE,
  RATE_MEMORY_BYTES,
  TransferRateMeter,
} from './transferRate';

/**
 * LE DÉBIT SE MESURE SUR LE TEMPS OCCUPÉ, PAS PAR REQUÊTE.
 *
 * La garde qui vaut le module est `mesure le lien et non la requête` : six requêtes simultanées
 * se partagent la bande passante, donc diviser les octets d'UNE requête par SA durée
 * sous-estime le lien d'un facteur proche du nombre de requêtes en vol. C'est la mesure qui a
 * trompé le lot 15 (64 requêtes de 77 s chacune pour 77 s de trafic au total).
 */
const KIB = 1024;

describe('TransferRateMeter', () => {
  it("ne rend rien tant qu'il n'y a pas de quoi mesurer", () => {
    const meter = new TransferRateMeter();
    expect(meter.bytesPerSecond).toBeNull();
    meter.begin(0);
    meter.end(1_000, MIN_BYTES_FOR_RATE - 1);
    expect(meter.bytesPerSecond).toBeNull();
  });

  it('refuse un temps occupé trop court, où la latence pèse plus que le transfert', () => {
    const meter = new TransferRateMeter();
    meter.begin(0);
    meter.end(MIN_BUSY_MS_FOR_RATE - 1, 10 * MIN_BYTES_FOR_RATE);
    expect(meter.bytesPerSecond).toBeNull();
  });

  it('mesure LE LIEN et non la requête quand elles sont simultanées', () => {
    // Six requêtes de 64 KiB lancées ensemble, toutes finies à 1 s : le lien a servi 384 KiB
    // en une seconde. Une mesure par requête conclurait 64 KiB/s, soit six fois trop peu.
    const meter = new TransferRateMeter();
    for (let i = 0; i < 6; i++) meter.begin(0);
    for (let i = 0; i < 6; i++) meter.end(1_000, 64 * KIB);
    expect(meter.busyMs).toBe(1_000);
    expect(meter.bytesPerSecond).toBe(384 * KIB);
  });

  it('additionne les périodes occupées et IGNORE les trous', () => {
    const meter = new TransferRateMeter();
    meter.begin(0);
    meter.end(500, 32 * KIB);
    // Une seconde sans aucune requête : ce n'est pas du lien lent, c'est du silence.
    meter.begin(1_500);
    meter.end(2_000, 32 * KIB);
    expect(meter.busyMs).toBe(1_000);
    expect(meter.bytesPerSecond).toBe(64 * KIB);
  });

  it("compte le temps d'une requête qui ÉCHOUE, avec ses zéro octet", () => {
    const fast = new TransferRateMeter();
    fast.begin(0);
    fast.end(1_000, 64 * KIB);
    const withFailure = new TransferRateMeter();
    withFailure.begin(0);
    withFailure.end(1_000, 64 * KIB);
    withFailure.begin(1_000);
    withFailure.end(2_000, 0);
    // Oublier l'échec ferait croire le lien deux fois plus rapide qu'il ne l'est.
    expect(withFailure.bytesPerSecond).toBe(fast.bytesPerSecond! / 2);
  });

  it('ne compte pas deux fois une période chevauchée', () => {
    const meter = new TransferRateMeter();
    meter.begin(0);
    meter.begin(300);
    meter.end(800, 32 * KIB);
    meter.end(1_000, 32 * KIB);
    expect(meter.busyMs).toBe(1_000);
  });

  it('survit à un `end` orphelin et à une horloge absurde', () => {
    const meter = new TransferRateMeter();
    meter.end(1_000, 64 * KIB);
    expect(meter.busyMs).toBe(0);
    expect(meter.bytes).toBe(0);
    meter.begin(Number.NaN);
    meter.begin(0);
    meter.end(Number.NaN, 64 * KIB);
    expect(Number.isFinite(meter.busyMs)).toBe(true);
  });

  it('un lien deux fois plus lent rend un débit deux fois plus bas', () => {
    const slow = new TransferRateMeter();
    slow.begin(0);
    slow.end(2_000, 64 * KIB);
    const fast = new TransferRateMeter();
    fast.begin(0);
    fast.end(1_000, 64 * KIB);
    expect(fast.bytesPerSecond).toBe(2 * slow.bytesPerSecond!);
  });

  it('mesure le lien RÉCENT : un démarrage rapide ne décide pas de toute la session', () => {
    const meter = new TransferRateMeter();
    // Phase 1 : la mémoire entière remplie à 1 Mo/s (la fibre du départ).
    let now = 0;
    meter.begin(now);
    now += RATE_MEMORY_BYTES / 1_000; // 1 000 o/ms = 1 Mo/s
    meter.end(now, RATE_MEMORY_BYTES);
    const fast = meter.bytesPerSecond!;
    expect(fast).toBeCloseTo(1_000_000, -3);

    // Phase 2 : le même volume, dix fois plus lentement (le lien du train), par tranches.
    const chunk = RATE_MEMORY_BYTES / 8;
    for (let i = 0; i < 8; i++) {
      meter.begin(now);
      now += chunk / 100; // 100 o/ms = 100 ko/s
      meter.end(now, chunk);
    }
    const slow = meter.bytesPerSecond!;
    // Il n'a pas à valoir exactement 100 ko/s (c'est une moyenne pondérée), mais il doit avoir
    // MARCHÉ vers le lien réel : sans mémoire bornée il resterait au-dessus de 500 ko/s.
    expect(slow).toBeLessThan(fast / 3);
    expect(slow).toBeGreaterThan(90_000);
  });

  it('oublier ne change PAS le débit à l’instant où l’on oublie', () => {
    const meter = new TransferRateMeter();
    meter.begin(0);
    meter.end(1_000, RATE_MEMORY_BYTES);
    const before = meter.bytesPerSecond!;
    // La tranche suivante arrive au MÊME débit : la réduction ne doit rien déplacer.
    meter.begin(1_000);
    meter.end(2_000, RATE_MEMORY_BYTES);
    expect(meter.bytesPerSecond!).toBeCloseTo(before, 6);
    // Et les accumulateurs sont bornés.
    expect(meter.bytes).toBeLessThanOrEqual(RATE_MEMORY_BYTES);
  });
});
