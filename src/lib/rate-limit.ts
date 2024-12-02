type Bucket = { tokens: number; updated: number };

/**
 * Per-key token buckets (one key per client IP). Memory is bounded: when
 * the map is full, the least recently used buckets are dropped first.
 */
export class RateLimiter {
  readonly #buckets = new Map<string, Bucket>();
  readonly #capacity: number;
  readonly #perSecond: number;
  readonly #maxKeys: number;
  readonly #now: () => number;

  constructor({ capacity, perMinute, maxKeys = 10_000, now = Date.now }: { capacity: number; perMinute: number; maxKeys?: number; now?: () => number }) {
    this.#capacity = capacity;
    this.#perSecond = perMinute / 60;
    this.#maxKeys = maxKeys;
    this.#now = now;
  }

  /** Takes one token; returns how many seconds to wait if there isn't one. */
  take(key: string): { allowed: true } | { allowed: false; retryAfter: number } {
    const now = this.#now();
    const bucket = this.#buckets.get(key) ?? { tokens: this.#capacity, updated: now };
    bucket.tokens = Math.min(this.#capacity, bucket.tokens + ((now - bucket.updated) / 1000) * this.#perSecond);
    bucket.updated = now;

    // Re-insert so Map order tracks recency, then trim the oldest.
    this.#buckets.delete(key);
    this.#buckets.set(key, bucket);
    for (const oldest of this.#buckets.keys()) {
      if (this.#buckets.size <= this.#maxKeys) break;
      this.#buckets.delete(oldest);
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true };
    }
    return { allowed: false, retryAfter: Math.ceil((1 - bucket.tokens) / this.#perSecond) };
  }

  get size() {
    return this.#buckets.size;
  }
}
