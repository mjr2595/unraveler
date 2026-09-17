/**
 * Behavioural tests for src/content/latest.js, run against the DOM mock.
 * The real source is eval'd — no reimplementation.
 */

import { readFileSync } from 'node:fs';
import { El, body, install, resetDom } from './dom-mock.js';

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

console.log(`\n${'='.repeat(46)}`);
console.log(`${pass} passed, ${fail} failed`);
console.log('='.repeat(46));
process.exit(fail ? 1 : 0);
