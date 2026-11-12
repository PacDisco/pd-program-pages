// node --test test/  — the info booklet form (booklet buttons on live pages)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderProgram, renderLanding, renderStandalone, isGatedBooklet, BOOKLET_ENDPOINT } from '../src/render.mjs';

const prog = () => JSON.parse(fs.readFileSync(new URL('../sample/south-america-gap-semester.json', import.meta.url)));
const land = () => JSON.parse(fs.readFileSync(new URL('../sample/why-pacific-discovery.json', import.meta.url)));
const PDF = 'https://files.example.com/booklets/south-america.pdf';

test('isGatedBooklet: real links only, not the old request page', () => {
  assert.ok(isGatedBooklet(PDF));
  assert.ok(isGatedBooklet('https://drive.google.com/file/d/abc/view'));
  assert.ok(!isGatedBooklet('https://www.pacificdiscovery.org/admissions/request-program-booklet'));
  assert.ok(!isGatedBooklet('https://www.pacificdiscovery.org/admissions/request-program-booklet/?x=1'));
  assert.ok(!isGatedBooklet('/booklet.pdf'));
  assert.ok(!isGatedBooklet('javascript:alert(1)'));
  assert.ok(!isGatedBooklet(''));
});

test('program: booklet buttons open the form and the URL never reaches the page', () => {
  const p = prog(); p.settings.bookletUrl = PDF; p.settings.callUrl = '';
  const html = renderProgram(p, { slug: 'south-america-gap-semester' });
  assert.ok(!html.includes(PDF));
  assert.equal((html.match(/href="#get-booklet" data-pd-booklet/g) || []).length, 3); // hero, itinerary, closing CTA
  assert.ok(html.includes('<dialog class="pdb" id="get-booklet"'));
  assert.ok(html.includes(`data-endpoint="${BOOKLET_ENDPOINT}"`));
  assert.ok(html.includes('data-slug="south-america-gap-semester"'));
  assert.ok(/<input id="pdb-phone" name="phone" type="tel" autocomplete="tel" required inputmode="tel">/.test(html), 'phone is required');
  assert.equal((html.match(/<\/script>/g) || []).length, (html.match(/<script>/g) || []).length);
});

test('program: endpoint can be overridden by the build', () => {
  const p = prog(); p.settings.bookletUrl = PDF;
  assert.ok(renderProgram(p, { slug: 's', bookletEndpoint: 'https://dash.test/api/booklet-request' }).includes('data-endpoint="https://dash.test/api/booklet-request"'));
});

test('landing: hero and closing booklet buttons open the form', () => {
  const p = land(); p.settings.bookletUrl = PDF;
  const html = renderLanding(p, { slug: 'why-pacific-discovery' });
  assert.ok(!html.includes(PDF));
  assert.equal((html.match(/href="#get-booklet" data-pd-booklet/g) || []).length, 2);
  assert.ok(html.includes('Get the program booklet'));
  assert.ok(renderStandalone(p, { slug: 'why-pacific-discovery' }).includes('<dialog class="pdb"'));
});

test('old request-page links, the editor and slug-less renders stay plain links', () => {
  const p = prog();
  const legacy = renderProgram(p, { slug: 'south-america-gap-semester' });
  assert.ok(!legacy.includes('data-pd-booklet') && !legacy.includes('<dialog'));
  assert.ok(legacy.includes('href="https://www.pacificdiscovery.org/admissions/request-program-booklet"'));
  p.settings.bookletUrl = PDF;
  const ed = renderProgram(p, { slug: 'x', editable: true });
  assert.ok(!ed.includes('data-pd-booklet') && !ed.includes('<dialog') && !ed.includes('<script>('));
  assert.ok(!renderProgram(p).includes('data-pd-booklet'));
});

test('program name in the form is escaped', () => {
  const p = prog(); p.settings.bookletUrl = PDF; p.name = '<img src=x onerror=alert(1)>';
  const html = renderProgram(p, { slug: 's' });
  assert.ok(!html.includes('<img src=x'));
});
