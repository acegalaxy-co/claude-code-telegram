/**
 * Simple in-memory token bucket per chat. Survives only as long as the
 * process. Suitable for abuse mitigation, not a hard guarantee.
 *
 * Buckets refill linearly: `capacity` tokens per `windowMs` ms.
 */

export function createRateLimiter({ capacity, windowMs }) {
  const buckets = new Map(); // chatId → { tokens, lastRefill }

  function take(chatId, cost = 1) {
    const now = Date.now();
    let b = buckets.get(chatId);
    if (!b) {
      b = { tokens: capacity, lastRefill: now };
      buckets.set(chatId, b);
    }
    const elapsed = now - b.lastRefill;
    if (elapsed > 0) {
      const refill = (elapsed / windowMs) * capacity;
      b.tokens = Math.min(capacity, b.tokens + refill);
      b.lastRefill = now;
    }
    if (b.tokens < cost) {
      const need = cost - b.tokens;
      const waitMs = Math.ceil((need / capacity) * windowMs);
      return { ok: false, retryAfterMs: waitMs };
    }
    b.tokens -= cost;
    return { ok: true };
  }

  return { take };
}
