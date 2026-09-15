/**
 * Unraveler — expansion engine.
 *
 * Design note on why this is not a `setInterval` that marks clicked nodes:
 *
 * The common userscript approach stamps a flag onto the button element
 * (`el['data-clicked'] = true`) to avoid re-clicking it. Jira's issue view is
 * React, and React unmounts/replaces these nodes constantly. That flag either
 * evaporates (harmless) or rides along on a recycled node, permanently
 * wedging a button that then never gets clicked again.
 *
 * Instead we never trust node identity. After each click we measure whether
 * the page actually *progressed* (button consumed, item count grew, or the
 * button's own label changed). A button that fails to progress N times gets
 * blacklisted by signature. That terminates cleanly against:
 *   - JRACLOUD-94212, where loaded comments collapse back after a moment
 *   - JRASERVER-75862, issues with thousands of history entries
 */

var UnravelerEngine = (function () {
  'use strict';

  var LOG_PREFIX = '[Unraveler]';

  /**
   * Cheap proxy for "how much content is on the page". Counting matched
   * elements is far less expensive than hashing text, and it only runs once
   * per click, not per animation frame.
   */
  var CONTENT_PROBE = [
    '[data-testid*="comment"]',
    '[data-testid*="history-item"]',
    '[data-testid*="activity"]'
  ].join(',');

  var state = {
    running: false,
    cancelled: false,
    runId: 0,
    lastResult: null
  };

  function log(cfg) {
    if (!cfg || !cfg.debug) return;
    var args = Array.prototype.slice.call(arguments, 1);
    console.log.apply(console, [LOG_PREFIX].concat(args));
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // ---------------------------------------------------------------------
  // Element predicates
  // ---------------------------------------------------------------------

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    // offsetParent is null for display:none (and for position:fixed, which
    // these buttons never are), so pair it with a rect check.
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    var style = window.getComputedStyle(el);
    if (style.display === 'none') return false;
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (style.opacity === '0') return false;
    return true;
  }

  /**
   * Busy/disabled detection. The Atlassian component behind
   * `...load-more-button.loading-button` disables itself while its request is
   * in flight, so a disabled button means "wait", not "broken".
   */
  function isBusy(el) {
    if (el.disabled === true) return true;
    var ariaDisabled = el.getAttribute('aria-disabled');
    if (ariaDisabled === 'true') return true;
    if (el.getAttribute('data-is-loading') === 'true') return true;
    if (el.getAttribute('aria-busy') === 'true') return true;
    // Atlassian renders a spinner inside the button while loading.
    if (el.querySelector('[role="progressbar"], [data-testid*="spinner"]')) return true;
    return false;
  }

  /**
   * Walk from a matched element to the thing that actually handles clicks.
   *
   * The history testid sits on a wrapper div — the original userscript hard
   * codes `> button` to cope. Resolving dynamically instead means the
   * selector keeps working if Atlassian moves the attribute onto the button.
   */
  function resolveClickable(el) {
    if (!el) return null;
    var tag = el.tagName;
    if (tag === 'BUTTON' || tag === 'A') return el;
    if (el.getAttribute('role') === 'button') return el;
    var inner = el.querySelector('button, [role="button"], a[href]');
    return inner || el;
  }

  /**
   * Stable-ish identity for a button across React re-renders.
   *
   * Includes the nearest ancestor id because Jira gives comment containers
   * ids like `comment-12345`. Without that, every "Show more replies" button
   * on the page would share one signature and blacklisting one would
   * blacklist them all.
   *
   * The label is included on purpose: "View 12 remaining" -> "View 2
   * remaining" is itself the progress signal.
   */
  function signatureOf(el) {
    var testidEl = el.closest('[data-testid]');
    var testid = testidEl ? testidEl.getAttribute('data-testid') : 'no-testid';
    var idEl = el.closest('[id]');
    var anchor = idEl ? idEl.id : '';
    var label = (el.innerText || el.textContent || '').trim().slice(0, 80);
    return testid + '|' + anchor + '|' + label;
  }

  function labelOf(el) {
    return (el.innerText || el.textContent || '').trim().slice(0, 120);
  }

  function contentSize() {
    try {
      return document.querySelectorAll(CONTENT_PROBE).length;
    } catch (err) {
      return 0;
    }
  }

  // ---------------------------------------------------------------------
  // Candidate discovery
  // ---------------------------------------------------------------------

  function selectorsFor(cfg) {
    var list = [];
    if (cfg.expandComments) list = list.concat(UNRAVELER_SELECTORS.comments);
    if (cfg.expandHistory) list = list.concat(UNRAVELER_SELECTORS.history);
    if (cfg.extraSelectors) {
      cfg.extraSelectors.split('\n').forEach(function (line) {
        var trimmed = line.trim();
        if (trimmed) list.push(trimmed);
      });
    }
    return list;
  }

  function textPatternsFor(cfg) {
    var list = [];
    if (cfg.expandComments) list = list.concat(UNRAVELER_TEXT_PATTERNS.comments);
    if (cfg.expandHistory) list = list.concat(UNRAVELER_TEXT_PATTERNS.history);
    return list;
  }

  function queryAll(selectors) {
    var found = [];
    selectors.forEach(function (sel) {
      var nodes;
      try {
        nodes = document.querySelectorAll(sel);
      } catch (err) {
        // A malformed user-supplied selector must not kill the whole run.
        console.warn(LOG_PREFIX, 'Invalid selector skipped:', sel, err.message);
        return;
      }
      for (var i = 0; i < nodes.length; i++) found.push(nodes[i]);
    });
    return found;
  }

  /**
   * Text-based discovery, used only when the known testids find nothing.
   * Scoped to real controls and excluded from dialogs so we never poke a
   * modal's "Show more" while the user is mid-edit.
   */
  function queryByText(cfg) {
    var patterns = textPatternsFor(cfg);
    if (!patterns.length) return [];
    var controls = document.querySelectorAll('button, [role="button"]');
    var found = [];
    for (var i = 0; i < controls.length; i++) {
      var el = controls[i];
      if (el.closest('[role="dialog"], [role="alertdialog"]')) continue;
      var text = labelOf(el);
      if (!text || text.length > 60) continue;
      for (var p = 0; p < patterns.length; p++) {
        if (patterns[p].test(text)) { found.push(el); break; }
      }
    }
    return found;
  }

  /**
   * All currently visible expander controls, testid-matched first and only
   * falling back to text matching when the testids find nothing.
   * @returns {{ elements: Element[], usedFallback: boolean }}
   */
  function collect(cfg) {
    var usedFallback = false;
    var raw = queryAll(selectorsFor(cfg));

    if (!raw.length && cfg.textFallback) {
      raw = queryByText(cfg);
      usedFallback = raw.length > 0;
    }

    var seen = new Set();
    var elements = [];
    for (var i = 0; i < raw.length; i++) {
      var el = resolveClickable(raw[i]);
      if (!el || seen.has(el) || !isVisible(el)) continue;
      seen.add(el);
      elements.push(el);
    }
    return { elements: elements, usedFallback: usedFallback };
  }

  /**
   * Signatures of every control on screen right now, busy ones included.
   *
   * This is the "is that button really gone?" oracle. Checking
   * `!node.isConnected` is NOT sufficient: React re-renders replace these
   * nodes wholesale, so a button that reloaded and then collapsed back comes
   * back as a *different node with the same signature*. Treating that as
   * progress would defeat the strike system and loop until a safety cap.
   */
  function currentSignatures(cfg) {
    var sigs = new Set();
    collect(cfg).elements.forEach(function (el) { sigs.add(signatureOf(el)); });
    return sigs;
  }

  /**
   * @returns {{ target: Element|null, busy: boolean, usedFallback: boolean }}
   */
  function findNext(cfg, blocked) {
    var found = collect(cfg);
    var sawBusy = false;

    for (var i = 0; i < found.elements.length; i++) {
      var el = found.elements[i];
      if (isBusy(el)) { sawBusy = true; continue; }
      if (blocked.has(signatureOf(el))) continue;
      return { target: el, busy: false, usedFallback: found.usedFallback };
    }
    return { target: null, busy: sawBusy, usedFallback: found.usedFallback };
  }

  // ---------------------------------------------------------------------
  // Clicking
  // ---------------------------------------------------------------------

  /**
   * React attaches delegated listeners at the root, so a bubbling MouseEvent
   * is required — and `el.click()` cannot carry shiftKey, which the optional
   * "load everything at once" behaviour needs. Pointer + mouse down/up are
   * included because some Atlassian controls gate on them.
   */
  function fireClick(el, shift) {
    var base = {
      bubbles: true,
      cancelable: true,
      view: window,
      shiftKey: !!shift,
      button: 0
    };
    var pointerBase = Object.assign({ pointerId: 1, isPrimary: true, pointerType: 'mouse' }, base);

    try { el.dispatchEvent(new PointerEvent('pointerdown', pointerBase)); } catch (e) { /* older engines */ }
    el.dispatchEvent(new MouseEvent('mousedown', base));
    try { el.dispatchEvent(new PointerEvent('pointerup', pointerBase)); } catch (e) { /* older engines */ }
    el.dispatchEvent(new MouseEvent('mouseup', base));
    el.dispatchEvent(new MouseEvent('click', base));
  }

  // ---------------------------------------------------------------------
  // Settle detection
  // ---------------------------------------------------------------------

  /**
   * Resolve once the DOM has been free of mutations for `settleMs`, or after
   * `maxWaitMs` regardless. Much tighter than a fixed sleep: fast issues
   * expand quickly, slow ones still get the time they need.
   */
  function waitForQuiet(settleMs, maxWaitMs) {
    return new Promise(function (resolve) {
      var quietTimer = null;
      var hardTimer = null;
      var observer = null;
      var done = false;

      function finish(reason) {
        if (done) return;
        done = true;
        if (quietTimer) clearTimeout(quietTimer);
        if (hardTimer) clearTimeout(hardTimer);
        if (observer) observer.disconnect();
        resolve(reason);
      }

      function bumpQuiet() {
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(function () { finish('quiet'); }, settleMs);
      }

      observer = new MutationObserver(bumpQuiet);
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });

      hardTimer = setTimeout(function () { finish('timeout'); }, maxWaitMs);
      bumpQuiet();
    });
  }

  // ---------------------------------------------------------------------
  // Main loop
  // ---------------------------------------------------------------------

  function cancel() {
    state.cancelled = true;
  }

  function isRunning() {
    return state.running;
  }

  function getLastResult() {
    return state.lastResult;
  }

  /**
   * @param {object} cfg    Merged settings.
   * @param {function} onUpdate Called with a status object as work proceeds.
   * @returns {Promise<object>} Final status.
   */
  async function run(cfg, onUpdate) {
    if (state.running) {
      log(cfg, 'Run already in progress, ignoring.');
      return state.lastResult;
    }

    state.running = true;
    state.cancelled = false;
    state.runId += 1;

    var myRun = state.runId;
    var started = Date.now();
    var deadline = started + cfg.maxDurationMs;
    var clicks = 0;
    var strikes = new Map();
    var blocked = new Set();
    var usedFallback = false;
    var busyWaits = 0;
    var stopReason = 'complete';

    function emit(extra) {
      var status = Object.assign({
        running: state.running,
        clicks: clicks,
        blocked: blocked.size,
        elapsedMs: Date.now() - started,
        usedFallback: usedFallback,
        reason: stopReason
      }, extra || {});
      state.lastResult = status;
      if (typeof onUpdate === 'function') {
        try { onUpdate(status); } catch (e) { /* never let a listener break the run */ }
      }
      return status;
    }

    log(cfg, 'Run started.', cfg);
    emit({ running: true, reason: 'running' });

    try {
      while (true) {
        if (state.cancelled || myRun !== state.runId) { stopReason = 'cancelled'; break; }
        if (clicks >= cfg.maxClicks) { stopReason = 'max-clicks'; break; }
        if (Date.now() >= deadline) { stopReason = 'timeout'; break; }

        var next = findNext(cfg, blocked);
        if (next.usedFallback) usedFallback = true;

        if (!next.target) {
          if (next.busy) {
            // A button exists but is mid-request. Wait rather than strike it.
            busyWaits += 1;
            if (busyWaits > 40) { stopReason = 'stuck-loading'; break; }
            await sleep(250);
            continue;
          }
          // Nothing left. Give the page one quiet window to reveal a button
          // that a just-finished request is about to render, then stop.
          await waitForQuiet(cfg.settleMs, cfg.maxSettleMs);
          var confirm = findNext(cfg, blocked);
          if (!confirm.target && !confirm.busy) { stopReason = 'complete'; break; }
          continue;
        }

        busyWaits = 0;

        var target = next.target;
        var sig = signatureOf(target);
        var beforeSize = contentSize();
        var beforeLabel = labelOf(target);
        var scrollYBefore = window.scrollY;

        log(cfg, 'Clicking:', beforeLabel || '(no label)', target);
        fireClick(target, cfg.shiftClick);
        clicks += 1;
        emit({ running: true, reason: 'running', lastLabel: beforeLabel });

        await waitForQuiet(cfg.settleMs, cfg.maxSettleMs);

        // Counter the JRACLOUD-94212 symptom where loading older comments
        // slams the viewport back to the top of the issue.
        if (cfg.preserveScroll && scrollYBefore > 200 && window.scrollY < 100) {
          log(cfg, 'Scroll jumped to top, restoring to', scrollYBefore);
          window.scrollTo({ top: scrollYBefore, behavior: 'instant' });
        }

        // Progress = that exact control is gone, or the page grew.
        //
        // "Gone" is judged by signature, not node identity, so a React
        // re-render that swaps in an identical button does not read as a win.
        // The signature embeds the label, so a remaining-count ticking down
        // ("View 12 remaining" -> "View 2 remaining") also counts as gone.
        var consumed = !currentSignatures(cfg).has(sig);
        var grew = contentSize() > beforeSize;
        var progressed = consumed || grew;

        if (progressed) {
          strikes.delete(sig);
          log(cfg, 'Progress:', { consumed: consumed, grew: grew });
        } else {
          var n = (strikes.get(sig) || 0) + 1;
          strikes.set(sig, n);
          log(cfg, 'No progress, strike', n, 'for', sig);
          if (n >= cfg.maxStrikes) {
            blocked.add(sig);
            log(cfg, 'Blacklisted unproductive button:', sig);
          }
        }
      }
    } catch (err) {
      console.error(LOG_PREFIX, 'Run failed:', err);
      stopReason = 'error';
    } finally {
      state.running = false;
    }

    var result = emit({ running: false, reason: stopReason });
    log(cfg, 'Run finished.', result);
    return result;
  }

  return {
    run: run,
    cancel: cancel,
    isRunning: isRunning,
    getLastResult: getLastResult,
    // exported for debugging from the console and for the test harness
    _internals: {
      collect: collect,
      findNext: findNext,
      currentSignatures: currentSignatures,
      signatureOf: signatureOf,
      resolveClickable: resolveClickable,
      contentSize: contentSize,
      isVisible: isVisible,
      isBusy: isBusy,
      fireClick: fireClick
    }
  };
})();
