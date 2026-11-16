export const DEFAULT_ATTEMPTS: number;
export const DEFAULT_DELAY_MS: number;
export const DEFAULT_FETCH_TIMEOUT_MS: number;
export const STABLE_ASSET_REQUESTS: number;
export interface DeployedBundleLimits {
  attempts: number;
  delayMs: number;
  timeoutMs: number;
}
export function readLimits(
  env?: Record<string, string | undefined>
): DeployedBundleLimits;
export function worstCaseMs(limits: DeployedBundleLimits): number;
