import { isIP } from "node:net";

export const MAX_URL_LENGTH = 2048;

export type TargetResult = { ok: true; url: string } | { ok: false; error: string };

function isPrivateHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (isIP(h) === 4) {
    const [a = 0, b = 0] = h.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (isIP(h) === 6) return h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80");
  return false;
}

/**
 * Normalizes and checks a destination. Only http(s) to public hosts:
 * javascript: and data: links are the classic abuse of shorteners, embedded
 * credentials ("https://bank.com@evil.com") hide the real host, and links to
 * this service itself would loop.
 */
export function checkTargetUrl(input: string, ownHost?: string): TargetResult {
  let text = input.trim();
  if (!text) return { ok: false, error: "Enter a URL to shorten" };
  if (text.length > MAX_URL_LENGTH) return { ok: false, error: `URLs can be at most ${MAX_URL_LENGTH} characters` };
  // "example.com/page" without a scheme: assume https.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text) && /^[^\s/]+\.[^\s/]+/.test(text)) text = `https://${text}`;

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: "That doesn't look like a web address" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, error: "Only http and https links can be shortened" };
  if (url.username || url.password) return { ok: false, error: "Links with a username or password in them can't be shortened" };
  if (isPrivateHost(url.hostname)) return { ok: false, error: "Links to private or local addresses can't be shortened" };
  if (!url.hostname.includes(".") && isIP(url.hostname.replace(/^\[|\]$/g, "")) === 0) return { ok: false, error: "Use a full domain name, like example.com" };
  if (ownHost && url.host.toLowerCase() === ownHost.toLowerCase()) return { ok: false, error: "That's already a short link" };
  return { ok: true, url: url.href };
}
