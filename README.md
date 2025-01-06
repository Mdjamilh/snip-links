# snip

A link shortener that doesn't need an account and doesn't track people. Shorten a link and you get two things: the short link, and a private stats link. The stats link shows clicks per day, referring sites, countries, devices and browsers, and lets you turn the short link off or delete it.

**Live demo:** https://snip-links.vercel.app

![Stats for a short link: five clicks, referrers, countries, devices and browsers](docs/stats.png)

> The demo keeps links in memory, so they may vanish when it restarts. Point `DATABASE_URL` at Postgres for real use; see [Self-hosting](#self-hosting).

## Features

- Random short names like `snip.example/7hKq2pX`, or a custom name such as `/spring-sale`
- Links that expire after an hour, a day, a week or a month
- A QR code for every link
- Add `+` to any short link (`/my-page+`) to see where it goes before visiting
- Click stats: daily chart, referrers, countries, devices and browsers. Link previews (Slack, iMessage, social networks) and bots are not counted.
- Download every click as CSV (cells starting with `=`, `+`, `-` or `@` are defused so spreadsheets don't run them as formulas)
- No accounts: each link has a private management token instead
- Works without JavaScript; htmx makes it faster when JavaScript is available
- A JSON API for everything the web page does

![Creating a short link: the result shows the link, a QR code and the private stats link](docs/create.png)

## API

```bash
# Create a link (slug and expiresAt are optional)
curl -X POST https://snip-links.vercel.app/api/links \
  -H 'content-type: application/json' \
  -d '{"url": "https://example.com/a/long/page", "slug": "my-page", "expiresAt": "2026-12-31T23:59:59Z"}'
```

```json
{
  "slug": "my-page",
  "shortUrl": "https://snip-links.vercel.app/my-page",
  "targetUrl": "https://example.com/a/long/page",
  "expiresAt": "2026-12-31T23:59:59.000Z",
  "manageToken": "snip_…",
  "statsUrl": "https://snip-links.vercel.app/manage/my-page?token=snip_…",
  "qrUrl": "https://snip-links.vercel.app/qr/my-page.svg"
}
```

The full API is described in [OpenAPI 3.1](https://snip-links.vercel.app/api/openapi.json), which validates cleanly with Redocly. The management token is returned once. Send it as a bearer token to manage the link:

| Request | Does |
|---|---|
| `GET /api/links/:slug?days=30` | Stats for the last *n* days (1–365) |
| `PATCH /api/links/:slug` with `{"disabled": true}` | Turns the link off (visitors get 410 Gone), or back on |
| `DELETE /api/links/:slug` | Deletes the link and its stats |

Errors have a stable `error` code and a readable `message`: `invalid_url` (422), `invalid_slug` (409 if taken), `rate_limited` (429, with `Retry-After`). Without a valid token the answer is always 404, so nobody can probe which links exist.

## Privacy and security

**What a click records:** the time, the referring site's domain (never the full URL, which can contain personal data), the country from the hosting platform's geolocation header, and the device type and browser. IP addresses and full user agents are not stored, and no cookies are set.

**Management tokens** are 256-bit random values. Only their SHA-256 hash is stored, so a copy of the database doesn't give control of anyone's links. They're compared in constant time. Pages that carry a token in the URL are sent with `Referrer-Policy: no-referrer` and `Cache-Control: no-store`, so the token doesn't leak to other sites or caches.

**Unsafe destinations are refused:**
- anything that isn't http or https (`javascript:` and `data:` links are a classic shortener abuse)
- URLs with a username or password in them (`https://bank.com@evil.example` really goes to evil.example)
- localhost and private network addresses
- links to the shortener itself, which would loop

**Pages** are rendered on the server and served with a strict Content Security Policy: `default-src 'self'`, no inline scripts or styles, and no framing. htmx is vendored, so pages load nothing from third parties.

**Link creation is rate-limited** per client (a token bucket with bounded memory), and returns `Retry-After` when the limit is hit.

## How it's built

- **[Hono](https://hono.dev)** handles routing. Pages are rendered as JSX on the server, and [htmx](https://htmx.org) swaps in form results without a full page reload.
- **[Kysely](https://kysely.dev)**, a type-safe SQL query builder, talks to the database. Migrations live in code and run at startup.
- **Postgres** in production. When `DATABASE_URL` isn't set, the app uses **[PGlite](https://pglite.dev)**, Postgres compiled to WebAssembly and running in memory. Kysely has no PGlite driver, so this repo includes a small one (`src/db/pglite-dialect.ts`). It reuses Kysely's Postgres SQL compiler, and a lock gives each transaction exclusive use of PGlite's single connection.
- **Clicks and counters stay consistent.** A click and its link's counter are written in one transaction, and a failed write never blocks the redirect.
- **Slugs** use 55 characters without look-alikes (no 0/O, 1/l/I). They're drawn without modulo bias, and an insert that hits a taken slug retries instead of throwing.

### Deploying to Vercel

Vercel's Hono preset doesn't compile `.tsx` files, so `scripts/build-vercel.mjs` uses the [Build Output API](https://vercel.com/docs/build-output-api/v3) instead. It bundles the server with esbuild into one Node function, copies PGlite's WebAssembly files next to it, and publishes `public/` as static files.

## Tests

```bash
npm install
npm test                                              # 50 tests on in-memory PGlite
TEST_DATABASE_URL=postgres://… npm test               # the same tests on real Postgres
npm run test:e2e                                      # browser tests, with and without JavaScript
```

The tests cover:
- **URL safety:** slugs and dangerous destinations.
- **Analytics:** bot and device detection, and daily stats that include days with zero clicks.
- **Concurrency:** concurrent clicks and transactions on PGlite's single connection.
- **Every HTTP flow:** the API, redirects, expiry, the form with and without htmx, owner actions, rate limits, and the security headers.

The browser tests run every flow twice: with JavaScript (htmx) and with JavaScript turned off, which proves the plain HTML forms work on their own. They also run an axe accessibility scan, which caught light-theme orange that was too faint for WCAG AA contrast.

CI runs the unit suite twice, on PGlite and on Postgres 17, plus the browser tests. It also builds the Vercel bundle, runs `npm audit`, and starts the Docker Compose stack to check a real redirect against Postgres.

## Self-hosting

```bash
docker compose up -d     # app on http://localhost:3000 with Postgres
```

Or run it with Node 22:

```bash
npm install
DATABASE_URL=postgres://user:pass@host/db npm start
```

Set `PUBLIC_URL` (for example `https://snip.example.com`) if the app sits behind a proxy that doesn't send `X-Forwarded-Host`.

## License

[MIT](LICENSE)
