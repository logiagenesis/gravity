/**
 * Sitemap generation.
 *
 * Runs after the Vite build and writes dist/sitemap.xml, and verifies that
 * dist/robots.txt actually points at it.
 *
 * REGRESSION GUARD: the audited deployment's robots.txt advertised
 * https://gravitysimulator.org/sitemap-index.xml, which returned HTTP 404
 * (artifacts/03-current-site-audit.md §11.1). CI additionally asserts both
 * files exist and agree, so a crawler can never again be pointed at a dead
 * sitemap.
 *
 * All URLs are percent-encoded and same-origin, which is the other SEO defect
 * found upstream: og:image URLs containing literal unencoded spaces on a
 * different host (§11.3).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { CatalogEntry } from "../src/catalog";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DIST = join(ROOT, "dist");

/** Override with SITE_URL when deploying elsewhere. */
const SITE_URL = (process.env.SITE_URL ?? "https://gravitysimulator.org").replace(
  /\/$/,
  "",
);

function xmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function main(): void {
  if (!existsSync(DIST)) {
    console.error("dist/ does not exist. Run the Vite build first.");
    process.exit(1);
  }

  const catalogPath = join(ROOT, "src", "catalog", "generated", "catalog.json");
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8")) as CatalogEntry[];
  const today = new Date().toISOString().slice(0, 10);

  const routes = [
    { path: "/", priority: "1.0", changefreq: "weekly" },
    { path: "/#/saved", priority: "0.3", changefreq: "monthly" },
    { path: "/#/about", priority: "0.6", changefreq: "monthly" },
    { path: "/#/privacy", priority: "0.4", changefreq: "yearly" },
    ...catalog.map((entry) => ({
      // encodeURIComponent keeps the URL legal even if an id ever gains a
      // character that needs escaping.
      path: `/#/scenario/${encodeURIComponent(entry.id)}`,
      priority: "0.8",
      changefreq: "monthly",
    })),
  ];

  const body = routes
    .map(
      (route) =>
        `  <url>\n` +
        `    <loc>${xmlEscape(SITE_URL + route.path)}</loc>\n` +
        `    <lastmod>${today}</lastmod>\n` +
        `    <changefreq>${route.changefreq}</changefreq>\n` +
        `    <priority>${route.priority}</priority>\n` +
        `  </url>`,
    )
    .join("\n");

  const SITEMAP_NS = "http://www.sitemaps.org/schemas/sitemap/0.9";
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="${SITEMAP_NS}">\n${body}\n</urlset>\n`;

  writeFileSync(join(DIST, "sitemap.xml"), xml, "utf8");

  // The sitemap and robots.txt must agree, or we have recreated the upstream bug.
  const robotsPath = join(DIST, "robots.txt");
  if (!existsSync(robotsPath)) {
    console.error(
      "dist/robots.txt is missing. public/robots.txt should have been copied.",
    );
    process.exit(1);
  }
  const robots = readFileSync(robotsPath, "utf8");
  if (!robots.includes("sitemap.xml")) {
    console.error("dist/robots.txt does not reference sitemap.xml.");
    process.exit(1);
  }

  console.log(`Sitemap written: ${routes.length} URLs at ${SITE_URL}/sitemap.xml`);
}

main();
