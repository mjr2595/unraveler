/**
 * Behavioural tests for src/content/expander.js, run against a DOM mock.
 * The real engine source is eval'd — no reimplementation.
 */

import { readFileSync } from 'node:fs';
import { El, document as doc, body, install, resetDom, windowMock } from './dom-mock.js';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

install(globalThis);

// Load the real source files into the global scope, mirroring how Chrome
// evaluates content_scripts declared in one manifest entry.
const src =
  readFileSync(`${ROOT}/src/shared/defaults.js`, 'utf8') + '\n' +
  readFileSync(`${ROOT}/src/content/expander.js`, 'utf8');
(0, eval)(src);

const Engine = globalThis.UnravelerEngine;

const CFG = {
  ...globalThis.UNRAVELER_DEFAULTS,
  settleMs: 15,
  maxSettleMs: 250,
  maxClicks: 40,
  maxDurationMs: 15000,
  debug: false
};

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' :: ' + detail : ''}`); }
}

const LOAD_MORE = 'issue.activity.common.component.load-more-button.loading-button';
const SHOW_REPLIES = 'issue-view-activity-comment.comment-show-more-replies.show-more-button';
const HISTORY_WRAP = 'issue-history.ui.history-items.load-more-button';

function feed() {
  const f = new El('div', { 'data-testid': 'issue.activity.feed' });
  body.append(f);
  return f;
}

function addComments(container, n) {
  for (let i = 0; i < n; i++) {
    container.append(new El('div', { 'data-testid': 'issue.comment', id: `comment-${Math.random()}` }));
  }
}

/** A React-ish button that replaces its own node on every click. */
function makeLoadMore(container, label, onClick) {
  const btn = new El('button', { 'data-testid': LOAD_MORE }, label);
  btn.addEventListener('click', () => onClick(btn));
  container.append(btn);
  return btn;
}

// ---------------------------------------------------------------------
console.log('\n1. Paginates to completion and stops');
{
  resetDom();
  const f = feed();
  let remaining = 45;
  const spawn = () => {
    if (remaining <= 0) return;
    makeLoadMore(f, `View ${remaining} remaining comments`, (btn) => {
      const take = Math.min(10, remaining);
      remaining -= take;
      addComments(f, take);
      btn.remove();          // React swaps the node out...
      spawn();               // ...and renders a fresh one.
    });
  };
  spawn();

  const r = await Engine.run(CFG);
  check('all pages loaded', remaining === 0, `remaining=${remaining}`);
  check('reason is complete', r.reason === 'complete', r.reason);
  check('clicked exactly 5 times', r.clicks === 5, `clicks=${r.clicks}`);
  check('no buttons left', doc.querySelectorAll(`[data-testid="${LOAD_MORE}"]`).length === 0);
}

// ---------------------------------------------------------------------
console.log('\n2. JRACLOUD-94212 collapse loop terminates (the key regression)');
{
  resetDom();
  const f = feed();
  let clicks = 0;
  // Loads comments, then instantly collapses them back and re-renders an
  // IDENTICAL button as a brand-new node — the exact shape that fools any
  // "did the node disappear?" check.
  const spawn = () => {
    makeLoadMore(f, 'Show more comments', (btn) => {
      clicks++;
      const added = [];
      for (let i = 0; i < 8; i++) {
        const c = new El('div', { 'data-testid': 'issue.comment', id: `c-${clicks}-${i}` });
        added.push(c);
      }
      f.append(...added);
      btn.remove();
      added.forEach((c) => c.remove());   // collapse back
      spawn();                            // identical replacement node
    });
  };
  spawn();

  const r = await Engine.run(CFG);
  check('terminated without hitting the click cap', r.clicks < CFG.maxClicks, `clicks=${r.clicks}`);
  check('gave up after maxStrikes', r.clicks === CFG.maxStrikes, `clicks=${r.clicks}, strikes=${CFG.maxStrikes}`);
  check('reported as complete', r.reason === 'complete', r.reason);
  check('blacklisted the dud button', r.blocked === 1, `blocked=${r.blocked}`);
}

// ---------------------------------------------------------------------
console.log('\n3. Respects the click cap on an endless feed');
{
  resetDom();
  const f = feed();
  const spawn = () => {
    makeLoadMore(f, 'Show more comments', (btn) => {
      addComments(f, 5);      // always genuine progress => never strikes
      btn.remove();
      spawn();
    });
  };
  spawn();

  const r = await Engine.run({ ...CFG, maxClicks: 7 });
  check('stopped at the cap', r.clicks === 7, `clicks=${r.clicks}`);
  check('reason is max-clicks', r.reason === 'max-clicks', r.reason);
}

// ---------------------------------------------------------------------
console.log('\n4. Waits out a busy button instead of striking it');
{
  resetDom();
  const f = feed();
  const btn = new El('button', { 'data-testid': LOAD_MORE, 'aria-disabled': 'true' }, 'Show more comments');
  f.append(btn);
  let clicked = 0;
  btn.addEventListener('click', () => { clicked++; addComments(f, 3); btn.remove(); });

  setTimeout(() => btn.removeAttribute('aria-disabled'), 120);

  const r = await Engine.run(CFG);
  check('clicked once the button freed up', clicked === 1, `clicked=${clicked}`);
  check('did not click while disabled', r.clicks === 1, `clicks=${r.clicks}`);
}

// ---------------------------------------------------------------------
console.log('\n5. Resolves the history wrapper down to its inner button');
{
  resetDom();
  const f = feed();
  const wrap = new El('div', { 'data-testid': HISTORY_WRAP });
  const inner = new El('button', {}, 'Load more');
  wrap.append(inner);
  f.append(wrap);

  let innerClicks = 0, wrapClicks = 0;
  inner.addEventListener('click', () => { innerClicks++; addComments(f, 4); wrap.remove(); });
  wrap.addEventListener('click', () => { wrapClicks++; });

  const r = await Engine.run(CFG);
  check('clicked the inner <button>', innerClicks === 1, `inner=${innerClicks}`);
  check('event bubbled to the wrapper', wrapClicks === 1, `wrap=${wrapClicks}`);
  check('one click total', r.clicks === 1, `clicks=${r.clicks}`);
}

// ---------------------------------------------------------------------
console.log('\n6. Text fallback engages when testids are renamed');
{
  resetDom();
  const f = feed();
  // Atlassian renamed everything; only the visible label survives.
  const btn = new El('button', { 'data-testid': 'totally.different.id' }, 'Show more comments');
  f.append(btn);
  let clicked = 0;
  btn.addEventListener('click', () => { clicked++; addComments(f, 6); btn.remove(); });

  const r = await Engine.run(CFG);
  check('found it by text', clicked === 1, `clicked=${clicked}`);
  check('flagged usedFallback', r.usedFallback === true, `usedFallback=${r.usedFallback}`);
}

// ---------------------------------------------------------------------
console.log('\n7. Text fallback ignores unrelated and in-dialog buttons');
{
  resetDom();
  const f = feed();
  f.append(new El('button', {}, 'More'));              // generic overflow menu
  f.append(new El('button', {}, 'Show more fields'));  // different feature
  const dlg = new El('div', { role: 'dialog' });
  dlg.append(new El('button', {}, 'Show more comments'));
  f.append(dlg);

  const found = Engine._internals.collect(CFG);
  check('matched nothing', found.elements.length === 0, `matched=${found.elements.map((e) => e.innerText).join(' | ')}`);
}

// ---------------------------------------------------------------------
console.log('\n8. Sibling reply buttons get independent signatures');
{
  resetDom();
  const f = feed();
  const mk = (id) => {
    const thread = new El('div', { id });
    const b = new El('button', { 'data-testid': SHOW_REPLIES }, 'Show more replies');
    thread.append(b);
    f.append(thread);
    return b;
  };
  const a = mk('comment-100');
  const b = mk('comment-200');

  const sigA = Engine._internals.signatureOf(a);
  const sigB = Engine._internals.signatureOf(b);
  check('signatures differ per thread', sigA !== sigB, `${sigA} vs ${sigB}`);
  check('signature anchors to comment id', sigA.includes('comment-100'), sigA);
}

// ---------------------------------------------------------------------
console.log('\n9. Blacklisting one dud reply button leaves siblings clickable');
{
  resetDom();
  const f = feed();
  // Thread A is broken (collapses back). Thread B works.
  const tA = new El('div', { id: 'comment-A' });
  f.append(tA);
  const spawnA = () => {
    const b = new El('button', { 'data-testid': SHOW_REPLIES }, 'Show more replies');
    b.addEventListener('click', () => { b.remove(); spawnA(); });  // no net change
    tA.append(b);
  };
  spawnA();

  const tB = new El('div', { id: 'comment-B' });
  f.append(tB);
  let bClicks = 0;
  const bBtn = new El('button', { 'data-testid': SHOW_REPLIES }, 'Show more replies');
  bBtn.addEventListener('click', () => { bClicks++; addComments(f, 3); bBtn.remove(); });
  tB.append(bBtn);

  const r = await Engine.run(CFG);
  check('working sibling still expanded', bClicks === 1, `bClicks=${bClicks}`);
  check('only the dud was blacklisted', r.blocked === 1, `blocked=${r.blocked}`);
  check('terminated cleanly', r.reason === 'complete', r.reason);
}

// ---------------------------------------------------------------------
console.log('\n10. shiftClick propagates to the dispatched event');
{
  resetDom();
  const f = feed();
  const btn = new El('button', { 'data-testid': LOAD_MORE }, 'Show more comments');
  f.append(btn);
  let sawShift = null;
  btn.addEventListener('click', (ev) => { sawShift = ev.shiftKey; addComments(f, 2); btn.remove(); });

  await Engine.run({ ...CFG, shiftClick: true });
  check('shiftKey set on click', sawShift === true, `shiftKey=${sawShift}`);
}

// ---------------------------------------------------------------------
console.log('\n11. Disabled feature groups are not touched');
{
  resetDom();
  const f = feed();
  const wrap = new El('div', { 'data-testid': HISTORY_WRAP });
  wrap.append(new El('button', {}, 'Load more'));
  f.append(wrap);

  const found = Engine._internals.collect({ ...CFG, expandHistory: false, textFallback: false });
  check('history skipped when disabled', found.elements.length === 0, `matched=${found.elements.length}`);

  const found2 = Engine._internals.collect({ ...CFG, expandHistory: true, textFallback: false });
  check('history found when enabled', found2.elements.length === 1, `matched=${found2.elements.length}`);
}

// ---------------------------------------------------------------------
console.log('\n12. Scroll position restored after a jump-to-top');
{
  resetDom();
  const f = feed();
  const btn = new El('button', { 'data-testid': LOAD_MORE }, 'Show more comments');
  f.append(btn);
  windowMock.scrollY = 4200;
  let restoredTo = null;
  windowMock.scrollTo = (opts) => { restoredTo = opts.top; };
  btn.addEventListener('click', () => { windowMock.scrollY = 0; addComments(f, 5); btn.remove(); });

  await Engine.run(CFG);
  check('restored prior scrollY', restoredTo === 4200, `restoredTo=${restoredTo}`);
  windowMock.scrollY = 0;
  windowMock.scrollTo = () => {};
}

// ---------------------------------------------------------------------
console.log('\n13. Invalid user selector does not abort the run');
{
  resetDom();
  const f = feed();
  const btn = new El('button', { 'data-testid': LOAD_MORE }, 'Show more comments');
  f.append(btn);
  let clicked = 0;
  btn.addEventListener('click', () => { clicked++; addComments(f, 2); btn.remove(); });

  const r = await Engine.run({ ...CFG, extraSelectors: '[[[not a selector' });
  check('still expanded', clicked === 1, `clicked=${clicked}`);
  check('finished normally', r.reason === 'complete', r.reason);
}

// ---------------------------------------------------------------------
console.log('\n14. No-op on a page with nothing to expand');
{
  resetDom();
  feed();
  const r = await Engine.run(CFG);
  check('zero clicks', r.clicks === 0, `clicks=${r.clicks}`);
  check('reason is complete', r.reason === 'complete', r.reason);
}

console.log(`\n${'='.repeat(46)}`);
console.log(`${pass} passed, ${fail} failed`);
console.log('='.repeat(46));
process.exit(fail ? 1 : 0);
