// Entry point for Vercel's Hono runtime, which looks for a file that imports
// hono and exports the app. Static files in public/ are served by Vercel's CDN.
import { Hono } from "hono";

import { createApp } from "./app.js";
import { createDb } from "./db/index.js";

const { db, persistent } = await createDb();

const app = new Hono();
app.route("/", createApp({ db, persistent, ...(process.env.PUBLIC_URL ? { publicUrl: process.env.PUBLIC_URL } : {}) }));

export default app;
