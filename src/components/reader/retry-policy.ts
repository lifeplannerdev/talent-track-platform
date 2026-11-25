// What the reader does when a page image fails (its signed link probably expired). Pure, tested.
// One refresh starts a retry. Failures that arrive while that refresh is in flight (the preloaded
// images expire together) belong to the same retry and are ignored. A failure after the fresh
// pages have arrived is real: show the message, and refresh again only after the cooldown.

export const RETRY_COOLDOWN_MS = 60_000;

export type RetryState = { startedAt: number; pagesToken: unknown } | null;
export type RetryDecision = { action: "refresh" | "ignore" | "broken"; state: RetryState };

export function decideImageError(state: RetryState, now: number, pagesToken: unknown): RetryDecision {
  if (state === null) return { action: "refresh", state: { startedAt: now, pagesToken } };
  if (state.pagesToken === pagesToken) return { action: "ignore", state };
  if (now - state.startedAt < RETRY_COOLDOWN_MS) return { action: "broken", state };
  return { action: "refresh", state: { startedAt: now, pagesToken } };
}
