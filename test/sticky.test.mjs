import test from 'node:test';
import assert from 'node:assert/strict';
import { stickyCss } from '../cloudflare/worker.js';

test('sticky bar sits under the header at both header heights', () => {
  assert.equal(stickyCss({ STICKY_TOP: '60px', STICKY_TOP_WIDE: '90px', STICKY_WIDE_FROM: '1025px' }),
    '.pdp{--pdp-sticky-top:60px}@media (min-width:1025px){.pdp{--pdp-sticky-top:90px}}');
});
test('one value still works, and the breakpoint defaults to the site\'s', () => {
  assert.equal(stickyCss({ STICKY_TOP: '80px' }), '.pdp{--pdp-sticky-top:80px}');
  assert.equal(stickyCss({ STICKY_TOP: '60px', STICKY_TOP_WIDE: '90px' }),
    '.pdp{--pdp-sticky-top:60px}@media (min-width:1025px){.pdp{--pdp-sticky-top:90px}}');
});
test('nothing but pixel values gets into the page', () => {
  assert.equal(stickyCss({ STICKY_TOP: '60px}</style><script>', STICKY_TOP_WIDE: 'calc(1px)' }), '.pdp{--pdp-sticky-top:0px}');
  assert.equal(stickyCss({}), '.pdp{--pdp-sticky-top:0px}');
});
