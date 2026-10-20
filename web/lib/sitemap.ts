export const PER_SITEMAP = 40_000; // Google's limit is 50k URLs per file

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

export function xml(body: string) {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n${body}`, {
    headers: { "Content-Type": "application/xml", "Cache-Control": "public, s-maxage=86400" },
  });
}

export const urlset = (urls: string[]) =>
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${esc(u)}</loc></url>`).join("")}</urlset>`;
