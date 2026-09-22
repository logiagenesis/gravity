/**
 * Chrome-less embedding.
 *
 * `?embed=1` strips the site header, footer and navigation so the simulator
 * can sit inside a lesson page or a slide without a second set of links
 * competing with the host page's own.
 *
 * It is a QUERY parameter and not part of the hash, so that it survives the
 * hash router: the route changes as somebody moves around inside the frame,
 * and the embedding does not.
 *
 * What it does NOT strip: the attribution link, the details panel, the
 * warnings or the citation. An embedded simulation that could not say where
 * its numbers came from would be worse than one that is not embedded at all,
 * and an embedded simulation that could not say what it is would be a page
 * pretending the work is its own.
 */

/** True when the query string asks for the chrome-less view. */
export function isEmbedded(search: string): boolean {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return false;
  }
  const value = params.get("embed");
  // Accept the obvious affirmatives and nothing else, so a stray `?embed=0`
  // or `?embed` typed by hand does not silently hide the navigation.
  return value === "1" || value === "true" || value === "yes";
}

/**
 * Where "open the full simulator" should go.
 *
 * Derived from the page's own base URL rather than any configured domain. We
 * do not control the site this is deployed to — that is configuration, not a
 * constant — so the only correct answer is "wherever this copy lives".
 */
export function fullSiteUrl(baseUrl: string, origin: string): string {
  try {
    return new URL(baseUrl, origin).toString();
  } catch {
    return origin;
  }
}
