/**
 * Unraveler — latest-comment locator.
 *
 * Finds the newest comment on a Jira issue, scrolls it into view, and gives it
 * a brief highlight. This lives apart from the expander engine because it
 * answers a different question — "where is the newest comment?" — and is only
 * ever driven manually, by the floating button and the keyboard shortcut.
 *
 * Newest-comment detection, cheapest reliable signal first:
 *   1. The numeric `comment-<n>` container id. Jira assigns these in creation
 *      order, so the highest number is newest regardless of whether the stream
 *      is sorted oldest- or newest-first — no timestamp parsing needed.
 *   2. The latest <time datetime> among a comment's descendants, for renderings
 *      that drop the id.
 *   3. Document order, as a last resort.
 */

var UnravelerLatest = (function () {
  'use strict';

  var LOG_PREFIX = '[Unraveler]';
  var FLASH_STYLE_ID = 'unraveler-flash-style';
  var FLASH_CLASS = 'unraveler-flash-target';

  function log(cfg) {
    if (!cfg || !cfg.debug) return;
    var args = Array.prototype.slice.call(arguments, 1);
    console.log.apply(console, [LOG_PREFIX].concat(args));
  }

  // ---------------------------------------------------------------------
  // Discovery
  // ---------------------------------------------------------------------

  function commentSelectors() {
    return (typeof UNRAVELER_SELECTORS !== 'undefined' && UNRAVELER_SELECTORS.commentItems) || [];
  }

  function findComments() {
    var seen = new Set();
    var out = [];
    commentSelectors().forEach(function (sel) {
      var nodes;
      try {
        nodes = document.querySelectorAll(sel);
      } catch (err) {
        // A malformed selector must not sink the whole lookup.
        console.warn(LOG_PREFIX, 'Invalid comment selector skipped:', sel, err.message);
        return;
      }
      for (var i = 0; i < nodes.length; i++) {
        if (seen.has(nodes[i])) continue;
        seen.add(nodes[i]);
        out.push(nodes[i]);
      }
    });
    return out;
  }

  /**
   * Numeric comment id, newest = highest. Jira Cloud no longer sets a
   * `comment-<n>` DOM id, so the id is recovered from the wrapper's
   * `data-componentid` or the `comment-base-item-<n>` testid; the legacy id is
   * still honoured for Jira Server / older Cloud.
   */
  function parseCommentId(el) {
    if (!el) return NaN;

    var legacy = /^comment-(\d+)$/.exec(el.id || '');
    if (legacy) return parseInt(legacy[1], 10);

    if (el.getAttribute) {
      var attrs = [el.getAttribute('data-componentid'), el.getAttribute('data-testid')];
      for (var i = 0; i < attrs.length; i++) {
        var groups = attrs[i] ? attrs[i].match(/\d{4,}/g) : null;
        if (groups) return parseInt(groups[groups.length - 1], 10);
      }
    }
    return NaN;
  }

  /** Newest parseable <time datetime> within an element, in ms, or -Infinity. */
  function latestTimeIn(el) {
    var max = -Infinity;
    var times;
    try {
      times = el.querySelectorAll('time[datetime]');
    } catch (err) {
      return max;
    }
    for (var i = 0; i < times.length; i++) {
      var raw = times[i].getAttribute('datetime');
      var ms = raw ? Date.parse(raw) : NaN;
      if (!isNaN(ms) && ms > max) max = ms;
    }
    return max;
  }

  /** The newest comment element on the page, or null when there are none. */
  function findLatest(cfg) {
    var comments = findComments();
    if (!comments.length) return null;

    var byId = null;
    var bestId = -Infinity;
    for (var i = 0; i < comments.length; i++) {
      var n = parseCommentId(comments[i]);
      if (!isNaN(n) && n > bestId) { bestId = n; byId = comments[i]; }
    }
    if (byId) { log(cfg, 'Latest by id:', bestId); return byId; }

    var byTime = null;
    var bestTime = -Infinity;
    for (var j = 0; j < comments.length; j++) {
      var t = latestTimeIn(comments[j]);
      if (t > bestTime) { bestTime = t; byTime = comments[j]; }
    }
    if (byTime) { log(cfg, 'Latest by timestamp:', bestTime); return byTime; }

    log(cfg, 'Latest by document order.');
    return comments[comments.length - 1];
  }

  // ---------------------------------------------------------------------
  // Highlight
  // ---------------------------------------------------------------------

  function prefersReducedMotion() {
    try {
      return typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (err) {
      return false;
    }
  }

  /**
   * Inject the flash keyframes once. Returns false when the DOM APIs it needs
   * are absent (e.g. the test harness) so highlight() can quietly no-op.
   */
  function ensureFlashStyle() {
    if (typeof document.createElement !== 'function') return false;
    if (document.getElementById && document.getElementById(FLASH_STYLE_ID)) return true;
    var style = document.createElement('style');
    style.id = FLASH_STYLE_ID;
    style.textContent =
      '.' + FLASH_CLASS + '{animation:unraveler-flash var(--unraveler-flash-ms,1600ms) ease-out 1;border-radius:3px;}' +
      '@keyframes unraveler-flash{' +
      '0%{box-shadow:0 0 0 2px rgba(12,102,228,0);background-color:rgba(12,102,228,.20);}' +
      '12%{box-shadow:0 0 0 4px rgba(12,102,228,.55);background-color:rgba(12,102,228,.20);}' +
      '100%{box-shadow:0 0 0 2px rgba(12,102,228,0);background-color:rgba(12,102,228,0);}' +
      '}' +
      '@media (prefers-reduced-motion: reduce){' +
      '.' + FLASH_CLASS + '{animation:none;outline:3px solid rgba(12,102,228,.6);outline-offset:2px;}' +
      '}';
    (document.head || document.documentElement).appendChild(style);
    return true;
  }

  /**
   * Briefly flash `el`. An injected keyframe class does the work so nothing has
   * to be saved and restored — the animation returns the element to its own
   * styles. Reduced-motion users get a static outline cleared on a timer.
   */
  function highlight(el, ms) {
    if (!el || !el.classList) return;
    if (!ensureFlashStyle()) return;

    var dur = (typeof ms === 'number' && ms > 0) ? ms : 1600;

    el.classList.remove(FLASH_CLASS);
    void el.offsetWidth; // reflow, so re-adding the class restarts the animation
    if (el.style && el.style.setProperty) el.style.setProperty('--unraveler-flash-ms', dur + 'ms');
    el.classList.add(FLASH_CLASS);

    setTimeout(function () {
      el.classList.remove(FLASH_CLASS);
      if (el.style && el.style.removeProperty) el.style.removeProperty('--unraveler-flash-ms');
    }, prefersReducedMotion() ? dur : dur + 250);
  }

  // ---------------------------------------------------------------------
  // Scroll
  // ---------------------------------------------------------------------

  /**
   * Scroll the newest comment into view and highlight it.
   * @returns {{ found: boolean }}
   */
  function scrollToLatest(cfg) {
    if (cfg && cfg.enabled === false) return { found: false };

    var found = findLatest(cfg);
    if (!found) {
      log(cfg, 'No comment to scroll to.');
      return { found: false };
    }

    // Prefer the whole-comment block for a tidy scroll + highlight.
    var blockSel = (typeof UNRAVELER_SELECTORS !== 'undefined' && UNRAVELER_SELECTORS.commentBlock) || '';
    var target = (blockSel && found.closest && found.closest(blockSel)) || found;

    try {
      target.scrollIntoView({
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        block: 'center',
        inline: 'nearest'
      });
    } catch (err) {
      // Older engines reject the options object; the boolean form always works.
      try { target.scrollIntoView(true); } catch (e2) { /* nothing else to try */ }
    }

    highlight(target, cfg && cfg.highlightDurationMs);
    log(cfg, 'Scrolled to latest comment.');
    return { found: true };
  }

  return {
    findLatest: findLatest,
    scrollToLatest: scrollToLatest,
    highlight: highlight,
    // exported for the console and the test harness
    _internals: {
      findComments: findComments,
      parseCommentId: parseCommentId,
      latestTimeIn: latestTimeIn
    }
  };
})();
