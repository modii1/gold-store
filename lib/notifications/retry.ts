/**
 * Retry Engine — exponential backoff for failed deliveries.
 * Schedule: attempt 1 -> +1m, attempt 2 -> +5m, attempt 3 -> +15m, then give up.
 */

const BACKOFF_MINUTES = [1, 5, 15];

export const DEFAULT_MAX_ATTEMPTS = 4; // initial + 3 retries

export function computeNextAttempt(attempt: number, now = new Date()): Date | null {
  // attempt is the number of attempts already made (0 before first send).
  if (attempt >= DEFAULT_MAX_ATTEMPTS) return null;
  const minutes = BACKOFF_MINUTES[Math.min(attempt, BACKOFF_MINUTES.length - 1)] ?? BACKOFF_MINUTES[BACKOFF_MINUTES.length - 1];
  return new Date(now.getTime() + minutes * 60 * 1000);
}

export function shouldRetry(attempt: number, maxAttempts: number): boolean {
  return attempt < maxAttempts;
}

/** Next delivery window label in Arabic for the UI. */
export function backoffLabel(attempt: number): string {
  if (attempt >= BACKOFF_MINUTES.length) return "محاولة أخيرة";
  const m = BACKOFF_MINUTES[attempt];
  if (m < 60) return `${m} دقيقة`;
  return `${Math.round(m / 60)} ساعة`;
}
