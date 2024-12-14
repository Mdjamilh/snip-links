// Entry point for Vercel's Hono runtime: export the app as the default.
// Static files in public/ are served by Vercel's CDN.
import { createApp } from "./app.js";
import { createDb } from "./db/index.js";

const { db, persistent } = await createDb();

export default createApp({ db, persistent, ...(process.env.PUBLIC_URL ? { publicUrl: process.env.PUBLIC_URL } : {}) });
