import { randomInt } from "node:crypto";

/**
 * No 0/O, 1/l/I: short links get read aloud and copied by hand. 55 symbols
 * over 7 characters gives about 1.5 trillion slugs.
 */
export const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
export const SLUG_LENGTH = 7;

/** A random slug. randomInt draws without modulo bias. */
export function randomSlug(length = SLUG_LENGTH): string {
  let slug = "";
  for (let i = 0; i < length; i++) slug += ALPHABET[randomInt(ALPHABET.length)];
  return slug;
}

/** Paths the app uses itself, which links must not shadow. */
const RESERVED = new Set([
  "api",
  "stats",
  "manage",
  "new",
  "about",
  "health",
  "healthz",
  "static",
  "assets",
  "public",
  "admin",
  "login",
  "favicon.ico",
  "robots.txt",
  "qr",
]);

/** Returns an error message, or null if the custom slug can be used. */
export function checkCustomSlug(slug: string): string | null {
  if (slug.length < 3 || slug.length > 40) return "Custom names must be 3 to 40 characters";
  if (!/^[A-Za-z0-9_-]+$/.test(slug)) return "Use only letters, numbers, - and _";
  if (/^[-_]|[-_]$/.test(slug)) return "Custom names can't start or end with - or _";
  if (RESERVED.has(slug.toLowerCase())) return `"${slug}" is reserved`;
  return null;
}
