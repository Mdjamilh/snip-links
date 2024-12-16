// Vercel function entry, bundled by scripts/build-vercel.mjs. It adapts the
// Hono app to a Node request listener; static files are served by the CDN.
import { getRequestListener } from "@hono/node-server";

import { createApp } from "./app.js";
import { createDb } from "./db/index.js";

const { db, persistent } = await createDb();
const app = createApp({ db, persistent, ...(process.env.PUBLIC_URL ? { publicUrl: process.env.PUBLIC_URL } : {}) });

export default getRequestListener(app.fetch);
