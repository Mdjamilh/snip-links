export type Device = "desktop" | "mobile" | "tablet" | "other";

export type Visitor = { bot: boolean; device: Device; browser: string };

// Crawlers and link previews (Slack, iMessage, social networks) fetch links
// without a person clicking, so they're not counted.
const BOT = /bot\b|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|headless|lighthouse|curl\/|wget|python-requests|go-http-client|axios|node-fetch|postman/i;

/** A rough read of a User-Agent: enough for analytics, not fingerprinting. */
export function classifyVisitor(userAgent: string | undefined): Visitor {
  const ua = userAgent ?? "";
  if (!ua || BOT.test(ua)) return { bot: true, device: "other", browser: "Bot" };

  let device: Device = "desktop";
  if (/iPad|Tablet|Kindle|Silk|PlayBook/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) device = "tablet";
  else if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua)) device = "mobile";

  // Order matters: Edge and Opera include "Chrome", and Chrome includes "Safari".
  let browser = "Other";
  if (/Edg(e|A|iOS)?\//.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/.test(ua)) browser = "Opera";
  else if (/SamsungBrowser\//.test(ua)) browser = "Samsung Internet";
  else if (/Firefox\/|FxiOS\//.test(ua)) browser = "Firefox";
  else if (/Chrome\/|CriOS\//.test(ua)) browser = "Chrome";
  else if (/Safari\//.test(ua)) browser = "Safari";

  return { bot: false, device, browser };
}

/** The referring site, without path or query (which can carry personal data). */
export function referrerHost(referrer: string | undefined, ownHost?: string): string | null {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, "");
    if (!host || (ownHost && host === ownHost.replace(/:\d+$/, "").replace(/^www\./, ""))) return null;
    return host;
  } catch {
    return null;
  }
}
