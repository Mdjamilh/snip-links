import type { Count, Stats } from "../links.ts";

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

      <section class="card breakdowns">
        <Breakdown title="Referrers" rows={stats.referrers} />
        <Breakdown title="Countries" rows={stats.countries} />
        <Breakdown title="Devices" rows={stats.devices} />
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
