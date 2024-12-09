import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";

import { createApp } from "./app.tsx";
import { createDb } from "./db/index.ts";

const port = Number(process.env.PORT ?? 3000);
const { db, persistent } = await createDb();

const server = new Hono();
server.use("/static/*", serveStatic({ root: "./public" }));
server.route("/", createApp({ db, persistent, ...(process.env.PUBLIC_URL ? { publicUrl: process.env.PUBLIC_URL } : {}) }));

serve({ fetch: server.fetch, port }, (info) => {
  console.log(`snip on http://localhost:${info.port} (${persistent ? "Postgres" : "in-memory database"})`);
});
