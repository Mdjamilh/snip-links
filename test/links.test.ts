import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDb, type Db } from "../src/db/index.js";
import * as slugs from "../src/lib/slug.js";
import { authorize, createLink, deleteLink, getStats, recordClick, resolveLink, setDisabled } from "../src/links.js";

let db: Db;
beforeEach(async () => {
  ({ db } = await createDb(undefined));
});

const click = (over: Partial<Parameters<typeof recordClick>[2]> = {}) => ({ referrerHost: null, country: null, device: "desktop" as const, browser: "Chrome", ...over });

describe("createLink", () => {
  it("creates a link with a random slug and a one-time token", async () => {
    const result = await createLink(db, { url: "example.com/docs" });
    if (!result.ok) throw new Error(result.error);
    expect(result.link.slug).toMatch(/^[2-9a-zA-Z]{7}$/);
    expect(result.link.target_url).toBe("https://example.com/docs");
    expect(result.token).toMatch(/^snip_/);
    expect(result.link.token_hash).not.toContain(result.token);
  });

  it("honours custom slugs and reports when one is taken", async () => {
    expect((await createLink(db, { url: "https://a.com", slug: "launch" })).ok).toBe(true);
    expect(await createLink(db, { url: "https://b.com", slug: "launch" })).toEqual({ ok: false, error: '"launch" is already taken', field: "slug" });
    expect(await createLink(db, { url: "https://b.com", slug: "api" })).toMatchObject({ ok: false, field: "slug" });
  });

  it("retries when a random slug collides", async () => {
    await createLink(db, { url: "https://a.com", slug: "taken12" });
    const spy = vi.spyOn(slugs, "randomSlug").mockReturnValueOnce("taken12").mockReturnValueOnce("fresh34");
    const result = await createLink(db, { url: "https://b.com" });
    expect(result.ok && result.link.slug).toBe("fresh34");
    spy.mockRestore();
  });

  it("validates the destination and the expiry", async () => {
    expect(await createLink(db, { url: "javascript:alert(1)" })).toMatchObject({ ok: false, field: "url" });
    expect(await createLink(db, { url: "https://snip.test/x" }, { ownHost: "snip.test" })).toMatchObject({ ok: false, error: "That's already a short link" });
    const now = new Date("2026-05-01T00:00:00Z");
    expect(await createLink(db, { url: "https://a.com", expiresAt: new Date("2026-04-30T00:00:00Z") }, { now })).toMatchObject({ ok: false, field: "expiresAt" });
  });
});

describe("resolveLink", () => {
  it("knows found, missing, expired and disabled links", async () => {
    const now = new Date("2026-05-01T12:00:00Z");
    const ok = await createLink(db, { url: "https://a.com", slug: "live" }, { now });
    await createLink(db, { url: "https://a.com", slug: "brief", expiresAt: new Date("2026-05-01T13:00:00Z") }, { now });
    expect(ok.ok).toBe(true);

    expect(await resolveLink(db, "live", now)).toEqual({ status: "ok", url: "https://a.com/" });
    expect(await resolveLink(db, "nothing", now)).toEqual({ status: "not_found" });
    expect(await resolveLink(db, "brief", now)).toMatchObject({ status: "ok" });
    expect(await resolveLink(db, "brief", new Date("2026-05-01T13:00:00Z"))).toEqual({ status: "expired" }); // exactly at expiry
    await setDisabled(db, "live", true);
    expect(await resolveLink(db, "live", now)).toEqual({ status: "disabled" });
  });
});

describe("authorize", () => {
  it("only accepts the link's own token", async () => {
    const a = await createLink(db, { url: "https://a.com", slug: "aaa" });
    const b = await createLink(db, { url: "https://b.com", slug: "bbb" });
    if (!a.ok || !b.ok) throw new Error("setup");
    expect((await authorize(db, "aaa", a.token))?.slug).toBe("aaa");
    expect(await authorize(db, "aaa", b.token)).toBeUndefined();
    expect(await authorize(db, "aaa", undefined)).toBeUndefined();
    expect(await authorize(db, "missing", a.token)).toBeUndefined();
  });
});

describe("stats", () => {
  it("counts clicks per day with zero days filled in, and breaks them down", async () => {
    const created = await createLink(db, { url: "https://a.com", slug: "promo" });
    if (!created.ok) throw new Error("setup");
    const at = (iso: string) => new Date(iso);
    await recordClick(db, "promo", click({ at: at("2026-05-01T09:00:00Z"), referrerHost: "news.example", country: "BD", device: "mobile", browser: "Safari" }));
    await recordClick(db, "promo", click({ at: at("2026-05-01T23:30:00Z"), referrerHost: "news.example", country: "US" }));
    await recordClick(db, "promo", click({ at: at("2026-05-03T10:00:00Z"), country: "BD", device: "mobile" }));
    await recordClick(db, "promo", click({ at: at("2026-03-01T10:00:00Z") })); // outside the window

    const link = await authorize(db, "promo", created.token);
    if (!link) throw new Error("token should authorize");
    const stats = await getStats(db, link, { days: 7, now: at("2026-05-04T08:00:00Z") });

    expect(stats.totalClicks).toBe(4); // all time
    expect(stats.lastClickAt).toEqual(at("2026-05-03T10:00:00Z"));
    expect(stats.days).toEqual([
      { date: "2026-04-28", clicks: 0 },
      { date: "2026-04-29", clicks: 0 },
      { date: "2026-04-30", clicks: 0 },
      { date: "2026-05-01", clicks: 2 },
      { date: "2026-05-02", clicks: 0 },
      { date: "2026-05-03", clicks: 1 },
      { date: "2026-05-04", clicks: 0 },
    ]);
    expect(stats.referrers).toEqual([
      { label: "news.example", clicks: 2 },
      { label: "Direct or unknown", clicks: 1 },
    ]);
    expect(stats.countries).toEqual([
      { label: "BD", clicks: 2 },
      { label: "US", clicks: 1 },
    ]);
    expect(stats.devices).toEqual([
      { label: "mobile", clicks: 2 },
      { label: "desktop", clicks: 1 },
    ]);
  });

  it("keeps the counter in step with the clicks table under concurrent clicks", async () => {
    await createLink(db, { url: "https://a.com", slug: "busy" });
    await Promise.all(Array.from({ length: 25 }, () => recordClick(db, "busy", click())));
    const link = await db.selectFrom("links").select("click_count").where("slug", "=", "busy").executeTakeFirstOrThrow();
    expect(link.click_count).toBe(25);
  });

  it("deleting a link removes its clicks", async () => {
    await createLink(db, { url: "https://a.com", slug: "gone" });
    await recordClick(db, "gone", click());
    await deleteLink(db, "gone");
    expect(await resolveLink(db, "gone")).toEqual({ status: "not_found" });
    expect(await db.selectFrom("clicks").selectAll().execute()).toEqual([]);
  });
});
