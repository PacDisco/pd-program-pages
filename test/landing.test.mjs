// node --test test/  — the landing page template ("Why Pacific Discovery" style pages)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  renderLanding, renderPage, renderStandalone, blankLanding, normalizeLanding, landingJsonLd, landingSeo,
  templateOf, TEMPLATES, LANDING_SCHEMA, LANDING_SECTIONS, findPlaceholders, renderProgram, blankProgram,
} from '../src/render.mjs';
import { SLUG_RE } from '../cloudflare/worker.js';

const sample = JSON.parse(fs.readFileSync(new URL('../sample/why-pacific-discovery.json', import.meta.url)));

test('templateOf: landing only when asked, programs by default', () => {
  assert.equal(templateOf(sample), 'landing');
  assert.equal(templateOf(blankProgram('x')), 'program');
  assert.equal(templateOf({}), 'program');
  assert.equal(templateOf({ template: 'nope' }), 'program');
  assert.deepEqual(Object.keys(TEMPLATES), ['program', 'landing']);
});

test('renderPage dispatches to the right template', () => {
  assert.ok(renderPage(sample).startsWith('<div class="pdl"'));
  assert.ok(renderPage(blankProgram('x')).startsWith('<div class="pdp"'));
  assert.equal(renderProgram(blankProgram('x')), renderPage(blankProgram('x')));
});

test('escapes text and attributes everywhere', () => {
  const p = blankLanding('<script>alert(1)</script>');
  p.hero.headlineAccent = '"><img src=x onerror=alert(1)>';
  p.reasons.items = [{ icon: '"><svg onload=1>', title: '<b>x</b>', body: 'ok' }];
  p.week.days = [{ day: 'Mon', title: 't', image: 'https://x.test/a.jpg" onerror="alert(1)', imageAlt: '"><svg onload=1>' }];
  p.compare.col1 = '<i>c</i>'; p.compare.rows = [{ label: '<u>l</u>', us: 'u', c1: '<script>', c2: '', c3: '' }];
  p.hero.stampRing = '</textPath><script>alert(1)</script>';
  for (const html of [renderLanding(p), renderLanding(p, { editable: true }), renderStandalone(p)]) {
    assert.ok(!html.includes('<script>alert'));
    assert.ok(!html.includes('<img src=x'));
    assert.ok(!html.includes('<b>x</b>'));
    assert.ok(!html.includes('<u>l</u>'));
    assert.ok(!html.includes('onerror="alert'));
    assert.ok(!/<svg onload/.test(html));
  }
});

test('unsafe links become #', () => {
  const p = normalizeLanding(sample);
  p.settings.quizUrl = 'javascript:alert(1)';
  p.settings.applyUrl = 'data:text/html,hi';
  p.voices.ratingUrl = 'vbscript:x';
  const html = renderLanding(p);
  assert.ok(!/javascript:|data:text|vbscript:/.test(html));
});

test('no editor hooks on the live page; all of them in the editor', () => {
  const live = renderLanding(sample);
  assert.ok(!/data-(f|v|img|item|add|sec|list)=/.test(live));
  assert.ok(!live.includes('pde-'));
  const ed = renderLanding(sample, { editable: true });
  assert.ok(ed.includes('class="pdl pdp--edit"'));
  assert.ok(ed.includes('data-group="hero"'));
  for (const s of LANDING_SECTIONS) assert.ok(ed.includes(`data-sec="${s.key}"`), s.key);
  for (const lp of Object.keys(LANDING_SCHEMA.lists)) assert.ok(ed.includes(`data-add="${lp}"`), lp);
});

test('every schema field path exists in a blank page', () => {
  const b = blankLanding('x');
  const has = (path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), b) !== undefined;
  const fields = [...LANDING_SCHEMA.page.fields, ...LANDING_SCHEMA.hero.fields, ...Object.values(LANDING_SCHEMA.sections).flatMap((s) => s.fields)];
  for (const f of fields) assert.ok(has(f.k), f.k);
  for (const lp of Object.keys(LANDING_SCHEMA.lists)) assert.ok(Array.isArray(lp.split('.').reduce((o, k) => o[k], b)), lp);
});

test('hidden sections are left out live; empty optional bits disappear', () => {
  const p = normalizeLanding(sample);
  p.layout.find((l) => l.key === 'compare').show = false;
  p.compare.col3 = '';
  p.offer.title = '';
  p.hero.stampNumber = '';
  let html = renderLanding(p);
  assert.ok(!html.includes('id="compare"'));
  assert.ok(!html.includes('pdl-pass'));
  assert.ok(!html.includes('pdl-stamp'));
  p.layout.find((l) => l.key === 'compare').show = true;
  html = renderLanding(p);
  assert.ok(html.includes('--pdl-cols:2'));
  assert.ok(!html.includes('Backpacking solo'));
});

test('hero wave takes the colour of the first visible section', () => {
  const p = normalizeLanding(sample);
  assert.ok(renderLanding(p).includes('fill="#55bbd2"'));
  p.layout.find((l) => l.key === 'stats').show = false;
  const html = renderLanding(p);
  const hero = html.slice(0, html.indexOf('</header>'));
  assert.ok(hero.includes('fill="#ffffff"'));
});

test('normalizeLanding repairs old or partial pages', () => {
  const p = normalizeLanding({ template: 'landing', name: 'Old', layout: [{ key: 'faq', show: false }, { key: 'bogus' }], hero: { headline: 'Hi' } });
  assert.equal(p.layout[0].key, 'faq');
  assert.equal(p.layout[0].show, false);
  assert.equal(p.layout.length, LANDING_SECTIONS.length);
  assert.equal(p.hero.headline, 'Hi');
  assert.ok(Array.isArray(p.faq.items) && Array.isArray(p.week.days));
});

test('placeholders in the starter are found', () => {
  assert.ok(findPlaceholders(sample).some((x) => x.path.startsWith('compare.rows.')));
});

test('SEO and FAQ structured data', () => {
  const s = landingSeo(sample, { slug: 'why-pacific-discovery' });
  assert.equal(s.canonical, 'https://www.pacificdiscovery.org/lp/why-pacific-discovery');
  const ld = JSON.parse(landingJsonLd(sample));
  assert.equal(ld['@type'], 'FAQPage');
  assert.equal(ld.mainEntity.length, 4);
  const p = normalizeLanding(sample);
  p.layout.find((l) => l.key === 'faq').show = false;
  assert.equal(landingJsonLd(p), '');
  const x = normalizeLanding(sample); x.faq.items[0].a = '</script><script>alert(1)</script>';
  assert.ok(!landingJsonLd(x).includes('</script>'));
  const doc = renderStandalone(sample, { slug: 'why-pacific-discovery' });
  assert.ok(doc.includes('<link rel="canonical" href="https://www.pacificdiscovery.org/lp/why-pacific-discovery">'));
  assert.ok(doc.includes('application/ld+json'));
});

test('Worker matches program and landing addresses only', () => {
  assert.deepEqual(SLUG_RE.exec('/lp/why-pacific-discovery').slice(1), ['lp', 'why-pacific-discovery']);
  assert.deepEqual(SLUG_RE.exec('/programs/south-america-gap-semester/').slice(1), ['programs', 'south-america-gap-semester']);
  assert.equal(SLUG_RE.exec('/lp/'), null);
  assert.equal(SLUG_RE.exec('/lp/a/b'), null);
  assert.equal(SLUG_RE.exec('/other/x'), null);
});

test('sample build writes landing pages to dist/lp/', () => {
  execFileSync(process.execPath, ['scripts/build.mjs', '--sample'], { cwd: new URL('..', import.meta.url) });
  const frag = JSON.parse(fs.readFileSync(new URL('../dist/lp/why-pacific-discovery/fragment.json', import.meta.url)));
  assert.equal(frag.slug, 'why-pacific-discovery');
  assert.equal(frag.template, 'landing');
  assert.ok(frag.html.startsWith('<div class="pdl"'));
  assert.ok(frag.css.includes('.pdl{'));
  assert.ok(!frag.css.includes('.pdp{'));
  assert.ok(!fs.existsSync(new URL('../dist/programs/why-pacific-discovery', import.meta.url)));
  assert.ok(fs.existsSync(new URL('../dist/_pd/static/why-pacific-discovery/hero.jpg', import.meta.url)));
  const man = JSON.parse(fs.readFileSync(new URL('../dist/_pd/manifest.json', import.meta.url)));
  assert.equal(man.programs.find((x) => x.slug === 'why-pacific-discovery').template, 'landing');
});
