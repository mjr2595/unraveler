/**
 * Behavioural tests for src/content/latest.js, run against the DOM mock.
 * The real source is eval'd — no reimplementation.
 */

import { readFileSync } from 'node:fs';
import { El, body, install, resetDom, windowMock } from './dom-mock.js';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

install(globalThis);

const src =
  readFileSync(`${ROOT}/src/shared/defaults.js`, 'utf8') + '\n' +
  readFileSync(`${ROOT}/src/content/latest.js`, 'utf8');
(0, eval)(src);

const Latest = globalThis.UnravelerLatest;
const CFG = { ...globalThis.UNRAVELER_DEFAULTS, debug: false };

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' :: ' + detail : ''}`); }
}

// A comment shaped like current Jira Cloud: outer componentid wrapper around a
// comment-base-item span, both carrying the numeric id.
function wrap(n, times = []) {
  const w = new El('div', { 'data-componentid': `issue-comment-base.ui.comment.comment-in-view-wrapper.${n}` });
  const item = new El('span', { 'data-testid': `comment-base-item-${n}` });
  times.forEach((dt) => item.append(new El('time', { datetime: dt })));
  w.append(item);
  body.append(w);
  return w;
}

/** A comment matched by selector but carrying no parseable numeric id. */
function idless(times = []) {
  const item = new El('span', { 'data-testid': 'comment-base-item-x' });
  times.forEach((dt) => item.append(new El('time', { datetime: dt })));
  body.append(item);
  return item;
}

// ---------------------------------------------------------------------
console.log('\n1. Newest = highest comment id, not document position');
{
  resetDom();
  wrap(1399264);
  const newest = wrap(1421857);   // middle of the DOM, highest id
  wrap(1410044);

  const found = Latest.findLatest(CFG);
  check('picked the highest comment id', found === newest,
    `got ${found && found.getAttribute('data-componentid')}`);
}

// ---------------------------------------------------------------------
console.log('\n2. Reads the id from comment-base-item when no wrapper is present');
{
  resetDom();
  const mk = (n) => { const e = new El('span', { 'data-testid': `comment-base-item-${n}` }); body.append(e); return e; };
  mk(150000);
  const newest = mk(190000);
  mk(170000);

  const found = Latest.findLatest(CFG);
  check('picked the highest item id', found === newest, `got ${found && found.getAttribute('data-testid')}`);
}

// ---------------------------------------------------------------------
console.log('\n3. Honours the legacy comment-<n> DOM id');
{
  resetDom();
  const mk = (n) => { const e = new El('div', { id: `comment-${n}` }); body.append(e); return e; };
  mk(10);
  const newest = mk(30);
  mk(20);

  const found = Latest.findLatest(CFG);
  check('picked the highest legacy id', found === newest, `got ${found && found.id}`);
}

// ---------------------------------------------------------------------
console.log('\n4. Falls back to the newest timestamp when no id is parseable');
{
  resetDom();
  idless(['2024-01-01T10:00:00Z']);
  const newest = idless(['2024-06-01T10:00:00Z']);
  idless(['2024-03-01T10:00:00Z']);

  const found = Latest.findLatest(CFG);
  check('picked the latest <time>', found === newest);
}

// ---------------------------------------------------------------------
console.log('\n5. Falls back to document order when neither id nor time exists');
{
  resetDom();
  idless();
  idless();
  const last = idless();

  const found = Latest.findLatest(CFG);
  check('picked the last comment in the DOM', found === last);
}

// ---------------------------------------------------------------------
console.log('\n6. Comment id parsing covers every id carrier');
{
  const P = Latest._internals.parseCommentId;
  check('reads the componentid wrapper',
    P(new El('div', { 'data-componentid': 'issue-comment-base.ui.comment.comment-in-view-wrapper.1421857' })) === 1421857);
  check('reads the comment-base-item testid',
    P(new El('span', { 'data-testid': 'comment-base-item-1399264' })) === 1399264);
  check('reads the legacy comment-42 id', P(new El('div', { id: 'comment-42' })) === 42);
  check('rejects comment-add', isNaN(P(new El('div', { id: 'comment-add' }))));
}

// ---------------------------------------------------------------------
console.log('\n7. scrollToLatest scrolls the newest comment block and reports found');
{
  resetDom();
  wrap(1000005);
  const newest = wrap(1000009);

  let scrolled = null;
  El.prototype.scrollIntoView = function () { scrolled = this; };

  const r = Latest.scrollToLatest(CFG);
  check('reported found', r.found === true, JSON.stringify(r));
  check('scrolled the newest comment block', scrolled === newest,
    `scrolled ${scrolled && scrolled.getAttribute('data-componentid')}`);

  El.prototype.scrollIntoView = function () { };
}

// ---------------------------------------------------------------------
console.log('\n8. No comments on the page is a clean no-op');
{
  resetDom();
  const r = Latest.scrollToLatest(CFG);
  check('reported not found', r.found === false, JSON.stringify(r));
}

// ---------------------------------------------------------------------
console.log('\n9. Respects the master switch');
{
  resetDom();
  wrap(1000001);

  let scrolled = false;
  El.prototype.scrollIntoView = function () { scrolled = true; };

  const r = Latest.scrollToLatest({ ...CFG, enabled: false });
  check('disabled => not found', r.found === false, JSON.stringify(r));
  check('disabled => did not scroll', scrolled === false, `scrolled=${scrolled}`);

  El.prototype.scrollIntoView = function () { };
}

// ---------------------------------------------------------------------
// Scroll to top

/** A container that scrolls, currently scrolled down to `top`. */
function scroller(top, overflowY = 'auto') {
  const el = new El('div');
  el.style.overflowY = overflowY;
  el.scrollHeight = 5000;
  el.clientHeight = 800;
  el.scrollTop = top;
  return el;
}

/** Stub window.scrollTo for one test; returns the list of recorded calls. */
function spyWindowScroll(scrollY) {
  const calls = [];
  windowMock.scrollY = scrollY;
  windowMock.scrollTo = (opts) => { calls.push(opts); };
  return calls;
}

function restoreWindowScroll() {
  windowMock.scrollY = 0;
  windowMock.scrollTo = () => { };
}

console.log('\n10. scrollToTop scrolls every container the issue scrolls in, then the page');
{
  resetDom();
  const page = scroller(1200);
  const panel = scroller(900, 'scroll');
  const heading = new El('h1', { 'data-testid': 'issue.views.issue-base.foundation.summary.heading' });
  panel.append(heading);
  page.append(panel);
  body.append(page);

  // A scrolled container that is not around the issue (e.g. a board column).
  const unrelated = scroller(700);
  body.append(unrelated);

  const calls = spyWindowScroll(300);
  const r = Latest.scrollToTop(CFG);

  check('reported scrolled', r.scrolled === true, JSON.stringify(r));
  check('inner panel at the top', panel.scrollTop === 0, `scrollTop=${panel.scrollTop}`);
  check('outer container at the top', page.scrollTop === 0, `scrollTop=${page.scrollTop}`);
  check('scrolled smoothly', panel.lastScrollBehavior === 'smooth', panel.lastScrollBehavior);
  check('page scrolled to the top', calls.length === 1 && calls[0].top === 0, JSON.stringify(calls));
  check('left unrelated containers alone', unrelated.scrollTop === 700, `scrollTop=${unrelated.scrollTop}`);

  restoreWindowScroll();
}

console.log('\n11. scrollToTop ignores scrolled ancestors that are not scroll containers');
{
  resetDom();
  const clipped = scroller(400, 'hidden');   // overflow:hidden — not user-scrollable
  const heading = new El('h1', { 'data-testid': 'issue.views.issue-base.foundation.summary.heading' });
  clipped.append(heading);
  body.append(clipped);

  spyWindowScroll(0);
  const r = Latest.scrollToTop(CFG);
  check('nothing to scroll', r.scrolled === false, JSON.stringify(r));
  check('overflow:hidden container untouched', clipped.scrollTop === 400, `scrollTop=${clipped.scrollTop}`);

  restoreWindowScroll();
}

console.log('\n12. scrollToTop climbs from a comment when no issue landmark matches');
{
  resetDom();
  const feedPanel = scroller(2500);
  body.append(feedPanel);
  const c = wrap(1000002);
  c.remove();
  feedPanel.append(c);

  spyWindowScroll(0);
  const r = Latest.scrollToTop(CFG);
  check('reported scrolled', r.scrolled === true, JSON.stringify(r));
  check('comment feed panel at the top', feedPanel.scrollTop === 0, `scrollTop=${feedPanel.scrollTop}`);

  restoreWindowScroll();
}

console.log('\n13. scrollToTop is a clean no-op when already at the top');
{
  resetDom();
  const panel = scroller(0);
  panel.append(new El('h1', { 'data-testid': 'issue.views.issue-base.foundation.summary.heading' }));
  body.append(panel);

  const calls = spyWindowScroll(0);
  const r = Latest.scrollToTop(CFG);
  check('reported not scrolled', r.scrolled === false, JSON.stringify(r));
  check('did not touch the page scroll', calls.length === 0, JSON.stringify(calls));

  restoreWindowScroll();
}

console.log('\n14. scrollToTop respects the master switch');
{
  resetDom();
  const panel = scroller(900);
  panel.append(new El('h1', { 'data-testid': 'issue.views.issue-base.foundation.summary.heading' }));
  body.append(panel);

  const calls = spyWindowScroll(300);
  const r = Latest.scrollToTop({ ...CFG, enabled: false });
  check('disabled => not scrolled', r.scrolled === false, JSON.stringify(r));
  check('disabled => panel untouched', panel.scrollTop === 900, `scrollTop=${panel.scrollTop}`);
  check('disabled => page untouched', calls.length === 0, JSON.stringify(calls));

  restoreWindowScroll();
}

console.log(`\n${'='.repeat(46)}`);
console.log(`${pass} passed, ${fail} failed`);
console.log('='.repeat(46));
process.exit(fail ? 1 : 0);
