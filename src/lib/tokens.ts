import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Whoever holds a link's management token can see its stats and delete it.
 * Only a SHA-256 hash is stored, so a database leak doesn't give control of
 * every link. Tokens are 256 random bits, so a plain hash (no salt or
 * stretching) is enough: there's nothing to guess.
 */
export function newToken(): string {
  return `snip_${randomBytes(32).toString("base64url")}`;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time comparison, so response timing reveals nothing about the hash. */
export function tokenMatches(token: string, hash: string): boolean {
  const a = Buffer.from(hashToken(token), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
