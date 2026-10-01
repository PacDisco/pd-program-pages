# pd-program-pages

Static origin for **www.pacificdiscovery.org/programs/&lt;slug&gt;** pages edited in
pd-dashboard → **Program Pages**. This repo has no functions, no database and no
login. On each build it pulls **published** pages from the dashboard with a
read-only token, copies their images into `dist/`, and renders:

- `dist/programs/<slug>/index.html`: a standalone page (noindex, canonical → www)
- `dist/programs/<slug>/fragment.json`: what the Cloudflare Worker puts into the real site
- `dist/_pd/render.mjs`: the template, for the editor's drift check
- `dist/_pd/manifest.json`: what's live and when it was built

If the dashboard can't be reached, the build **fails**, and Netlify keeps serving the last good deploy.

| Path | |
|---|---|
| `src/render.mjs` | **The template.** Content model (`SCHEMA`, `SECTIONS`), HTML and CSS (all scoped under `.pdp`). Every value is escaped and every URL goes through `safeUrl()`. |
| `scripts/build.mjs` | The build. `npm run build:sample` renders `sample/*.json` with no token. |
| `cloudflare/worker.js`, `wrangler.toml` | Serves published pages on www. Keeps the PHP site's header, nav, footer, GTM/HubSpot and WhatsApp widget, and swaps `<main id="main">` for the program body. |
| `test/render.test.mjs` | `npm test`: escaping, URL safety, editor hooks absent live, layout, dates, JSON-LD, sample build. |

## Set up (once)

1. **Database:** run `MIGRATION-program-pages.sql` (in pd-dashboard) in the Neon SQL editor.
2. **Token:** `openssl rand -hex 32`. Set it as `PROGRAM_PAGES_BUILD_TOKEN` on **both** Netlify sites.
3. **This site:** create a Netlify site from this repo. The build settings come from `netlify.toml`. Add env vars `PROGRAM_PAGES_BUILD_TOKEN` and `DASHBOARD_URL=https://dashboard.pacificdiscovery.org`. The first build produces 0 pages, which is expected.
4. **Build hook:** Site configuration → Build & deploy → Build hooks → add "Program Pages publish". Put the URL in pd-dashboard as `PROGRAM_SITE_BUILD_HOOK` and redeploy the dashboard.
5. **If this site's URL isn't `https://pd-program-pages.netlify.app`**, change `PROGRAM_SITE` in two places: pd-dashboard `program-pages/editor.js` and `cloudflare/wrangler.toml`. The CORS header in `netlify.toml` names the dashboard, not this site.
6. **Worker:** `cd cloudflare && npx wrangler deploy`. It only runs on `www.pacificdiscovery.org/programs/*`. Set `STICKY_TOP` to the height of the site's fixed header (in px) so the program's sticky bar sits under it.

## Review widgets

In the editor, **+ Add a live review widget** in the hero:

| Widget | What to paste | How it stays current |
|---|---|---|
| GoAbroad | The embed code GoAbroad gives you (the `<iframe …>`) | GoAbroad's iframe updates itself |
| GoOverseas | The embed code (the `<div class="go-overseas-review-widget-component" …>` part), or just the widget ID | GoOverseas' script updates it on page load |
| Google | The Place ID (starts `ChIJ…`; find it with Google's Place ID Finder) | The build fetches rating + review count from the Places API; the nightly rebuild refreshes it |

The pasted code is never put on the page as-is. The template pulls out the known
fields (GoAbroad URL, GoOverseas ID/type/theme, Google Place ID), checks them, and
rebuilds the embed. Anything else in the paste, such as a `<script>`, is dropped. The
GoOverseas loader is added once per page, and never inside the editor.

Google needs `GOOGLE_PLACES_API_KEY` on this site (scope: Builds). Restrict the key to the
**Places API (New)** in Google Cloud. Without the key, the Google widget is simply left
out. Google's terms require showing its data with attribution, which the badge does
("on Google", linking to the Maps listing).

## Previewing before the Worker goes live

No DNS change is involved. The Worker attaches to `www.pacificdiscovery.org/programs/*` on your existing Cloudflare zone. Until you run `wrangler deploy`, www is untouched. To check a page before then:

- **The page on its own:** `https://pd-program-pages.netlify.app/programs/<slug>/` shows the published page without the site's header and footer.
- **The page inside the real site:** from `cloudflare/`, run
  `npx wrangler dev --var PREVIEW_ORIGIN:https://www.pacificdiscovery.org`
  and open `http://localhost:8787/programs/<slug>`. You get the real header, nav and footer from www, with the published program in the middle. Unpublished programs show the current PHP page. Preview responses are marked noindex.
  The site's own web fonts may not load from localhost (the font files block cross-origin use), so headings can fall back to Georgia in the preview only.

## Taking a program live

1. In the dashboard, **Program Pages → New page**. Use **the same web address as the current page** (e.g. `south-america-gap-semester`) so it replaces that page.
2. Fill in the placeholders and publish. The static page appears on this site in about a minute. Check `/programs/<slug>/` here first.
3. www switches over within about a minute after that (the Worker caches fragments for 60s). Pages that aren't published are passed straight through to the PHP site, untouched.

**Rollback:** in the editor, Page settings → **Take page offline**, and the PHP page comes back. To see the old page at any time, add `?pd-legacy=1`. If the program site is down or slow (over 2.5s), the Worker serves the PHP page automatically.

## Security notes

- This site's only secret is the build token. It can read published pages and their images, and nothing else.
- Deploy previews and branch deploys build **sample** content (`netlify.toml`), so a PR never sees live data.
- `/programs/*` here sends `X-Robots-Tag: noindex`. Canonical tags point at www. The Worker builds its response from the www origin's headers, so noindex never reaches the real pages.
