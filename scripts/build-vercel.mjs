// Builds the deployment with Vercel's Build Output API (version 3):
// one bundled Node function for the app, plus public/ as static files.
// https://vercel.com/docs/build-output-api/v3
import { cp, mkdir, rm, writeFile } from "node:fs/promises";

import { build } from "esbuild";

const out = ".vercel/output";
const fn = `${out}/functions/index.func`;

await rm(out, { recursive: true, force: true });
await mkdir(fn, { recursive: true });

await build({
  entryPoints: ["src/vercel.ts"],
  outfile: `${fn}/index.mjs`,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  jsx: "automatic",
  jsxImportSource: "hono/jsx",
  external: ["pg-native"],
  // Some dependencies call require(); give the ESM bundle one.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "info",
});

// PGlite loads its WebAssembly build from files next to its module.
for (const file of ["pglite.wasm", "pglite.data", "initdb.wasm"]) {
  await cp(`node_modules/@electric-sql/pglite/dist/${file}`, `${fn}/${file}`);
}

await writeFile(`${fn}/.vc-config.json`, JSON.stringify({ runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", shouldAddHelpers: false }, null, 2));
await cp("public", `${out}/static`, { recursive: true });
await writeFile(
  `${out}/config.json`,
  JSON.stringify({ version: 3, routes: [{ handle: "filesystem" }, { src: "/(.*)", dest: "/index" }] }, null, 2),
);
console.log("Wrote", out);
