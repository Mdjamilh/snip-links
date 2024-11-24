import type { PGlite } from "@electric-sql/pglite";
import {
  CompiledQuery,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type DatabaseConnection,
  type DatabaseIntrospector,
  type Dialect,
  type Driver,
  type Kysely,
  type QueryResult,
} from "kysely";

/**
 * Kysely dialect for PGlite (Postgres compiled to WebAssembly). It reuses
 * Kysely's Postgres SQL compiler, so queries behave the same as against a
 * real server: in tests, locally, and in the in-memory demo.
 */
export class PGliteDialect implements Dialect {
  readonly #db: PGlite;

  constructor(db: PGlite) {
    this.#db = db;
  }

  createAdapter() {
    return new PostgresAdapter();
  }

  createDriver(): Driver {
    return new PGliteDriver(this.#db);
  }

  createIntrospector(db: Kysely<unknown>): DatabaseIntrospector {
    return new PostgresIntrospector(db);
  }

  createQueryCompiler() {
    return new PostgresQueryCompiler();
  }
}

/**
 * PGlite is a single connection. A small lock hands it to one caller at a
 * time, so a transaction can't interleave with other queries.
 */
class PGliteDriver implements Driver {
  readonly #connection: PGliteConnection;
  #queue: Promise<void> = Promise.resolve();

  constructor(db: PGlite) {
    this.#connection = new PGliteConnection(db);
  }

  async init() {}

  async acquireConnection(): Promise<DatabaseConnection> {
    let release!: () => void;
    const previous = this.#queue;
    this.#queue = new Promise((resolve) => (release = resolve));
    await previous;
    this.#connection.release = release;
    return this.#connection;
  }

  async beginTransaction(connection: DatabaseConnection) {
    await connection.executeQuery(CompiledQuery.raw("begin"));
  }

  async commitTransaction(connection: DatabaseConnection) {
    await connection.executeQuery(CompiledQuery.raw("commit"));
  }

  async rollbackTransaction(connection: DatabaseConnection) {
    await connection.executeQuery(CompiledQuery.raw("rollback"));
  }

  async releaseConnection(connection: DatabaseConnection) {
    (connection as PGliteConnection).release?.();
  }

  async destroy() {}
}

class PGliteConnection implements DatabaseConnection {
  readonly #db: PGlite;
  release?: () => void;

  constructor(db: PGlite) {
    this.#db = db;
  }

  async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    const result = await this.#db.query<R>(query.sql, [...query.parameters]);
    return {
      rows: result.rows,
      ...(result.affectedRows !== undefined ? { numAffectedRows: BigInt(result.affectedRows) } : {}),
    };
  }

  // eslint-disable-next-line require-yield -- streaming isn't supported by PGlite
  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error("PGlite does not support streaming queries");
  }
}
