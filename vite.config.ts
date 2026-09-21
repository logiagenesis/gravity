import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import {
  readSiteConfig,
  absoluteUrl,
  warnIfUnconfigured,
} from "./scripts/lib/site-config.js";

/**
 * Inject SEO tags into index.html at build time, and ONLY when SITE_URL is set.
 *
 * The tags used to be hardcoded in index.html pointing at a domain we do not
 * own. They are now generated from configuration, or omitted entirely. See
 * scripts/lib/site-config.ts for why omission is the correct fallback.
 */
function seoTagsPlugin(): Plugin {
  return {
    name: "gravity-seo-tags",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        const config = readSiteConfig();
        warnIfUnconfigured(config, "vite:seo");

        if (!config.canEmitSeo) {
          // Leave a comment so the absence is explicable when someone views source.
          return html.replace(
            "<!--SEO-->",
            "<!-- SEO tags omitted: SITE_URL was not set at build time. -->",
          );
        }

        const home = absoluteUrl(config, "/");
        const jsonLd = {
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "Gravity Simulator",
          applicationCategory: "EducationalApplication",
          operatingSystem: "Any browser",
          description:
            "An interactive 3D Newtonian n-body gravity simulator with cited data sources and visible energy and angular-momentum conservation diagnostics.",
          url: home,
          inLanguage: "en",
          isAccessibleForFree: true,
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        };

        const tags = [
          `<link rel="canonical" href="${home}" />`,
          `<meta property="og:url" content="${home}" />`,
          `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`,
        ].join("\n    ");

        return html.replace("<!--SEO-->", tags);
      },
    },
  };
}

export default defineConfig(() => {
  const config = readSiteConfig();
  return {
    base: config.basePath,
    plugins: [react(), seoTagsPlugin()],
    build: { target: "es2022", sourcemap: true },
    // `as const` matters: without it TypeScript widens this to `string`, which
    // does not satisfy Vite's `"es" | "iife"` literal union.
    worker: { format: "es" as const },
  };
});
