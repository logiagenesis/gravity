/**
 * Generate dist/sitemap.xml and dist/robots.txt.
 *
 * TWO RULES, both learned the hard way.
 *
 * 1. NO GUESSED HOST. The previous version defaulted to
 *    `https://gravitysimulator.org` — a domain we do not own — so every build
 *    published a canonical pointing at somebody else's site. There is now no
 *    default: without SITE_URL this emits a robots.txt with no Sitemap line and
 *    no sitemap at all, and says why.
 *
 * 2. NO FRAGMENT URLS. The previous sitemap listed `/#/scenario/<id>` entries.
 *    Search engines discard the fragment, so every one of those collapsed to
 *    the home page — thousands of duplicate entries carrying no information.
 *    Only real, crawlable paths belong here. Scenario and category paths arrive
 *    with the prerendering milestone (M6); until then the sitemap honestly
 *    contains only the routes that actually resolve server-side.
 */
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readSiteConfig, absoluteUrl, warnIfUnconfigured } from "./lib/site-config";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, "..", "dist");

function xmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Rooted paths that resolve to a real HTML document today. */
function indexableRoutes(): Array<{
  path: string;
  priority: string;
  changefreq: string;
}> {
  // Only "/" is a real document while routing is hash-based. M6 replaces hash
  // routes with prerendered paths and this list grows from the catalogue.
  return [{ path: "/", priority: "1.0", changefreq: "weekly" }];
}

function main(): void {
  if (!existsSync(DIST)) {
    console.error("dist/ does not exist. Run the Vite build first.");
    process.exit(1);
  }

  const config = readSiteConfig();
  warnIfUnconfigured(config, "sitemap");

  if (!config.canEmitSeo) {
    // A robots.txt that allows crawling but advertises no sitemap is correct
    // and harmless. A sitemap naming a guessed host is neither.
    writeFileSync(
      join(DIST, "robots.txt"),
      "User-agent: *\nAllow: /\n\n# No Sitemap line: SITE_URL was not set at build time.\n",
      "utf8",
    );
    console.log(
      "robots.txt written without a Sitemap line; sitemap.xml not generated.",
    );
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const routes = indexableRoutes();

  const body = routes
    .map(
      (route) =>
        `  <url>\n` +
        `    <loc>${xmlEscape(absoluteUrl(config, route.path))}</loc>\n` +
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

  const sitemapUrl = absoluteUrl(config, "/sitemap.xml");
  writeFileSync(
    join(DIST, "robots.txt"),
    `User-agent: *\nAllow: /\n\nSitemap: ${sitemapUrl}\n`,
    "utf8",
  );

  // The advertised sitemap must exist and robots must point at it. This is the
  // 404-sitemap defect from the audit; assert it rather than trusting it.
  const robots = readFileSync(join(DIST, "robots.txt"), "utf8");
  if (!robots.includes(sitemapUrl)) {
    console.error("robots.txt does not reference the generated sitemap.");
    process.exit(1);
  }

  console.log(
    `Sitemap: ${routes.length} URL(s) at ${sitemapUrl}\n` +
      `  Note: scenario and category URLs are added by prerendering (M6); ` +
      `fragment routes are deliberately excluded because crawlers discard them.`,
  );
}

main();
