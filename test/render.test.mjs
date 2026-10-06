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
    { start: '2000-01-10', end: '2000-03-20', season: 'Spring', status: 'Open', spotsLeft: '', applyUrl: '' },
    { start: '2099-02-11', end: '2099-04-21', season: 'Spring', status: 'Full', spotsLeft: '', applyUrl: '' },
    { start: '2099-09-09', end: '2099-11-17', season: 'Fall', status: 'Limited spots', spotsLeft: 3, applyUrl: '' },
  ];
  const html = renderProgram(p);
  assert.ok(html.includes('aria-disabled="true">Full<'));
  assert.ok(html.includes('Limited spots · 3 spots left'));
  assert.ok(!html.includes('10 Jan – 20 Mar 2000'), 'past session dropped from the live list');
  // Hero "Next departure" skips past and full sessions
  // Next departure sits in the sticky bar, before Apply now
  assert.match(html, /<div class="pdp-bar__cta"><a class="pdp-next" href="https:\/\/www\.pacificdiscovery\.org\/apply" aria-label="Apply for the 9 Sep – 17 Nov 2099 departure"><span class="pdp-next__label">Next departure<\/span><span class="pdp-next__when">9 Sep 2099<\/span><span class="pdp-pill pdp-next__pill">3 spots left<\/span><\/a><a class="pdp-btn"/);
  assert.ok(!html.slice(0, html.indexOf('pdp-bar')).includes('pdp-next'), 'not in the hero');
  p.dates.sessions[2].applyUrl = 'https://www.pacificdiscovery.org/apply?program=sa-fall-2099';
  assert.ok(renderProgram(p).includes('class="pdp-next" href="https://www.pacificdiscovery.org/apply?program=sa-fall-2099"'), "uses the session's own apply link");
  // The old price/date line in the sticky bar is gone
  assert.ok(!html.includes('Next start') && !html.includes('pdp-bar__meta'));
  // Editor keeps past sessions so they can be edited or removed, and links the card to its row
  const ed = renderProgram(p, { editable: true });
  assert.ok(ed.includes('data-item="dates.sessions.0"'));
  assert.ok(ed.includes('data-ref-item="dates.sessions.2"'));
  p.dates.sessions = [];
  assert.ok(!renderProgram(p).includes('pdp-next'), 'no card without a future date');
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
  const n = fs.readdirSync(new URL('../sample/', import.meta.url)).filter((f) => f.endsWith('.json')).length;
  assert.equal(JSON.parse(fs.readFileSync(new URL('_pd/manifest.json', dir))).programs.length, n);
  for (const s of ['australia-bali-gap-semester', 'southeast-asia-gap-semester', 'polynesian-journey-gap-semester']) assert.ok(fs.existsSync(new URL(`programs/${s}/index.html`, dir)), s);
});

test('review badges: stars for /5, percent for %, link only when set, old line migrated', async () => {
  const { parseScore } = await import('../src/render.mjs');
  assert.deepEqual(parseScore('4.5'), { value: 4.5, max: 5, pct: 90 });
  assert.deepEqual(parseScore('4.5/5'), { value: 4.5, max: 5, pct: 90 });
  assert.equal(parseScore('98%').max, 100);
  assert.equal(parseScore('great'), null);

  const p = normalizeProgram(sample);
  p.hero.reviews = [
    { source: 'GoAbroad', score: '4.5', count: 295, url: 'https://www.goabroad.com/x' },
    { source: 'GoOverseas', score: '98%', count: 30, url: '' },
  ];
  const html = renderProgram(p);
  assert.ok(html.includes('<a class="pdp-review" href="https://www.goabroad.com/x"'));
  assert.ok(html.includes('style="width:90%"'), 'stars filled to 90%');
  assert.ok(html.includes('295 reviews') && html.includes('on GoAbroad'));
  assert.ok(html.includes('98%</span>') && html.includes('30 reviews') && html.includes('on GoOverseas'));
  assert.ok(html.includes('4.5 out of 5 from 295 reviews on GoAbroad'), 'screen-reader text');
  assert.equal((html.match(/<a class="pdp-review"/g) || []).length, 1, 'no link without a URL');

  const ed = renderProgram(p, { editable: true });
  assert.ok(ed.includes('data-item="hero.reviews.1"') && ed.includes('data-add="hero.reviews"'));

  const old = normalizeProgram({ name: 'X', hero: { reviewText: '★ 4.9 on GoAbroad', reviewUrl: 'https://x.test' } });
  assert.equal(old.hero.reviews.length, 1);
  assert.equal(old.hero.reviews[0].url, 'https://x.test');
  assert.ok(!('reviewText' in old.hero));

  p.hero.reviews = [{ source: 'GoAbroad', score: '"><script>x</script>', count: 1, url: 'javascript:alert(1)' }];
  const bad = renderProgram(p);
  assert.ok(!bad.includes('<script>x') && !bad.includes('javascript:'));
});

test('live review widgets: parsed, rebuilt from safe fields, never pasted raw', async () => {
  const { parseWidget } = await import('../src/render.mjs');
  const ga = '<iframe style="border:none;height:84px;overflow:auto;width:352px;" src="https://www.goabroad.com/reviews/generator/provider/5491/0/352/84/0/0?layout_type=2&amp;theme=light" frameborder="0"></iframe>';
  const go = '<div class="go-overseas-review-widget-component widget-programshort" data-gooverseas-widget-type="program" data-gooverseas-widget-id="43632" data-gooverseas-widget-name="programshort" data-gooverseas-widget-theme="primary" data-gooverseas-widget-link="yes"></div><script>evil()</script>';
  assert.deepEqual(parseWidget({ type: 'GoAbroad', code: ga }), { kind: 'goabroad', src: 'https://www.goabroad.com/reviews/generator/provider/5491/0/352/84/0/0?layout_type=2&theme=light', width: 352, height: 84 });
  assert.equal(parseWidget({ type: 'GoOverseas', code: go }).id, '43632');
  assert.equal(parseWidget({ type: 'GoOverseas', code: '43632' }).id, '43632');
  assert.equal(parseWidget({ type: 'Google', code: 'ChIJN1t_tDeuEmsRUsoyG83frY4' }).placeId, 'ChIJN1t_tDeuEmsRUsoyG83frY4');
  assert.equal(parseWidget({ type: 'GoAbroad', code: '<iframe src="https://evil.test/x">' }), null);
  assert.equal(parseWidget({ type: 'GoOverseas', code: 'data-gooverseas-widget-id="1 onload=x"' }), null);
  assert.equal(parseWidget({ type: 'GoOverseas', code: 'data-gooverseas-widget-id="5" data-gooverseas-widget-name="x\\" onclick=\\"y"' }).name, 'programshort');

  const p = normalizeProgram(sample);
  p.hero.widgets = [{ type: 'GoAbroad', code: ga }, { type: 'GoOverseas', code: go },
    { type: 'Google', code: 'ChIJN1t_tDeuEmsRUsoyG83frY4', _google: { rating: 4.84, count: 1234, url: 'https://maps.google.com/?cid=1' } }];
  const html = renderProgram(p);
  assert.ok(html.includes('<iframe class="pdp-widget__frame" src="https://www.goabroad.com/reviews/generator/provider/5491/0/352/84/0/0?layout_type=2&amp;theme=light"'));
  assert.ok(html.includes('data-gooverseas-widget-id="43632"'));
  assert.equal((html.match(/gooverseas\.com\/static\/0\.2\.0\/main\.min\.js/g) || []).length, 1, 'loader once');
  assert.ok(!html.includes('evil()'), 'pasted script never output');
  assert.ok(html.includes('4.8</span>') && html.includes('1,234 reviews') && html.includes('on Google'));

  const ed = renderProgram(p, { editable: true });
  assert.ok(!ed.includes('main.min.js'), 'no third-party script in the editor');
  assert.ok(ed.includes('GoOverseas reviews widget #43632'));
  assert.ok(ed.includes('pde-cover'));

  p.hero.widgets = [{ type: 'Google', code: 'ChIJN1t_tDeuEmsRUsoyG83frY4' }];
  assert.ok(!renderProgram(p).includes('pdp-widget'), 'Google without fetched data renders nothing live');
  assert.ok(!renderProgram(p).includes('main.min.js'));
});

test('reviews section takes GoAbroad / GoOverseas widgets too', async () => {
  const ga = '<iframe style="border:none;height:500px;overflow:auto;width:400px;" src="https://www.goabroad.com/reviews/generator/provider/5491/0/400/500/0/0?layout_type=1&amp;theme=light"></iframe>';
  const go = '<div class="go-overseas-review-widget-component widget-programlong" data-gooverseas-widget-type="program" data-gooverseas-widget-id="43632" data-gooverseas-widget-name="programlong" data-gooverseas-widget-theme="primary" data-gooverseas-widget-link="yes"></div><script>evil()</script>';
  const p = normalizeProgram({ ...sample, hero: { ...sample.hero, widgets: [] }, reviews: { ...sample.reviews, widgets: [{ type: 'GoAbroad', code: ga }, { type: 'GoOverseas', code: go }] } });
  const html = renderProgram(p);
  const sec = html.slice(html.indexOf('id="reviews"'), html.indexOf('</section>', html.indexOf('id="reviews"')));
  assert.ok(sec.includes('pdp-widgets-wrap--reviews'));
  assert.ok(sec.includes('width="400" height="500"'));
  assert.ok(sec.includes('data-gooverseas-widget-name="programlong"'));
  assert.equal((html.match(/main\.min\.js/g) || []).length, 1, 'loader added for a reviews-section GoOverseas widget');
  assert.ok(!html.includes('evil()'));
  // Old pages without the field still render, and the editor shows the add button.
  const old = normalizeProgram({ ...sample, reviews: { heading: 'x', quotes: [] } });
  assert.deepEqual(old.reviews.widgets, []);
  assert.ok(renderProgram(old, { editable: true }).includes('Add a GoAbroad or GoOverseas widget'));
  assert.ok(!renderProgram(old).includes('pdp-widgets-wrap--reviews'));
});

test('hero photo focus: separate phone and computer positions, validated', async () => {
  const { parseFocus } = await import('../src/render.mjs');
  assert.equal(parseFocus('30% 20%'), '30% 20%');
  assert.equal(parseFocus('130% -5%'), '');
  assert.equal(parseFocus('150% 40%'), '100% 40%');
  assert.equal(parseFocus('50%;background:url(x)'), '');
  const p = normalizeProgram({ ...sample, hero: { ...sample.hero, imageFocus: '40% 30%', imageFocusMobile: '72% 25%' } });
  const html = renderProgram(p);
  assert.ok(html.includes('style="--pdp-pos:40% 30%;--pdp-pos-m:72% 25%;"'));
  const { PROGRAM_CSS: css } = await import('../src/render.mjs');
  assert.ok(css.includes('object-position:var(--pdp-pos-m,var(--pdp-pos,50% 50%))'));
  const bad = renderProgram(normalizeProgram({ ...sample, hero: { ...sample.hero, imageFocus: '"><script>x</script>' } }));
  assert.ok(!bad.includes('<script>x') && !bad.includes('--pdp-pos:'));
});

test('testimonials: quote marks added by the page, typed ones stripped', async () => {
  const { stripQuotes } = await import('../src/render.mjs');
  assert.equal(stripQuotes('“Best trip ever.”'), 'Best trip ever.');
  assert.equal(stripQuotes('"Best trip ever."'), 'Best trip ever.');
  assert.equal(stripQuotes("It's great"), "It's great");
  const p = normalizeProgram({ ...sample, reviews: { ...sample.reviews, quotes: [{ quote: '"Life changing."', name: 'Maya, Spring 2026' }, { quote: '', name: '' }] } });
  const html = renderProgram(p);
  const sec = html.slice(html.indexOf('id="reviews"'), html.indexOf('</section>', html.indexOf('id="reviews"')));
  assert.ok(sec.includes('<p class="pdp-quote__text pdp-ml">Life changing.</p>'));
  assert.equal((sec.match(/pdp-quote-card/g) || []).length, 1, 'empty quote dropped on the live page');
  assert.ok(sec.includes('“') && sec.includes('”'));
  assert.ok(sec.includes('Maya, Spring 2026'));
});

test('tuition promotion: price slash, message, or both; expires on its own', async () => {
  const { activePromo, jsonLd: ld } = await import('../src/render.mjs');
  const mk = (facts) => normalizeProgram({ ...sample, facts: { ...sample.facts, tuition: 15500, ...facts } });
  const facts = (h) => h.slice(h.indexOf('pdp-facts'), h.indexOf('</div></div>', h.indexOf('pdp-facts')));

  const both = renderProgram(mk({ promoPrice: 14500, promoText: 'Save $1,000 when you apply by Dec 1', promoEnds: '2999-12-01' }));
  assert.ok(facts(both).includes('<s class="pdp-price__was"><span class="pdp-sr">Was </span>$15,500</s>'));
  assert.ok(facts(both).includes('$14,500') && facts(both).includes('Save $1,000 when you apply by Dec 1'));
  assert.ok(both.includes('about $1,450 per week'), 'weekly figure uses the promo price');
  assert.ok(ld(mk({ promoPrice: 14500, promoEnds: '2999-12-01' })).includes('"price":14500'));

  const textOnly = renderProgram(mk({ promoText: 'Early-bird bonus: free gear pack' }));
  assert.ok(!facts(textOnly).includes('pdp-price__was') && facts(textOnly).includes('free gear pack'));

  assert.equal(activePromo(mk({ promoPrice: 16000 })), null, 'a "promo" above tuition is ignored');

  const ended = mk({ promoPrice: 14500, promoText: 'Ended deal', promoEnds: '2000-01-01' });
  assert.ok(!renderProgram(ended).includes('Ended deal') && !renderProgram(ended).includes('pdp-price__was'));
  assert.ok(ld(ended).includes('"price":15500'));
  assert.ok(renderProgram(ended, { editable: true }).includes('Promotion ended'));
  assert.ok(!renderProgram(mk({ promoText: '<b>x</b>' })).includes('<b>x</b>'));
});
