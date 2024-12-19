import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.{ts,tsx}"],
    testTimeout: 20_000,
    // A shared Postgres database (TEST_DATABASE_URL) can't be truncated by
    // several test files at once; in-memory PGlite runs files in parallel.
    fileParallelism: !process.env.TEST_DATABASE_URL,
  },
});
