#!/usr/bin/env node
// scripts/build.mjs — static build for pd-program-pages.
//
// What it does
//   1. Pulls every PUBLISHED program from the dashboard's read-only export
//      endpoint (drafts never leave the dashboard).
//   2. Copies each image the editor uploaded out of the dashboard into this
//      site (dist/_pd/media/...), and rewrites the URLs, so the public site
//      never loads anything from dashboard.pacificdiscovery.org.
//   3. Renders, per program:
//        dist/programs/<slug>/index.html     standalone page (noindex; preview)
//        dist/programs/<slug>/fragment.json  what the Cloudflare Worker swaps
//                                            into www.pacificdiscovery.org
//   4. Publishes the template itself at /_pd/render.mjs for the editor.
//
// If the export can't be fetched the build FAILS on purpose: Netlify then keeps
// serving the previous deploy instead of publishing an empty site.
//
// Env
//   PROGRAM_PAGES_BUILD_TOKEN  shared secret; must match the dashboard's
//   DASHBOARD_URL              default https://dashboard.pacificdiscovery.org
//   URL                        this site's URL (Netlify sets it)
//   CANONICAL_BASE             default https://www.pacificdiscovery.org/programs/
//
// Local: `node scripts/build.mjs --sample` renders sample/*.json instead.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderStandalone, renderProgram, seoFor, jsonLd, PROGRAM_CSS } from '../src/render.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const DASHBOARD_URL = (process.env.DASHBOARD_URL || 'https://dashboard.pacificdiscovery.org').replace(/\/+$/, '');
const SITE_URL = (process.env.URL || 'http://localhost:8888').replace(/\/+$/, '');
const CANONICAL_BASE = process.env.CANONICAL_BASE || 'https://www.pacificdiscovery.org/programs/';
const TOKEN = process.env.PROGRAM_PAGES_BUILD_TOKEN || '';
const SAMPLE = process.argv.includes('--sample');
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MEDIA_PREFIX = `${DASHBOARD_URL}/api/program-media?key=`;
const KEY_RE = /^[a-z0-9][a-z0-9._-]{0,150}$/i;

async function loadPrograms() {
  if (SAMPLE) {
    const dir = path.join(ROOT, 'sample');
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json'));
    return Promise.all(files.map(async (f) => ({
      slug: path.basename(f, '.json'),
      publishedAt: new Date().toISOString(),
      data: JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')),
    })));
  }
  if (!TOKEN) throw new Error('PROGRAM_PAGES_BUILD_TOKEN is not set (use --sample to build sample content locally)');
  const res = await fetch(`${DASHBOARD_URL}/api/program-pages-export`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) throw new Error(`Export failed: HTTP ${res.status} ${await res.text().catch(() => '')}`);
  const body = await res.json();
  if (!Array.isArray(body.programs)) throw new Error('Export returned no programs array');
  return body.programs;
}

/** Find dashboard-hosted media in a program, copy it here, rewrite the URLs. */
async function localiseMedia(data, copied) {
  const keys = new Set();
  const walk = (v) => {
    if (typeof v === 'string') {
      if (v.startsWith(MEDIA_PREFIX)) {
        const key = decodeURIComponent(v.slice(MEDIA_PREFIX.length));
        if (KEY_RE.test(key)) { keys.add(key); return `${SITE_URL}/_pd/media/${key}`; }
        return '';
      }
      return v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  const out = walk(data);
  for (const key of keys) {
    if (copied.has(key)) continue;
    const res = await fetch(`${MEDIA_PREFIX}${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!res.ok) throw new Error(`Media ${key}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await fs.mkdir(path.join(DIST, '_pd', 'media'), { recursive: true });
    await fs.writeFile(path.join(DIST, '_pd', 'media', key), buf);
    copied.add(key);
  }
  return out;
}

// This site must never hold database credentials (see README → Security notes).
// If Netlify's Neon/DB extension gets connected to this project it injects one;
// refuse to build so it's noticed and removed rather than silently carried.
export function databaseVarsPresent(env = process.env) {
  return Object.keys(env).filter((k) => /DATABASE_URL|^NEON_|^PG(HOST|PASSWORD|USER|DATABASE)$/i.test(k));
}

async function main() {
  const dbVars = databaseVarsPresent();
  if (dbVars.length) {
    throw new Error(`Database credentials found in this site's environment (${dbVars.join(', ')}). ` +
      'pd-program-pages must not have database access: disconnect the database in Netlify (Extensions → Neon) and remove these variables.');
  }
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(path.join(DIST, '_pd'), { recursive: true });
  await fs.copyFile(path.join(ROOT, 'src', 'render.mjs'), path.join(DIST, '_pd', 'render.mjs'));

  const programs = await loadPrograms();
  const copied = new Set();
  const manifest = [];

  for (const prog of programs) {
    if (!SLUG_RE.test(prog.slug || '')) { console.warn(`Skipping invalid slug: ${prog.slug}`); continue; }
    const data = await localiseMedia(prog.data, copied);
    const dir = path.join(DIST, 'programs', prog.slug);
    await fs.mkdir(dir, { recursive: true });

    const seo = seoFor(data, { slug: prog.slug, canonicalBase: CANONICAL_BASE });
    await fs.writeFile(path.join(dir, 'index.html'), renderStandalone(data, { slug: prog.slug }));
    await fs.writeFile(path.join(dir, 'fragment.json'), JSON.stringify({
      slug: prog.slug,
      publishedAt: prog.publishedAt || null,
      title: seo.title,
      description: seo.description,
      canonical: seo.canonical,
      ogImage: seo.ogImage,
      css: PROGRAM_CSS,
      html: renderProgram(data),
      jsonLd: jsonLd(data, { slug: prog.slug, canonicalBase: CANONICAL_BASE }),
    }));
    manifest.push({ slug: prog.slug, name: data.name, publishedAt: prog.publishedAt || null });
  }

  await fs.writeFile(path.join(DIST, '_pd', 'manifest.json'), JSON.stringify({ builtAt: new Date().toISOString(), programs: manifest }, null, 2));
  await fs.writeFile(path.join(DIST, 'index.html'),
    `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Pacific Discovery program pages</title>` +
    `<p>Program page origin. Live pages are served at <a href="https://www.pacificdiscovery.org/programs">pacificdiscovery.org/programs</a>.</p>`);
  console.log(`Built ${manifest.length} program page(s), ${copied.size} media file(s).`);
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
