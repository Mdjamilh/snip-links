import { beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { freshDb } from "./fresh-db.js";
import { RateLimiter } from "../src/lib/rate-limit.js";
import type { Stats } from "../src/links.js";

const ORIGIN = "https://snip.test";
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36";

let app: ReturnType<typeof createApp>;
let now: Date;

beforeEach(async () => {
  const db = await freshDb();
  now = new Date("2026-05-10T12:00:00Z");
  app = createApp({ db, persistent: false, publicUrl: ORIGIN, now: () => now, createLimit: new RateLimiter({ capacity: 100, perMinute: 100 }) });
});

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

async function create(body: Record<string, unknown>) {
  const res = await app.request("/api/links", json(body));
  return { res, data: (await res.json()) as Record<string, string> };
}

describe("API", () => {
  it("creates a link and returns the token and URLs once", async () => {
    const { res, data } = await create({ url: "https://example.com/docs", slug: "docs" });
    expect(res.status).toBe(201);
    expect(data).toMatchObject({ slug: "docs", shortUrl: "https://snip.test/docs", targetUrl: "https://example.com/docs", qrUrl: "https://snip.test/qr/docs.svg" });
    expect(data.manageToken).toMatch(/^snip_/);
    expect(data.statsUrl).toBe(`https://snip.test/manage/docs?token=${encodeURIComponent(data.manageToken ?? "")}`);
  });

  it("explains bad requests with the right status", async () => {
    expect((await app.request("/api/links", { method: "POST", body: "not json" })).status).toBe(400);
    expect((await create({ url: "javascript:alert(1)" })).res.status).toBe(422);
    await create({ url: "https://a.com", slug: "dupe" });
    const taken = await create({ url: "https://b.com", slug: "dupe" });
    expect(taken.res.status).toBe(409);
    expect(taken.data.message).toBe('"dupe" is already taken');
    expect((await create({ url: "https://a.com", expiresAt: "tomorrow" })).res.status).toBe(400);
  });

  it("only shows stats, disables and deletes with the link's token", async () => {
    const { data } = await create({ url: "https://a.com", slug: "mine" });
    const auth = { authorization: `Bearer ${data.manageToken}` };

    expect((await app.request("/api/links/mine")).status).toBe(404);
    expect((await app.request("/api/links/mine", { headers: { authorization: "Bearer snip_wrong" } })).status).toBe(404);

    const stats = (await (await app.request("/api/links/mine?days=7", { headers: auth })).json()) as Stats;
    expect(stats).toMatchObject({ slug: "mine", totalClicks: 0 });
    expect(stats.days).toHaveLength(7);

    const off = await app.request("/api/links/mine", { method: "PATCH", headers: { ...auth, "content-type": "application/json" }, body: '{"disabled":true}' });
    expect(await off.json()).toEqual({ slug: "mine", disabled: true });
    expect((await app.request("/mine")).status).toBe(410);

    expect((await app.request("/api/links/mine", { method: "DELETE", headers: auth })).status).toBe(204);
    expect((await app.request("/mine")).status).toBe(404);
  });

  it("builds short links from forwarded headers when no public URL is configured", async () => {
    const db = await freshDb();
    const proxied = createApp({ db, persistent: false });
    const res = await proxied.request("http://internal:3000/api/links", json({ url: "https://a.com", slug: "via-proxy" }, { "x-forwarded-proto": "https", "x-forwarded-host": "snip.example.org" }));
    expect(((await res.json()) as Record<string, string>).shortUrl).toBe("https://snip.example.org/via-proxy");
  });

  it("rate limits link creation per client", async () => {
    const db = await freshDb();
    const limited = createApp({ db, persistent: false, publicUrl: ORIGIN, createLimit: new RateLimiter({ capacity: 2, perMinute: 1 }) });
    const post = (ip: string) => limited.request("/api/links", json({ url: "https://a.com" }, { "x-forwarded-for": `${ip}, 10.0.0.1` }));
    expect((await post("1.1.1.1")).status).toBe(201);
    expect((await post("1.1.1.1")).status).toBe(201);
    const blocked = await post("1.1.1.1");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");
    expect((await post("2.2.2.2")).status).toBe(201);
  });
});

describe("redirects and clicks", () => {
  it("redirects, counts real visits, and ignores bots and HEAD requests", async () => {
    const { data } = await create({ url: "https://example.com/landing", slug: "go-now" });

    const res = await app.request("/go-now", { headers: { "user-agent": CHROME, referer: "https://www.news.example/story?id=1", "x-vercel-ip-country": "BD" } });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com/landing");
    expect(res.headers.get("cache-control")).toBe("private, no-store");

    await app.request("/go-now", { headers: { "user-agent": "Slackbot-LinkExpanding 1.0" } });
    await app.request("/go-now", { method: "HEAD", headers: { "user-agent": CHROME } });
    await app.request("/go-now", { headers: { "user-agent": CHROME, referer: `${ORIGIN}/manage/go-now` } });

    const stats = (await (await app.request("/api/links/go-now", { headers: { authorization: `Bearer ${data.manageToken}` } })).json()) as Stats;
    expect(stats.totalClicks).toBe(2);
    expect(stats.referrers).toEqual([
      { label: "Direct or unknown", clicks: 1 }, // own site isn't a referrer
      { label: "news.example", clicks: 1 },
    ]);
    expect(stats.countries).toContainEqual({ label: "BD", clicks: 1 });
    expect(stats.browsers).toEqual([{ label: "Chrome", clicks: 2 }]);
  });

  it("shows friendly pages for missing and expired links", async () => {
    await create({ url: "https://a.com", slug: "soon", expiresAt: "2026-05-10T13:00:00Z" });
    expect((await app.request("/soon")).status).toBe(302);
    now = new Date("2026-05-10T13:00:01Z");
    const expired = await app.request("/soon");
    expect(expired.status).toBe(410);
    expect(await expired.text()).toContain("This link has expired.");

    const missing = await app.request("/nope123");
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("This link doesn&#39;t exist");
  });

  it("serves QR codes only for existing links", async () => {
    await create({ url: "https://a.com", slug: "qrme" });
    const qr = await app.request("/qr/qrme.svg");
    expect(qr.headers.get("content-type")).toBe("image/svg+xml");
    expect(await qr.text()).toMatch(/^<svg/);
    expect((await app.request("/qr/nope.svg")).status).toBe(404);
  });
});

describe("web pages", () => {
  const form = (fields: Record<string, string>, htmx = true) => ({
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...(htmx ? { "hx-request": "true" } : {}) },
    body: new URLSearchParams(fields).toString(),
  });

  it("creates links from the form, as an htmx fragment or a full page", async () => {
    const htmx = await app.request("/new", form({ url: "example.com", slug: "", expires: "7d" }));
    expect(htmx.status).toBe(201);
    const fragment = await htmx.text();
    expect(fragment).not.toContain("<html");
    expect(fragment).toContain("Save your private stats link");
    expect(fragment).toMatch(/https:\/\/snip\.test\/manage\/[2-9a-zA-Z]{7}\?token=snip_/);
    expect(fragment).toContain("Expires Sun, 17 May 2026 12:00:00 GMT");

    const plain = await app.request("/new", form({ url: "https://a.com", slug: "plain" }, false));
    expect(plain.status).toBe(201);
    expect(await plain.text()).toContain("<html");
  });

  it("re-renders the form with errors and keeps what was typed", async () => {
    const res = await app.request("/new", form({ url: "ftp://files.example", slug: "my-link" }));
    expect(res.status).toBe(200); // htmx only swaps 2xx
    const html = await res.text();
    expect(html).toContain("Only http and https links can be shortened");
    expect(html).toContain('value="my-link"');
    expect(html).toContain('aria-invalid="true"');

    const plain = await app.request("/new", form({ url: "", slug: "" }, false));
    expect(plain.status).toBe(422);
  });

  it("shows private stats and lets the owner turn the link off and delete it", async () => {
    const { data } = await create({ url: "https://a.com", slug: "owned" });
    const token = encodeURIComponent(data.manageToken ?? "");

    const stats = await app.request(`/manage/owned?token=${token}`);
    expect(stats.status).toBe(200);
    expect(stats.headers.get("cache-control")).toBe("no-store");
    expect(stats.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await stats.text()).toContain("All clicks");
    expect((await app.request("/manage/owned?token=snip_nope")).status).toBe(404);

    const toggle = await app.request("/manage/owned/toggle", form({ token: data.manageToken ?? "" }, false));
    expect(toggle.status).toBe(303);
    expect(toggle.headers.get("location")).toBe(`/manage/owned?token=${token}`);
    expect((await app.request("/owned")).status).toBe(410);

    expect((await app.request("/manage/owned/delete", form({ token: "wrong" }, false))).status).toBe(404);
    const deleted = await app.request("/manage/owned/delete", form({ token: data.manageToken ?? "" }, false));
    expect(await deleted.text()).toContain("Link deleted");
    expect((await app.request("/owned")).status).toBe(404);
  });

  it("sends a strict content security policy", async () => {
    const res = await app.request("/");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-inline");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(await res.text()).toContain("Demo instance");
  });
});
