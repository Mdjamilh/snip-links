import { PGlite } from "@electric-sql/pglite";
import { Kysely, PostgresDialect, sql } from "kysely";
import { Migrator, type Migration, type MigrationProvider } from "kysely/migration";
import pg from "pg";

import { PGliteDialect } from "./pglite-dialect.ts";
import type { Database } from "./schema.ts";

/** Migrations live in code, so the app can migrate itself on start. */
const migrations: Record<string, Migration> = {
  "001_links_and_clicks": {
    async up(db) {
      await db.schema
        .createTable("links")
        .addColumn("slug", "text", (c) => c.primaryKey())
        .addColumn("target_url", "text", (c) => c.notNull())
        .addColumn("token_hash", "text", (c) => c.notNull())
        .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
        .addColumn("expires_at", "timestamptz")
        .addColumn("click_count", "integer", (c) => c.notNull().defaultTo(0))
        .addColumn("disabled", "boolean", (c) => c.notNull().defaultTo(false))
        .execute();

      await db.schema
        .createTable("clicks")
        .addColumn("id", "bigserial", (c) => c.primaryKey())
        .addColumn("slug", "text", (c) => c.notNull().references("links.slug").onDelete("cascade"))
        .addColumn("at", "timestamptz", (c) => c.notNull().defaultTo(sql`now()`))
        .addColumn("referrer_host", "text")
        .addColumn("country", "text")
        .addColumn("device", "text", (c) => c.notNull())
        .addColumn("browser", "text", (c) => c.notNull())
        .execute();

      // Stats read one link's clicks over a time window.
      await db.schema.createIndex("clicks_slug_at").on("clicks").columns(["slug", "at"]).execute();
    },
  },
};

const provider: MigrationProvider = { getMigrations: async () => migrations };

export async function migrate(db: Kysely<Database>): Promise<void> {
  const { error, results } = await new Migrator({ db, provider }).migrateToLatest();
  for (const r of results ?? []) {
    if (r.status === "Error") throw new Error(`Migration ${r.migrationName} failed`);
  }
  if (error) throw error;
}

export type Db = Kysely<Database>;

/**
 * Postgres when DATABASE_URL is set; otherwise an in-memory PGlite database,
 * which is what the tests and the public demo use.
 */
export async function createDb(databaseUrl = process.env.DATABASE_URL): Promise<{ db: Db; persistent: boolean }> {
  const dialect = databaseUrl
    ? new PostgresDialect({ pool: new pg.Pool({ connectionString: databaseUrl, max: 5 }) })
    : new PGliteDialect(new PGlite());
  const db = new Kysely<Database>({ dialect });
  await migrate(db);
  return { db, persistent: Boolean(databaseUrl) };
}
