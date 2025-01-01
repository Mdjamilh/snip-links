import type { Count, Stats } from "../links.js";

/** Daily clicks as an SVG bar chart, drawn on the server: no chart library, works without JS. */
export function DailyChart({ days }: { days: Stats["days"] }) {
  const width = 700;
  const height = 160;
  const max = Math.max(1, ...days.map((d) => d.clicks));
  const barWidth = width / days.length;
  const total = days.reduce((s, d) => s + d.clicks, 0);
  return (
    <svg class="chart" viewBox={`0 0 ${width} ${height + 22}`} role="img" aria-label={`${total} clicks in the last ${days.length} days`}>
      {days.map((d, i) => {
        const h = Math.round((d.clicks / max) * height);
        return (
          <rect x={i * barWidth + 1} y={height - h} width={Math.max(1, barWidth - 2)} height={Math.max(h, d.clicks ? 2 : 0)} rx="2">
            <title>
              {d.date}: {d.clicks} {d.clicks === 1 ? "click" : "clicks"}
            </title>
          </rect>
        );
      })}
      <line class="baseline" x1="0" y1={height + 0.5} x2={width} y2={height + 0.5} />
      <text x="0" y={height + 16}>
        {days[0]?.date}
      </text>
      <text x={width} y={height + 16} text-anchor="end">
        {days.at(-1)?.date}
      </text>
    </svg>
  );
}

function Breakdown({ title, rows }: { title: string; rows: Count[] }) {
  return (
    <div>
      <h3>{title}</h3>
      {rows.length ? (
        <table>
          <tbody>
            {rows.map((r) => (
              <tr>
                <td>{r.label}</td>
                <td class="n">{r.clicks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p class="muted">No clicks yet.</p>
      )}
    </div>
  );
}

const date = (d: Date | null) => (d ? d.toISOString().replace("T", " ").slice(0, 16) + " UTC" : "Never");

/** The private stats page. Actions post the token back in a hidden field. */
export function ManagePage({ stats, origin, token }: { stats: Stats; origin: string; token: string }) {
  const short = `${origin}/${stats.slug}`;
  const windowTotal = stats.days.reduce((s, d) => s + d.clicks, 0);
  return (
    <>
      <section class="card">
        <div class="stats-head">
          <div>
            <h1 class="page-title">
              <a href={short}>{short.replace(/^https?:\/\//, "")}</a>
            </h1>
            <p class="muted mono target">
              → {stats.targetUrl}
            </p>
          </div>
          <span class={stats.disabled ? "badge off" : "badge"}>{stats.disabled ? "Disabled" : "Active"}</span>
        </div>
        <div class="stat-grid">
          <div class="stat">
            <span class="muted">All clicks</span>
            <b>{stats.totalClicks}</b>
          </div>
          <div class="stat">
            <span class="muted">Last {stats.days.length} days</span>
            <b>{windowTotal}</b>
          </div>
          <div class="stat">
            <span class="muted">Last click</span>
            <b class="small">{date(stats.lastClickAt)}</b>
          </div>
        </div>
        <DailyChart days={stats.days} />
      </section>

      <p class="export">
        <a href={`/manage/${stats.slug}/clicks.csv?token=${encodeURIComponent(token)}`} download>
          Download every click as CSV
        </a>
      </p>

      <section class="card breakdowns">
        <Breakdown title="Referrers" rows={stats.referrers} />
        <Breakdown title="Countries" rows={stats.countries} />
        <Breakdown title="Devices" rows={stats.devices.map((d) => ({ ...d, label: d.label[0]?.toUpperCase() + d.label.slice(1) }))} />
        <Breakdown title="Browsers" rows={stats.browsers} />
      </section>

      <section class="card">
        <p class="muted first">
          Created {date(stats.createdAt)}. {stats.expiresAt ? `Expires ${date(stats.expiresAt)}.` : "Never expires."} Bots and link previews aren't counted.
        </p>
        <div class="actions">
          <form method="post" action={`/manage/${stats.slug}/toggle`}>
            <input type="hidden" name="token" value={token} />
            <button type="submit" class="secondary">
              {stats.disabled ? "Turn the link back on" : "Turn the link off"}
            </button>
          </form>
          <form method="post" action={`/manage/${stats.slug}/delete`} data-confirm="Delete this link and all its stats? This cannot be undone.">
            <input type="hidden" name="token" value={token} />
            <button type="submit" class="danger">
              Delete link
            </button>
          </form>
        </div>
      </section>
    </>
  );
}

/** "Where does this go?" Shown for /slug+ so people can check a link before visiting. */
export function PreviewPage({ short, target, createdAt }: { short: string; target: string; createdAt: Date }) {
  const host = new URL(target).hostname;
  return (
    <section class="card">
      <p class="muted first">{short.replace(/^https?:\/\//, "")} goes to</p>
      <h1 class="page-title preview-host">{host}</h1>
      <p class="mono target">{target}</p>
      <p class="muted">Created {createdAt.toISOString().slice(0, 10)}. Viewing this page doesn't count as a click.</p>
      <div class="actions">
        <a class="button" href={target} rel="noopener noreferrer">
          Continue to {host}
        </a>
        <a class="button secondary" href="/">
          Make your own short link
        </a>
      </div>
    </section>
  );
}

export function MessagePage({ title, message }: { title: string; message: string }) {
  return (
    <section class="card">
      <h1 class="page-title">{title}</h1>
      <p class="muted">{message}</p>
      <a class="button secondary" href="/">
        Make a short link
      </a>
    </section>
  );
}
