// cloudflare/legacy-redirects.js — redirects for retired /programs URLs.
//
// The pd-redirects Worker handles old URLs everywhere else on www, but this
// Worker owns /programs/* and /lp/*, so requests for those paths never reach it.
// worker.js calls legacyRedirect() only when the page would otherwise 404:
// a published or live PHP page always wins over an entry here.
//
// Keys: lowercase, decoded, no trailing slash, no query. Targets must be live pages.
export const PROGRAM_REDIRECTS = {
  '/programs/australia-college-summer': '/programs/college-summer',
  '/programs/hawaii-college-summer': '/programs/college-summer',
  '/programs/thailand-college-summer': '/programs/college-summer',
  '/programs/new-zealand-and-fiji-college-summer': '/programs/new-zealand-and-fiji-summer',
  '/programs/peru-high-school-summer': '/programs/high-school-summer',
  '/programs/thailand-high-school-summer': '/programs/high-school-summer',
  '/programs/hawaii-summer': '/programs/summer',
  '/programs/caribbean-mini-semester': '/programs/mini-semester-programs',
  '/programs/greece-croatia-mini-semester': '/programs/mini-semester-programs',
  '/programs/nepal-and-tibet-gap-semester': '/programs/semester-programs',
  '/programs/nepal-india-gap-semester': '/programs/semester-programs',
  '/programs/rewilding-gap-semester': '/programs/semester-programs',
  '/programs/fall': '/programs',
  '/programs/spring': '/programs',
  '/programs/summer-programs/australia-summer-program': '/programs/summer',
  '/programs/summer-programs/ecuador-and-galapagos-summer- program': '/programs/summer',
  // Broken links with spaces in the site's own navigation (fix the nav too).
  '/programs/mini semester': '/programs/mini-semester-programs',
  '/programs/study abroad': '/programs/study-abroad',
};

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

export function legacyKey(pathname) {
  let p = pathname;
  try { p = decodeURIComponent(pathname); } catch (_) { /* keep raw */ }
  return (p.replace(/\/+$/, '') || '/').toLowerCase();
}

function redirect(target, url, status = 301) {
  const dest = new URL(target, url.origin);
  for (const [k, v] of url.searchParams) if (!dest.searchParams.has(k)) dest.searchParams.append(k, v);
  return new Response(null, { status, headers: { Location: dest.toString(), 'Cache-Control': 'public, max-age=3600' } });
}

/**
 * Call when the response for `request` is a 404. Returns a redirect Response, or null.
 *  1. Path is in PROGRAM_REDIRECTS -> 301 there, query string kept.
 *  2. URL has a query string -> the PHP site's own redirect rules ignore URLs with
 *     queries, so ask the origin about the bare path; if it redirects, follow it
 *     with the query kept (this is what fixes ?utm_source=teenlife links).
 */
export async function legacyRedirect(request, fetchImpl = fetch) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const url = new URL(request.url);
  const target = PROGRAM_REDIRECTS[legacyKey(url.pathname)];
  if (target) return redirect(target, url);

  if (url.search) {
    try {
      const bare = url.origin + url.pathname.replace(/\/+$/, '');
      const res = await fetchImpl(bare, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(2500) });
      const loc = res.headers.get('Location');
      if (REDIRECT_CODES.has(res.status) && loc) {
        const dest = new URL(loc, bare);
        if (dest.hostname === url.hostname) dest.protocol = 'https:';
        return redirect(dest.toString(), url, res.status === 301 || res.status === 308 ? 301 : 302);
      }
    } catch (_) { /* fall back to the 404 */ }
  }
  return null;
}
