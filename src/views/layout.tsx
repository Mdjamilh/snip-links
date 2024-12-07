import type { Child } from "hono/jsx";

export const Logo = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </svg>
);

/** The page shell. Everything is served from this origin: no third-party scripts or fonts. */
export function Layout({ title, persistent, children }: { title: string; persistent: boolean; children: Child }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        <meta name="description" content="Short links with private click stats. No account needed." />
        <link rel="icon" href="/static/icon.svg" type="image/svg+xml" />
        <link rel="stylesheet" href="/static/app.css" />
        {/* htmx injects its own <style> by default, which the CSP blocks; app.css covers it. */}
        <meta name="htmx-config" content='{"includeIndicatorStyles":false}' />
        <script src="/static/htmx.min.js" defer></script>
        <script src="/static/app.js" defer></script>
      </head>
      <body>
        {!persistent && (
          <div class="demo-banner" role="note">
            Demo instance: links are kept in memory and may disappear when it restarts.
          </div>
        )}
        <main>
          <header class="site">
            <a class="brand" href="/">
              <Logo />
              snip
            </a>
            <a href="https://github.com/Mdjamilh/snip-links">Source</a>
          </header>
          {children}
          <footer>No accounts and no tracking cookies. Click stats record the referring site, country, device and browser, never IP addresses.</footer>
        </main>
      </body>
    </html>
  );
}
