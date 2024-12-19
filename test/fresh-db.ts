import { sql } from "kysely";
import { afterAll } from "vitest";

import { createDb, type Db } from "../src/db/index.js";

const url = process.env.TEST_DATABASE_URL;
let shared: Promise<Db> | undefined;

/**
 * An empty, migrated database for one test. By default that's a new
 * in-memory PGlite. With TEST_DATABASE_URL set (as in CI), it's a real
 * Postgres server, truncated between tests, so both paths run the same suite.
 */
export async function freshDb(): Promise<Db> {
  if (!url) return (await createDb(undefined)).db;
  shared ??= createDb(url).then((r) => r.db);
  const db = await shared;
  await sql`truncate table clicks, links restart identity cascade`.execute(db);
  return db;
}

afterAll(async () => {
  if (shared) await (await shared).destroy();
});
