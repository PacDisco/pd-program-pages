// cloudflare/worker.js — serves published program pages on www.pacificdiscovery.org
//
// Route: www.pacificdiscovery.org/programs/*
//
// For /programs/<slug>:
//   1. Ask pd-program-pages for /programs/<slug>/fragment.json.
//      Not published (404), slow (>2.5s) or erroring → pass straight through to
//      the existing PHP page. A program goes live only when it's published, and
//      an outage on the program site can never take a page down.
//   2. Fetch the normal PHP page from the origin (or SHELL_PATH if the program
//      is new and the PHP site has no page for it) and keep its header, nav,
//      footer, GTM/HubSpot scripts and WhatsApp widget exactly as they are.
//   3. Swap <main id="main"> for the program body, drop the old banner, and set
//      title / description / canonical / social tags / JSON-LD.
//
// Escape hatch: add ?pd-legacy=1 to see the old PHP page.
//
// Preview before going live: set PREVIEW_ORIGIN (e.g. https://www.pacificdiscovery.org)
// and run `npx wrangler dev` (or deploy to workers.dev with no route). The Worker
// then fetches the PHP pages from that origin, adds a <base> tag so the site's CSS
// and images load, and marks the page noindex. Nothing on www changes.
//
// Vars (wrangler.toml): PROGRAM_SITE, SHELL_PATH, STICKY_TOP, PREVIEW_ORIGIN

const SLUG_RE = /^\/programs\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = SLUG_RE.exec(url.pathname);
    const preview = /^https:\/\/[a-z0-9.-]+$/i.test(env.PREVIEW_ORIGIN || '') ? env.PREVIEW_ORIGIN : '';
    const base = preview || url.origin;
    const passThrough = () => (preview ? fetch(new URL(url.pathname + url.search, preview)) : fetch(request));
    if (!m || (request.method !== 'GET' && request.method !== 'HEAD') || url.searchParams.has('pd-legacy')) {
      return passThrough();
    }
    const slug = m[1];

    const frag = await loadFragment(env, slug);
    if (!frag) return passThrough();

    let origin = await passThrough();
    if (origin.status === 404) {
      origin = await fetch(new URL(env.SHELL_PATH || '/programs', base), preview ? {} : { headers: request.headers });
      if (!origin.ok) return passThrough();
    }
    if (!origin.ok || !(origin.headers.get('content-type') || '').includes('text/html')) return origin;

    return rewrite(origin, frag, env, preview);
  },
};

async function loadFragment(env, slug) {
  const base = (env.PROGRAM_SITE || '').replace(/\/+$/, '');
  if (!base) return null;
  try {
    const res = await fetch(`${base}/programs/${slug}/fragment.json`, {
      cf: { cacheTtl: 60, cacheEverything: true },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    const f = await res.json();
    return f && typeof f.html === 'string' && f.slug === slug ? f : null;
  } catch {
    return null;
  }
}

function escAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function escText(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function rewrite(origin, f, env, preview = '') {
  const seen = { canonical: false, description: false, ogTitle: false, ogDesc: false, ogImage: false, ogUrl: false };
  const css = String(f.css || '').replace(/<\/style/gi, '');
  const stickyTop = /^\d{1,3}px$/.test(env.STICKY_TOP || '') ? env.STICKY_TOP : '0px';
  const meta = (attrName, key, value) => ({
    element(e) { seen[key] = true; e.setAttribute('content', value); },
  });

  const out = new HTMLRewriter()
    .on('title', { element(e) { e.setInnerContent(f.title || ''); } })
    .on('meta[name="description"]', meta('name', 'description', f.description || ''))
    .on('meta[property="og:title"]', meta('property', 'ogTitle', f.title || ''))
    .on('meta[property="og:description"]', meta('property', 'ogDesc', f.description || ''))
    .on('meta[property="og:image"]', { element(e) { seen.ogImage = true; if (f.ogImage) e.setAttribute('content', f.ogImage); } })
    .on('meta[property="og:url"]', meta('property', 'ogUrl', f.canonical || ''))
    .on('link[rel="canonical"]', { element(e) { seen.canonical = true; if (f.canonical) e.setAttribute('href', f.canonical); } })
    .on('head', {
      element(e) {
        // Preview: make the site's relative CSS/JS/image paths resolve to the real site.
        if (preview) e.prepend(`<base href="${escAttr(preview)}/"><meta name="robots" content="noindex">`, { html: true });
        e.onEndTag((end) => {
          let add = `<style id="pdp-css">${css}.pdp{--pdp-sticky-top:${stickyTop}}</style>`;
          if (!seen.canonical && f.canonical) add += `<link rel="canonical" href="${escAttr(f.canonical)}">`;
          if (!seen.description) add += `<meta name="description" content="${escAttr(f.description)}">`;
          if (!seen.ogTitle) add += `<meta property="og:title" content="${escAttr(f.title)}">`;
          if (!seen.ogImage && f.ogImage) add += `<meta property="og:image" content="${escAttr(f.ogImage)}">`;
          if (f.jsonLd) add += `<script type="application/ld+json">${String(f.jsonLd).replace(/<\//g, '<\\/')}</script>`;
          end.before(add, { html: true });
        });
      },
    })
    // The PHP page's photo banner sits outside <main>; the program hero replaces it.
    .on('section.banner', { element(e) { e.remove(); } })
    .on('main#main', { element(e) { e.setInnerContent(f.html, { html: true }); } })
    .transform(origin);

  const headers = new Headers(out.headers);
  headers.delete('content-length');
  headers.set('x-pd-program-page', escText(f.publishedAt || 'live'));
  if (preview) headers.set('x-robots-tag', 'noindex');
  return new Response(out.body, { status: origin.status, headers });
}
