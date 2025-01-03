import { Hono, type Context } from "hono";
import { secureHeaders } from "hono/secure-headers";
import QRCode from "qrcode";
import { z } from "zod";

import type { Db } from "./db/index.js";
import { RateLimiter } from "./lib/rate-limit.js";
import { classifyVisitor, referrerHost } from "./lib/visitor.js";
import { authorize, createLink, deleteLink, getStats, listClicks, recordClick, resolveLink, setDisabled, toCsv } from "./links.js";
import { openApiSpec } from "./openapi.js";
import { CreateForm, HomePage, Result, type FormErrors } from "./views/home.js";
import { Layout } from "./views/layout.js";
import { ManagePage, MessagePage, PreviewPage } from "./views/manage.js";

export type AppOptions = {
  db: Db;
  /** false when running on the in-memory database; shows a banner. */
  persistent: boolean;
  /** Public origin such as https://snip.example; derived from the request when unset. */
  publicUrl?: string;
  createLimit?: RateLimiter;
  now?: () => Date;
};

const EXPIRY_MS: Record<string, number> = { "1h": 3_600_000, "1d": 86_400_000, "7d": 7 * 86_400_000, "30d": 30 * 86_400_000 };

const createBody = z.object({
  url: z.string().max(4096),
  slug: z.string().trim().max(100).optional(),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
});

export function createApp({ db, persistent, publicUrl, createLimit, now = () => new Date() }: AppOptions) {
  const app = new Hono();
  // Creating links is the only expensive or abusable action.
  const limiter = createLimit ?? new RateLimiter({ capacity: 10, perMinute: 20 });

  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        objectSrc: ["'none'"],
      },
      xFrameOptions: "DENY", // matches frame-ancestors 'none'
      // Stats pages carry the management token in the URL; never leak it.
      referrerPolicy: "no-referrer",
    }),
  );

  // Behind a proxy (Vercel, a load balancer) the request URL can be plain http
  // on an internal host; the forwarded headers carry what the visitor used.
  const origin = (c: Context) => {
    if (publicUrl) return publicUrl.replace(/\/$/, "");
    const url = new URL(c.req.url);
    const proto = c.req.header("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
    const forwardedHost = c.req.header("x-forwarded-host")?.split(",")[0]?.trim() || url.host;
    return `${proto}://${forwardedHost}`;
  };
  const host = (c: Context) => new URL(origin(c)).host;

  // Behind Vercel or another proxy, the client is the first X-Forwarded-For entry.
  const clientIp = (c: Context) => c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || c.req.header("x-real-ip") || "unknown";

  const page = (c: Context, title: string, body: Parameters<typeof Layout>[0]["children"], status: 200 | 201 | 404 | 410 | 422 | 429 = 200) =>
    c.html(
      <Layout title={title} persistent={persistent}>
        {body}
      </Layout>,
      status,
    );

  const rateLimited = (c: Context) => {
    const result = limiter.take(clientIp(c));
    if (result.allowed) return undefined;
    c.header("Retry-After", String(result.retryAfter));
    return result.retryAfter;
  };

  app.get("/healthz", (c) => c.json({ ok: true, persistent }));

  app.get("/api/openapi.json", (c) => c.json(openApiSpec(origin(c))));

  // Short links are fine to crawl (they redirect); private stats and the API are not.
  app.get("/robots.txt", (c) => c.text("User-agent: *\nDisallow: /manage/\nDisallow: /api/\n"));

  app.get("/", (c) => page(c, "snip: short links with private stats", <HomePage host={host(c)} />));

  // The web form. htmx swaps the response into the page; without JS this is a normal post.
  app.post("/new", async (c) => {
    const isHtmx = c.req.header("hx-request") === "true";
    const form = await c.req.parseBody();
    const values = { url: String(form.url ?? ""), slug: String(form.slug ?? "").trim(), expires: String(form.expires ?? "") };
    // htmx only swaps 2xx responses by default, so its form errors come back as 200;
    // a plain form post gets the real status.
    const respond = (errors: FormErrors, status: 422 | 429 = 422) => {
      const form = <CreateForm host={host(c)} values={values} errors={errors} />;
      return isHtmx ? c.html(form) : page(c, "snip", form, status);
    };

    const retry = rateLimited(c);
    if (retry) return respond({ form: `You're creating links quickly. Try again in ${retry} seconds.` }, 429);

    const expiresIn = EXPIRY_MS[values.expires];
    const result = await createLink(
      db,
      { url: values.url, ...(values.slug ? { slug: values.slug } : {}), ...(expiresIn ? { expiresAt: new Date(now().getTime() + expiresIn) } : {}) },
      { ownHost: host(c), now: now() },
    );
    if (!result.ok) return respond({ [result.field]: result.error });

    const body = <Result link={result.link} origin={origin(c)} token={result.token} />;
    return isHtmx ? c.html(body, 201) : page(c, "Your short link", body, 201);
  });

  app.get("/manage/:slug", async (c) => {
    const slug = c.req.param("slug");
    const token = c.req.query("token");
    const link = await authorize(db, slug, token);
    c.header("Cache-Control", "no-store");
    if (!link || !token) return page(c, "Not found", <MessagePage title="Link not found" message="This stats link is wrong, or the short link was deleted." />, 404);
    const stats = await getStats(db, link, { now: now() });
    return page(c, `Stats for /${slug}`, <ManagePage stats={stats} origin={origin(c)} token={token} />);
  });

  app.get("/manage/:slug/clicks.csv", async (c) => {
    const slug = c.req.param("slug");
    const link = await authorize(db, slug, c.req.query("token"));
    if (!link) return c.text("Not found", 404);
    const rows = await listClicks(db, slug);
    const csv = toCsv([
      ["time_utc", "referrer", "country", "device", "browser"],
      ...rows.map((r) => [new Date(r.at).toISOString(), r.referrer_host ?? "", r.country ?? "", r.device, r.browser]),
    ]);
    return c.body(csv, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-clicks.csv"`,
      "Cache-Control": "no-store",
    });
  });

  app.post("/manage/:slug/:action{toggle|delete}", async (c) => {
    const slug = c.req.param("slug");
    const token = String((await c.req.parseBody()).token ?? "");
    const link = await authorize(db, slug, token);
    if (!link) return page(c, "Not found", <MessagePage title="Link not found" message="This stats link is wrong, or the short link was deleted." />, 404);
    if (c.req.param("action") === "delete") {
      await deleteLink(db, slug);
      return page(c, "Deleted", <MessagePage title="Link deleted" message={`/${slug} and its stats are gone. Anyone using it now gets "not found".`} />);
    }
    await setDisabled(db, slug, !link.disabled);
    // Post/redirect/get, so a refresh doesn't toggle again.
    return c.redirect(`/manage/${slug}?token=${encodeURIComponent(token)}`, 303);
  });

  // JSON API. The management token goes in the Authorization header.
  const bearer = (c: Context) => c.req.header("authorization")?.replace(/^Bearer\s+/i, "");

  app.post("/api/links", async (c) => {
    const retry = rateLimited(c);
    if (retry) return c.json({ error: "rate_limited", message: `Try again in ${retry} seconds` }, 429);
    const parsed = createBody.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: "invalid_request", message: "Send JSON with a url, and optionally slug and expiresAt (ISO 8601)" }, 400);

    const { url, slug, expiresAt } = parsed.data;
    const result = await createLink(db, { url, ...(slug ? { slug } : {}), ...(expiresAt ? { expiresAt: new Date(expiresAt) } : {}) }, { ownHost: host(c), now: now() });
    if (!result.ok) return c.json({ error: "invalid_" + result.field, message: result.error }, result.error.includes("already taken") ? 409 : 422);

    const { link, token } = result;
    return c.json(
      {
        slug: link.slug,
        shortUrl: `${origin(c)}/${link.slug}`,
        targetUrl: link.target_url,
        expiresAt: link.expires_at,
        manageToken: token,
        statsUrl: `${origin(c)}/manage/${link.slug}?token=${encodeURIComponent(token)}`,
        qrUrl: `${origin(c)}/qr/${link.slug}.svg`,
      },
      201,
    );
  });

  app.get("/api/links/:slug", async (c) => {
    const link = await authorize(db, c.req.param("slug"), bearer(c));
    if (!link) return c.json({ error: "not_found" }, 404);
    const days = Math.min(365, Math.max(1, Number(c.req.query("days") ?? 30) || 30));
    return c.json(await getStats(db, link, { days, now: now() }));
  });

  app.patch("/api/links/:slug", async (c) => {
    const link = await authorize(db, c.req.param("slug"), bearer(c));
    if (!link) return c.json({ error: "not_found" }, 404);
    const parsed = z.object({ disabled: z.boolean() }).safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: "invalid_request", message: 'Send {"disabled": true|false}' }, 400);
    await setDisabled(db, link.slug, parsed.data.disabled);
    return c.json({ slug: link.slug, disabled: parsed.data.disabled });
  });

  app.delete("/api/links/:slug", async (c) => {
    const link = await authorize(db, c.req.param("slug"), bearer(c));
    if (!link) return c.json({ error: "not_found" }, 404);
    await deleteLink(db, link.slug);
    return c.body(null, 204);
  });

  app.get("/qr/:file{[A-Za-z0-9_-]+\\.svg}", async (c) => {
    const slug = c.req.param("file").replace(/\.svg$/, "");
    if ((await resolveLink(db, slug, now())).status === "not_found") return c.notFound();
    const svg = await QRCode.toString(`${origin(c)}/${slug}`, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    return c.body(svg, 200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" });
  });

  // The redirect itself. Must stay last: it matches any single path segment.
  // Adding "+" to a short link shows where it goes instead of going there.
  app.get("/:slug{[A-Za-z0-9_-]+\\+}", async (c) => {
    const slug = c.req.param("slug").slice(0, -1);
    const link = await db.selectFrom("links").select(["target_url", "created_at"]).where("slug", "=", slug).executeTakeFirst();
    if (!link) return page(c, "Not found", <MessagePage title="This link doesn't exist" message="It may have been mistyped or deleted." />, 404);
    return page(c, `Where /${slug} goes`, <PreviewPage short={`${origin(c)}/${slug}`} target={link.target_url} createdAt={link.created_at} />);
  });

  app.get("/:slug{[A-Za-z0-9_-]+}", async (c) => {
    const slug = c.req.param("slug");
    const resolved = await resolveLink(db, slug, now());
    if (resolved.status === "not_found") return page(c, "Not found", <MessagePage title="This link doesn't exist" message="It may have been mistyped or deleted." />, 404);
    if (resolved.status !== "ok") {
      const message = resolved.status === "expired" ? "This link has expired." : "This link has been turned off by its owner.";
      return page(c, "Link unavailable", <MessagePage title="Link unavailable" message={message} />, 410);
    }

    // HEAD requests and bots (link previews, crawlers) aren't clicks.
    const visitor = classifyVisitor(c.req.header("user-agent"));
    if (c.req.method === "GET" && !visitor.bot) {
      try {
        await recordClick(db, slug, {
          referrerHost: referrerHost(c.req.header("referer"), host(c)),
          country: c.req.header("x-vercel-ip-country") ?? c.req.header("cf-ipcountry") ?? null,
          device: visitor.device,
          browser: visitor.browser,
          // The same clock as expiry checks and stats windows, not the database's.
          at: now(),
        });
      } catch (error) {
        // Analytics must never break the redirect.
        console.error("Failed to record click", error);
      }
    }
    // Not cached, so every visit reaches the server and is counted.
    c.header("Cache-Control", "private, no-store");
    return c.redirect(resolved.url, 302);
  });

  app.notFound((c) => page(c, "Not found", <MessagePage title="Page not found" message="Check the address and try again." />, 404));

  return app;
}
