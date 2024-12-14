import { sql } from "kysely";
import { describe, expect, it } from "vitest";

import { createDb } from "../src/db/index.js";

describe("database", () => {
  it("migrates an in-memory database and enforces the schema", async () => {
    const { db, persistent } = await createDb(undefined);
    expect(persistent).toBe(false);

    await db.insertInto("links").values({ slug: "abc", target_url: "https://example.com", token_hash: "h", expires_at: null }).execute();
    const link = await db.selectFrom("links").selectAll().where("slug", "=", "abc").executeTakeFirstOrThrow();
    expect(link).toMatchObject({ slug: "abc", click_count: 0, disabled: false });
    expect(link.created_at).toBeInstanceOf(Date);

    // Clicks need an existing link, and go away with it.
    await expect(db.insertInto("clicks").values({ slug: "nope", device: "desktop", browser: "Chrome", referrer_host: null, country: null }).execute()).rejects.toThrow();
    await db.insertInto("clicks").values({ slug: "abc", device: "mobile", browser: "Safari", referrer_host: null, country: "BD" }).execute();
    await db.deleteFrom("links").where("slug", "=", "abc").execute();
    const { count } = await db.selectFrom("clicks").select(sql<number>`count(*)::int`.as("count")).executeTakeFirstOrThrow();
    expect(count).toBe(0);
  });

  it("keeps transactions isolated and rolls back on error", async () => {
    const { db } = await createDb(undefined);
    await expect(
      db.transaction().execute(async (trx) => {
        await trx.insertInto("links").values({ slug: "tx", target_url: "https://a.com", token_hash: "h", expires_at: null }).execute();
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await db.selectFrom("links").selectAll().execute()).toEqual([]);

    // Concurrent queries wait for the single PGlite connection instead of interleaving.
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        db.transaction().execute((trx) => trx.insertInto("links").values({ slug: `s${i}`, target_url: "https://a.com", token_hash: "h", expires_at: null }).execute()),
      ),
    );
    const { n } = await db.selectFrom("links").select(sql<number>`count(*)::int`.as("n")).executeTakeFirstOrThrow();
    expect(n).toBe(20);
  });
});
