import { sql, type RawBuilder } from "kysely";

import type { Db } from "./db/index.js";
import type { Link } from "./db/schema.js";
import { checkCustomSlug, randomSlug } from "./lib/slug.js";
import { checkTargetUrl } from "./lib/target-url.js";
import { hashToken, newToken, tokenMatches } from "./lib/tokens.js";
import type { Device } from "./lib/visitor.js";

export type CreateInput = { url: string; slug?: string; expiresAt?: Date };
export type CreateResult = { ok: true; link: Link; token: string } | { ok: false; error: string; field: "url" | "slug" | "expiresAt" };

const MAX_SLUG_ATTEMPTS = 5;

/**
 * Creates a link and returns its management token. The token is shown once
 * and only its hash is stored.
 */
export async function createLink(db: Db, input: CreateInput, { ownHost, now = new Date() }: { ownHost?: string; now?: Date } = {}): Promise<CreateResult> {
  const target = checkTargetUrl(input.url, ownHost);
  if (!target.ok) return { ok: false, error: target.error, field: "url" };
  if (input.expiresAt && input.expiresAt <= now) return { ok: false, error: "The expiry must be in the future", field: "expiresAt" };
  if (input.slug !== undefined) {
    const problem = checkCustomSlug(input.slug);
    if (problem) return { ok: false, error: problem, field: "slug" };
  }

  const token = newToken();
  const base = { target_url: target.url, token_hash: hashToken(token), expires_at: input.expiresAt ?? null };

  // ON CONFLICT DO NOTHING tells us about a taken slug without an exception,
  // and works the same under concurrency as in a single request.
  for (let attempt = 0; attempt < (input.slug ? 1 : MAX_SLUG_ATTEMPTS); attempt++) {
    const slug = input.slug ?? randomSlug();
    const link = await db
      .insertInto("links")
      .values({ ...base, slug })
      .onConflict((oc) => oc.column("slug").doNothing())
      .returningAll()
      .executeTakeFirst();
    if (link) return { ok: true, link, token };
  }
  return input.slug
    ? { ok: false, error: `"${input.slug}" is already taken`, field: "slug" }
    : { ok: false, error: "Couldn't find a free short name; please try again", field: "slug" };
}

export type Resolution = { status: "ok"; url: string } | { status: "not_found" | "expired" | "disabled" };

export async function resolveLink(db: Db, slug: string, now = new Date()): Promise<Resolution> {
  const link = await db.selectFrom("links").select(["target_url", "expires_at", "disabled"]).where("slug", "=", slug).executeTakeFirst();
  if (!link) return { status: "not_found" };
  if (link.disabled) return { status: "disabled" };
  if (link.expires_at && link.expires_at <= now) return { status: "expired" };
  return { status: "ok", url: link.target_url };
}

export type ClickInput = { referrerHost: string | null; country: string | null; device: Device; browser: string; at?: Date };

/** Stores a click and bumps the counter together, so they never disagree. */
export async function recordClick(db: Db, slug: string, click: ClickInput): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto("clicks")
      .values({ slug, referrer_host: click.referrerHost, country: click.country, device: click.device, browser: click.browser, ...(click.at ? { at: click.at } : {}) })
      .execute();
    await trx
      .updateTable("links")
      .set({ click_count: sql`click_count + 1` })
      .where("slug", "=", slug)
      .execute();
  });
}

/** Loads a link if the token is its management token. */
export async function authorize(db: Db, slug: string, token: string | undefined): Promise<Link | undefined> {
  if (!token) return undefined;
  const link = await db.selectFrom("links").selectAll().where("slug", "=", slug).executeTakeFirst();
  return link && tokenMatches(token, link.token_hash) ? link : undefined;
}

export async function setDisabled(db: Db, slug: string, disabled: boolean): Promise<void> {
  await db.updateTable("links").set({ disabled }).where("slug", "=", slug).execute();
}

export async function deleteLink(db: Db, slug: string): Promise<void> {
  await db.deleteFrom("links").where("slug", "=", slug).execute();
}

/** Every recorded click for a link, oldest first, for export. */
export function listClicks(db: Db, slug: string) {
  return db.selectFrom("clicks").select(["at", "referrer_host", "country", "device", "browser"]).where("slug", "=", slug).orderBy("at").orderBy("id").execute();
}

/** RFC 4180 CSV. Values that spreadsheets would run as formulas get a leading apostrophe. */
export function toCsv(rows: string[][]): string {
  const cell = (v: string) => {
    const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export type Count = { label: string; clicks: number };
export type Stats = {
  slug: string;
  targetUrl: string;
  createdAt: Date;
  expiresAt: Date | null;
  disabled: boolean;
  totalClicks: number;
  lastClickAt: Date | null;
  days: { date: string; clicks: number }[];
  referrers: Count[];
  countries: Count[];
  devices: Count[];
  browsers: Count[];
};

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Clicks over the last `days` days (UTC), with every day present, plus top breakdowns. */
export async function getStats(db: Db, link: Link, { days = 30, now = new Date() } = {}): Promise<Stats> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)));

  const [daily, last, referrers, countries, devices, browsers] = await Promise.all([
    db
      .selectFrom("clicks")
      .where("slug", "=", link.slug)
      .where("at", ">=", start)
      .select([sql<string>`to_char(date_trunc('day', at at time zone 'UTC'), 'YYYY-MM-DD')`.as("day"), sql<number>`count(*)::int`.as("clicks")])
      .groupBy("day")
      .execute(),
    db.selectFrom("clicks").select(sql<Date | null>`max(at)`.as("last")).where("slug", "=", link.slug).executeTakeFirst(),
    breakdown(db, link.slug, start, sql<string>`coalesce(referrer_host, 'Direct or unknown')`),
    breakdown(db, link.slug, start, sql<string>`coalesce(country, 'Unknown')`),
    breakdown(db, link.slug, start, sql<string>`device`),
    breakdown(db, link.slug, start, sql<string>`browser`),
  ]);

  const byDay = new Map(daily.map((d) => [d.day, d.clicks]));
  const series = Array.from({ length: days }, (_, i) => {
    const date = isoDay(new Date(start.getTime() + i * 86_400_000));
    return { date, clicks: byDay.get(date) ?? 0 };
  });

  return {
    slug: link.slug,
    targetUrl: link.target_url,
    createdAt: link.created_at,
    expiresAt: link.expires_at,
    disabled: link.disabled,
    totalClicks: link.click_count,
    lastClickAt: last?.last ? new Date(last.last) : null,
    days: series,
    referrers,
    countries,
    devices,
    browsers,
  };
}

/** The most common values of one click attribute in the window, with counts. */
function breakdown(db: Db, slug: string, start: Date, label: RawBuilder<string>, limit = 8): Promise<Count[]> {
  return db
    .selectFrom("clicks")
    .select([label.as("label"), sql<number>`count(*)::int`.as("clicks")])
    .where("slug", "=", slug)
    .where("at", ">=", start)
    .groupBy(sql`1`)
    .orderBy("clicks", "desc")
    .orderBy("label")
    .limit(limit)
    .execute();
}
