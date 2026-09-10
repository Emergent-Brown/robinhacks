import { HttpsError } from 'firebase-functions/v2/https';

/** Per-instance burst protection avoids an extra billed Firestore write per call.
 * App Check, Auth quotas and bounded instances complement this; it is not a hard spend cap. */
export class RequestLimiter {
  private readonly windows = new Map<string, { startsAt: number; count: number }>();
  check(uid: string, action: string, maxPerMinute: number) {
    const now = Date.now();
    const key = `${uid}:${action}`;
    const current = this.windows.get(key);
    if (!current || now - current.startsAt >= 60_000)
      this.windows.set(key, { startsAt: now, count: 1 });
    else {
      if (current.count >= maxPerMinute)
        throw new HttpsError(
          'resource-exhausted',
          'Too many requests. Wait a minute before trying again.',
          { code: 'RATE_LIMITED', retryAfterMs: 60_000 - (now - current.startsAt) },
        );
      current.count++;
    }
    if (this.windows.size > 5000)
      for (const [entryKey, window] of this.windows)
        if (now - window.startsAt >= 60_000) this.windows.delete(entryKey);
  }
}
