import type { Link } from "../db/schema.ts";

export type FormValues = { url?: string; slug?: string; expires?: string };
export type FormErrors = Partial<Record<"url" | "slug" | "expiresAt" | "form", string>>;

export const EXPIRY_OPTIONS = [
  { value: "", label: "Never" },
  { value: "1h", label: "In 1 hour" },
  { value: "1d", label: "In 1 day" },
  { value: "7d", label: "In 7 days" },
  { value: "30d", label: "In 30 days" },
];

/**
 * The create form. htmx posts it and swaps in the result, or this form again
 * with errors. Without JavaScript it's a normal form post.
 */
export function CreateForm({ host, values = {}, errors = {} }: { host: string; values?: FormValues; errors?: FormErrors }) {
  return (
    <form class="shorten card" method="post" action="/new" hx-post="/new" hx-target="this" hx-swap="outerHTML">
      <label>
        Long URL
        <input
          name="url"
          type="text"
          inputmode="url"
          placeholder="https://example.com/a/very/long/link"
          value={values.url ?? ""}
          required
          autofocus
          aria-invalid={errors.url ? "true" : undefined}
          aria-describedby={errors.url ? "url-error" : undefined}
        />
      </label>
      {errors.url && (
        <p class="error" id="url-error" role="alert">
          {errors.url}
        </p>
      )}
      <div class="row">
        <label>
          <span>
            Custom name <span class="hint">(optional)</span>
          </span>
          <span class="prefix">
            <span>{host}/</span>
            <input name="slug" placeholder="spring-sale" value={values.slug ?? ""} aria-invalid={errors.slug ? "true" : undefined} />
          </span>
        </label>
        <label>
          Expires
          <select name="expires">
            {EXPIRY_OPTIONS.map((o) => (
              <option value={o.value} selected={values.expires === o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {(errors.slug || errors.expiresAt || errors.form) && (
        <p class="error" role="alert">
          {errors.slug ?? errors.expiresAt ?? errors.form}
        </p>
      )}
      <div>
        <button type="submit">Shorten</button>
      </div>
    </form>
  );
}

export function Result({ link, origin, token }: { link: Link; origin: string; token: string }) {
  const short = `${origin}/${link.slug}`;
  const manage = `${origin}/manage/${link.slug}?token=${encodeURIComponent(token)}`;
  return (
    <section class="card" aria-live="polite">
      <div class="result">
        <div>
          <p class="muted label">
            Your short link
          </p>
          <div class="short">
            <a href={short}>{short.replace(/^https?:\/\//, "")}</a>
            <button type="button" class="secondary" data-copy={short}>
              Copy
            </button>
          </div>
          <p class="muted mono target">
            → {link.target_url}
          </p>
          {link.expires_at && <p class="muted">Expires {link.expires_at.toUTCString()}</p>}
        </div>
        <img class="qr" src={`/qr/${link.slug}.svg`} alt={`QR code for ${short}`} width="120" height="120" />
      </div>
      <div class="notice">
        <strong>Save your private stats link.</strong> It's the only way to see clicks or delete this link, and it isn't shown again:
        <br />
        <a class="mono" href={manage}>
          {manage}
        </a>
      </div>
      <p class="again">
        <a href="/">Shorten another link</a>
      </p>
    </section>
  );
}

export function HomePage({ host }: { host: string }) {
  return (
    <>
      <h1>Short links, private stats.</h1>
      <p class="lead">Paste a long link to get a short one and a QR code. See who clicked without signing up.</p>
      <CreateForm host={host} />
    </>
  );
}
