/**
 * Single source of truth for the deployed site's URL and base path.
 *
 * WHY THIS EXISTS. The previous build hardcoded `https://gravitysimulator.org`
 * as the canonical URL, the og:url, the JSON-LD url and the sitemap host. We do
 * not own that domain. Publishing those tags tells search engines that somebody
 * else's site is the canonical copy of our content — actively harmful, not
 * merely wrong.
 *
 * The rule now: the site URL is CONFIGURATION. There is no default. If
 * `SITE_URL` is unset the build emits NO canonical, NO og:url, NO JSON-LD url
 * and NO sitemap, and prints a warning. A missing tag costs nothing; a wrong
 * one points ranking signal at a competitor.
 */

export interface SiteConfig {
  /** Absolute origin + path of the deployed site, no trailing slash. Null when unset. */
  siteUrl: string | null;
  /** Vite `base`. Always starts and ends with "/". */
  basePath: string;
  /** True when SEO tags and the sitemap may be emitted. */
  canEmitSeo: boolean;
}

function normaliseSiteUrl(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(
      `SITE_URL is not a valid absolute URL: ${JSON.stringify(raw)}. ` +
        `Expected something like https://logiagenesis.github.io/gravity`,
    );
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    throw new Error(
      `SITE_URL must use https (or be localhost for testing), received ${parsed.protocol}//`,
    );
  }
  // Strip any trailing slash so callers can always concatenate a rooted path.
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
}

function normaliseBasePath(raw: string | undefined): string {
  const trimmed = (raw ?? "/").trim();
  if (trimmed === "" || trimmed === "/") return "/";
  const withLeading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}

export function readSiteConfig(env: NodeJS.ProcessEnv = process.env): SiteConfig {
  const siteUrl = normaliseSiteUrl(env.SITE_URL);
  const basePath = normaliseBasePath(env.BASE_PATH);
  return { siteUrl, basePath, canEmitSeo: siteUrl !== null };
}

/** Join the site URL with a rooted path. Throws if SITE_URL is unset. */
export function absoluteUrl(config: SiteConfig, rootedPath: string): string {
  if (config.siteUrl === null) {
    throw new Error("absoluteUrl called with no SITE_URL configured.");
  }
  const path = rootedPath.startsWith("/") ? rootedPath : `/${rootedPath}`;
  return `${config.siteUrl}${path === "/" ? "/" : path}`;
}

/** One consistent warning, so the reason is obvious in any build log. */
export function warnIfUnconfigured(config: SiteConfig, context: string): void {
  if (config.canEmitSeo) return;
  console.warn(
    `[${context}] SITE_URL is not set.\n` +
      `  Skipping canonical, og:url, JSON-LD url, sitemap.xml and robots.txt Sitemap line.\n` +
      `  This is deliberate: emitting a guessed domain would point search engines at a site we do not own.\n` +
      `  Set SITE_URL (e.g. https://logiagenesis.github.io/gravity) to enable them.`,
  );
}
