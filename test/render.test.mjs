// node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import {
  renderProgram, renderStandalone, jsonLd, safeUrl, esc, normalizeProgram, blankProgram,
  dateRange, findPlaceholders, slugify, setPath, getPath, SCHEMA, SECTIONS, videoEmbed,
} from '../src/render.mjs';

const sample = JSON.parse(fs.readFileSync(new URL('../sample/south-america-gap-semester.json', import.meta.url)));

test('escapes text and attributes everywhere', () => {
  const p = blankProgram('<script>alert(1)</script>');
  p.hero.intro = '"><img src=x onerror=alert(1)>';
  p.why.items = [{ title: '<b>x</b>', body: 'ok', image: 'https://x.test/a.jpg" onerror="alert(1)', imageAlt: '"><svg onload=1>' }];
  const html = renderProgram(p);
  assert.ok(!html.includes('<script>alert'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<b>x</b>'));
  assert.ok(!/onerror="alert/.test(html));
  assert.ok(!html.includes('<svg onload'));
});

test('safeUrl allows only http(s), mailto, tel, relative and anchors', () => {
  assert.equal(safeUrl('javascript:alert(1)'), '#');
  assert.equal(safeUrl(' JaVaScRiPt:alert(1)'), '#');
  assert.equal(safeUrl('data:text/html,hi'), '#');
  assert.equal(safeUrl('//evil.test'), '#');
  assert.equal(safeUrl('https://www.pacificdiscovery.org/apply'), 'https://www.pacificdiscovery.org/apply');
  assert.equal(safeUrl('/apply'), '/apply');
  assert.equal(safeUrl('#dates'), '#dates');
  assert.equal(safeUrl('mailto:info@pacificdiscovery.org'), 'mailto:info@pacificdiscovery.org');
});

test('a javascript: link in content never reaches the page', () => {
  const p = normalizeProgram(sample);
  p.settings.applyUrl = 'javascript:alert(1)';
  assert.ok(!renderProgram(p).includes('javascript:'));
});

test('hidden sections are left out of the live page but kept (faded) in the editor', () => {
  const p = normalizeProgram(sample);
  p.layout.find((l) => l.key === 'faq').show = false;
  assert.ok(!renderProgram(p).includes('id="faq"'));
  const ed = renderProgram(p, { editable: true });
  assert.ok(ed.includes('data-sec="faq"'));
  assert.match(ed, /id="faq" class="pdp-sec pde-hidden"/);
});

test('the live page carries no editor hooks; the editor page does', () => {
  const live = renderProgram(sample);
  for (const a of ['data-f=', 'data-v=', 'data-img=', 'data-item=', 'data-add=', 'data-sec=', 'pde-add']) assert.ok(!live.includes(a), a);
  const ed = renderProgram(sample, { editable: true });
  for (const a of ['data-f="hero.headline"', 'data-v="facts.tuition"', 'data-img="hero.image"', 'data-item="itinerary.weeks.0"', 'data-add="faq.items"']) assert.ok(ed.includes(a), a);
});

test('itinerary and FAQ use <details> live (no JS needed) but plain blocks in the editor', () => {
  assert.ok(renderProgram(sample).includes('<details open><summary class="pdp-week__sum">'));
  assert.ok(!renderProgram(sample, { editable: true }).includes('<details'));
});

test('order follows layout', () => {
  const p = normalizeProgram(sample);
  const faq = p.layout.findIndex((l) => l.key === 'faq');
  const [item] = p.layout.splice(faq, 1);
  p.layout.unshift(item);
  const html = renderProgram(p);
  assert.ok(html.indexOf('id="faq"') < html.indexOf('id="why"'));
});

test('closed and full sessions get no Apply link; spots left shows', () => {
  const p = normalizeProgram(sample);
  p.dates.sessions = [
    { start: '2027-02-11', end: '2027-04-21', season: 'Spring', status: 'Full', spotsLeft: '', applyUrl: '' },
    { start: '2027-09-09', end: '2027-11-17', season: 'Fall', status: 'Limited spots', spotsLeft: 3, applyUrl: '' },
  ];
  const html = renderProgram(p);
  assert.ok(html.includes('aria-disabled="true">Full<'));
  assert.ok(html.includes('Limited spots · 3 spots left'));
  // Sticky bar skips the full session
  assert.ok(html.includes('Next start Sep 9, 2027'));
});

test('JSON-LD cannot break out of its script tag', () => {
  const p = normalizeProgram(sample);
  p.name = '</script><script>alert(1)</script>';
  const ld = jsonLd(p, { slug: 'x' });
  assert.ok(!ld.includes('</script>'));
  JSON.parse(ld.replace(/\\u003c/g, '<'));
});

test('standalone page: canonical to www, noindex', () => {
  const html = renderStandalone(sample, { slug: 'south-america-gap-semester' });
  assert.ok(html.includes('<link rel="canonical" href="https://www.pacificdiscovery.org/programs/south-america-gap-semester">'));
  assert.ok(html.includes('<meta name="robots" content="noindex">'));
  assert.ok(html.includes('application/ld+json'));
});

test('normalizeProgram fills missing sections and repairs layout', () => {
  const p = normalizeProgram({ name: 'X', layout: [{ key: 'faq', show: false }, { key: 'nope' }, { key: 'faq' }] });
  assert.equal(p.layout.length, SECTIONS.length);
  assert.equal(p.layout[0].key, 'faq');
  assert.equal(p.layout[0].show, false);
  assert.ok(Array.isArray(p.itinerary.weeks));
  assert.equal(p.settings.currency, 'USD');
});

test('every list in SCHEMA has a blank that renders', () => {
  const p = blankProgram('T');
  for (const [lp, def] of Object.entries(SCHEMA.lists)) {
    const list = getPath(p, lp);
    assert.ok(Array.isArray(list), lp);
    setPath(p, lp, [structuredClone(def.blank)]);
  }
  const html = renderProgram(p, { editable: true });
  for (const lp of Object.keys(SCHEMA.lists)) assert.ok(html.includes(`data-item="${lp}.0"`), lp);
});

test('helpers', () => {
  assert.equal(dateRange('2027-02-11', '2027-04-21'), '11 Feb – 21 Apr 2027');
  assert.equal(dateRange('2026-12-01', '2027-02-01'), '1 Dec 2026 – 1 Feb 2027');
  assert.equal(slugify('Mexico, Costa Rica & Guatemala'), 'mexico-costa-rica-and-guatemala');
  assert.equal(esc('<a "b">'), '&lt;a &quot;b&quot;&gt;');
  assert.equal(videoEmbed('https://youtu.be/dQw4w9WgXcQ'), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(videoEmbed('https://evil.test/x'), '');
  assert.ok(findPlaceholders(sample).length > 0);
  assert.equal(findPlaceholders({ a: 'Fine text', b: ['[Fill me]'] }).length, 1);
});

test('sample build writes page, fragment, template and manifest', () => {
  execFileSync(process.execPath, ['scripts/build.mjs', '--sample'], { cwd: new URL('..', import.meta.url) });
  const dir = new URL('../dist/', import.meta.url);
  const frag = JSON.parse(fs.readFileSync(new URL('programs/south-america-gap-semester/fragment.json', dir)));
  assert.equal(frag.slug, 'south-america-gap-semester');
  assert.ok(frag.html.startsWith('<div class="pdp">'));
  assert.ok(frag.css.includes('.pdp{'));
  assert.ok(fs.existsSync(new URL('_pd/render.mjs', dir)));
  assert.equal(JSON.parse(fs.readFileSync(new URL('_pd/manifest.json', dir))).programs.length, 1);
});
