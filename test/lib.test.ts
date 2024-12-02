import { describe, expect, it } from "vitest";

import { RateLimiter } from "../src/lib/rate-limit.ts";
import { ALPHABET, checkCustomSlug, randomSlug } from "../src/lib/slug.ts";
import { checkTargetUrl } from "../src/lib/target-url.ts";
import { hashToken, newToken, tokenMatches } from "../src/lib/tokens.ts";
import { classifyVisitor, referrerHost } from "../src/lib/visitor.ts";

describe("slugs", () => {
  it("are random, the right length and free of look-alike characters", () => {
    const slugs = new Set(Array.from({ length: 2000 }, () => randomSlug()));
    expect(slugs.size).toBe(2000);
    for (const s of slugs) expect(s).toMatch(/^[2-9a-km-zA-HJ-NP-Z]{7}$/);
    expect(ALPHABET).not.toMatch(/[01lIO]/);
  });

  it("validates custom names", () => {
    expect(checkCustomSlug("spring-sale")).toBeNull();
    expect(checkCustomSlug("ab")).toMatch(/3 to 40/);
    expect(checkCustomSlug("has space")).toMatch(/letters, numbers/);
    expect(checkCustomSlug("-edge")).toMatch(/start or end/);
    expect(checkCustomSlug("API")).toBe('"API" is reserved');
    expect(checkCustomSlug("stats")).toMatch(/reserved/);
  });
});

describe("checkTargetUrl", () => {
  it("accepts and normalizes public http(s) links", () => {
    expect(checkTargetUrl(" https://example.com/a?b=1 ")).toEqual({ ok: true, url: "https://example.com/a?b=1" });
    expect(checkTargetUrl("example.com/page")).toEqual({ ok: true, url: "https://example.com/page" });
    expect(checkTargetUrl("http://8.8.8.8/dns")).toEqual({ ok: true, url: "http://8.8.8.8/dns" });
    expect(checkTargetUrl("https://münchen.de")).toEqual({ ok: true, url: "https://xn--mnchen-3ya.de/" });
  });

  it.each([
    ["", "Enter a URL"],
    ["javascript:alert(1)", "Only http and https"],
    ["data:text/html,<script>", "Only http and https"],
    ["ftp://files.example.com", "Only http and https"],
    ["https://bank.com@evil.example", "username or password"],
    ["http://localhost:3000", "private or local"],
    ["http://192.168.1.1/admin", "private or local"],
    ["http://10.0.0.5", "private or local"],
    ["http://[::1]/", "private or local"],
    ["https://printer.local", "private or local"],
    ["https://intranet", "full domain name"],
    ["not a url", "doesn't look like"],
    ["https://" + "a".repeat(2050) + ".com", "at most 2048"],
  ])("rejects %j", (input, message) => {
    const result = checkTargetUrl(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
  });

  it("refuses to shorten its own links", () => {
    expect(checkTargetUrl("https://snip.example/abc", "snip.example")).toEqual({ ok: false, error: "That's already a short link" });
  });
});

describe("classifyVisitor", () => {
  const ua = {
    chromeMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
    safariIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36 Edg/141.0",
    ipad: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    androidTablet: "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36",
    firefoxAndroid: "Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0",
    slackbot: "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    curl: "curl/8.7.1",
  };

  it("reads device and browser", () => {
    expect(classifyVisitor(ua.chromeMac)).toEqual({ bot: false, device: "desktop", browser: "Chrome" });
    expect(classifyVisitor(ua.safariIphone)).toEqual({ bot: false, device: "mobile", browser: "Safari" });
    expect(classifyVisitor(ua.edge)).toEqual({ bot: false, device: "desktop", browser: "Edge" });
    expect(classifyVisitor(ua.ipad)).toEqual({ bot: false, device: "tablet", browser: "Safari" });
    expect(classifyVisitor(ua.androidTablet)).toEqual({ bot: false, device: "tablet", browser: "Chrome" });
    expect(classifyVisitor(ua.firefoxAndroid)).toEqual({ bot: false, device: "mobile", browser: "Firefox" });
  });

  it("treats link previews, scripts and missing user agents as bots", () => {
    for (const bot of [ua.slackbot, ua.curl, "Googlebot/2.1", "facebookexternalhit/1.1", undefined, ""]) {
      expect(classifyVisitor(bot).bot).toBe(true);
    }
  });

  it("keeps only the referring host", () => {
    expect(referrerHost("https://www.news.ycombinator.com/item?id=123&user=me")).toBe("news.ycombinator.com");
    expect(referrerHost("https://snip.example/abc", "snip.example")).toBeNull();
    expect(referrerHost("garbage")).toBeNull();
    expect(referrerHost(undefined)).toBeNull();
  });
});

describe("management tokens", () => {
  it("are random, stored hashed, and compared safely", () => {
    const token = newToken();
    expect(token).toMatch(/^snip_[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(token);
    const hash = hashToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenMatches(token, hash)).toBe(true);
    expect(tokenMatches(newToken(), hash)).toBe(false);
    expect(tokenMatches(token, "not-hex")).toBe(false);
  });
});

describe("RateLimiter", () => {
  it("allows a burst, then refills, and reports when to retry", () => {
    let now = 0;
    const limiter = new RateLimiter({ capacity: 3, perMinute: 6, now: () => now });
    expect([1, 2, 3].map(() => limiter.take("ip").allowed)).toEqual([true, true, true]);
    expect(limiter.take("ip")).toEqual({ allowed: false, retryAfter: 10 });
    expect(limiter.take("other").allowed).toBe(true); // separate bucket
    now = 10_000;
    expect(limiter.take("ip").allowed).toBe(true);
  });

  it("forgets the least recently used clients when full", () => {
    const limiter = new RateLimiter({ capacity: 1, perMinute: 1, maxKeys: 2 });
    limiter.take("a");
    limiter.take("b");
    limiter.take("a"); // a is now most recent
    limiter.take("c"); // drops b
    expect(limiter.size).toBe(2);
    expect(limiter.take("b").allowed).toBe(true); // b starts fresh
  });
});
