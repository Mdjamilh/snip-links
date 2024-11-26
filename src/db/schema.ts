import type { ColumnType, Generated, Insertable, Selectable } from "kysely";

/** Table types for Kysely. Timestamps are stored as timestamptz. */
export interface Database {
  links: LinksTable;
  clicks: ClicksTable;
}

export interface LinksTable {
  slug: string;
  target_url: string;
  /** SHA-256 of the management token; the token itself is never stored. */
  token_hash: string;
  created_at: ColumnType<Date, Date | undefined, never>;
  expires_at: Date | null;
  /** Kept in step with the clicks table so link lists don't need a COUNT. */
  click_count: ColumnType<number, number | undefined, number>;
  disabled: ColumnType<boolean, boolean | undefined, boolean>;
}

export interface ClicksTable {
  id: Generated<string>;
  slug: string;
  at: ColumnType<Date, Date | undefined, never>;
  referrer_host: string | null;
  country: string | null;
  device: "desktop" | "mobile" | "tablet" | "other";
  browser: string;
}

export type Link = Selectable<LinksTable>;
export type NewLink = Insertable<LinksTable>;
export type NewClick = Insertable<ClicksTable>;
