/**
 * Shared look for the staff emails (alerts, daily summary).
 *
 * Email clients ignore most CSS, so this is tables and inline styles only:
 * it renders the same in Gmail, Outlook and phone mail apps.
 */

export const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** The full email: a coloured header, the body, and a short footer. */
export function emailLayout({
  heading,
  subheading,
  preheader,
  accent = "#4f46e5",
  body,
  footer,
}: {
  heading: string;
  subheading?: string;
  /** The grey preview line shown after the subject in the inbox list. */
  preheader?: string;
  accent?: string;
  body: string;
  footer?: string;
}) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;font-family:${FONT};border:1px solid #e2e8f0">
  <tr><td style="background:${accent};padding:22px 28px">
    <div style="font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.75)">Guest Inbox</div>
    <div style="margin-top:6px;font-size:22px;line-height:1.3;font-weight:700;color:#ffffff">${esc(heading)}</div>
    ${subheading ? `<div style="margin-top:4px;font-size:14px;color:rgba(255,255,255,.85)">${esc(subheading)}</div>` : ""}
  </td></tr>
  <tr><td style="padding:24px 28px 8px">${body}</td></tr>
  <tr><td style="padding:16px 28px 24px;border-top:1px solid #f1f5f9;font-size:12px;line-height:1.5;color:#94a3b8">
    ${footer ?? "Sent automatically by Guest Inbox."}
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

/** A section title with an optional count bubble. */
export function sectionTitle(text: string, color = "#0f172a", count?: number) {
  return `<div style="margin:8px 0 12px;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${color}">
    ${esc(text)}${count !== undefined ? ` <span style="display:inline-block;margin-left:4px;padding:1px 8px;border-radius:999px;background:${color};color:#fff;font-size:11px">${count}</span>` : ""}
  </div>`;
}

/** A card with a coloured left edge. */
export function card(inner: string, edge: string) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;border:1px solid #e2e8f0;border-left:4px solid ${edge};border-radius:10px">
    <tr><td style="padding:14px 16px">${inner}</td></tr>
  </table>`;
}

/** A small rounded label. */
export function pill(text: string, bg: string, fg: string) {
  return `<span style="display:inline-block;margin:0 6px 0 0;padding:2px 9px;border-radius:999px;background:${bg};color:${fg};font-size:12px;font-weight:600">${esc(text)}</span>`;
}

/** A button-style link. */
export function button(href: string, label: string, color = "#4f46e5") {
  return `<a href="${esc(href)}" style="display:inline-block;margin-top:12px;padding:8px 16px;border-radius:8px;background:${color};color:#ffffff;font-size:13px;font-weight:600;text-decoration:none">${esc(label)}</a>`;
}
