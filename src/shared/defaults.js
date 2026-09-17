/**
 * Unraveler — shared configuration.
 *
 * Loaded BOTH as a content script (see manifest content_scripts) and by the
 * popup via a <script> tag, so it must stay a plain classic script: no
 * import/export, no top-level `const` re-declaration hazards.
 *
 * Content script files declared in the same manifest entry share one global
 * lexical scope, so `var` is used deliberately — a top-level `const` here
 * would collide with a `const` of the same name in expander.js/main.js.
 */

var UNRAVELER_DEFAULTS = {
  /** Master switch. When false the content script observes but never clicks. */
  enabled: true,

  /** Run automatically when an issue view is detected. */
  autoRun: true,

  /**
   * Hard cap on clicks per run. A Jira issue with thousands of history
   * entries (JRASERVER-75862) will otherwise hammer the API indefinitely.
   */
  maxClicks: 100,

  /** Hard wall-clock cap per run, in ms. */
  maxDurationMs: 90000,

  /**
   * How long the DOM must be free of mutations before we consider a click
   * "settled" and look for the next button.
   */
  settleMs: 700,

  /** Upper bound on waiting for a single click to settle. */
  maxSettleMs: 8000,

  /**
   * How many times the same button may be clicked without producing any
   * observable progress before we give up on it. This is what defends
   * against the JRACLOUD-94212 "comments collapse back" loop.
   */
  maxStrikes: 2,

  /** Delay before the first automatic run, to let the issue view mount. */
  startupDelayMs: 1200,

  /** Expand the comment stream ("Show more comments" / "Show more replies"). */
  expandComments: true,

  /** Expand the History tab ("Load more"). */
  expandHistory: true,

  /**
   * Fall back to matching button *text* when no known data-testid is found.
   * This is the escape hatch for Atlassian renaming testids. Slightly riskier
   * (it could match an unrelated button), so it only engages after the
   * testid selectors come up empty.
   */
  textFallback: true,

  /**
   * Restore window scroll if a click yanks the page to the top — the symptom
   * users report in JRACLOUD-94212.
   */
  preserveScroll: true,

  /**
   * Send clicks with shiftKey set. On Jira Server/DC, shift-clicking the
   * "load more" bar loads *all* remaining items at once instead of a page.
   * UNVERIFIED on Jira Cloud's React issue view, hence off by default.
   */
  shiftClick: false,

  /** Show the floating "scroll to latest comment" button on issue views. */
  showScrollButton: true,

  /** How long the latest comment stays highlighted after scrolling, in ms. */
  highlightDurationMs: 1600,

  /** Corner for the floating button: bottom-left | bottom-right | top-left | top-right. */
  buttonPosition: 'bottom-left',

  /** Verbose console logging under the [Unraveler] prefix. */
  debug: false,

  /** Newline-separated extra CSS selectors, appended to the built-in list. */
  extraSelectors: ''
};

/**
 * Known Jira Cloud expander controls.
 *
 * Source: these three testids come from Greasy Fork userscript #518853
 * ("Show all Jira Cloud comments (and more)", reported working May 2025).
 * They follow Atlassian's `package.component.element` testid convention.
 * Treat them as best-effort: Atlassian changes testids without notice, which
 * is exactly why `textFallback` exists.
 */
var UNRAVELER_SELECTORS = {
  comments: [
    '[data-testid="issue.activity.common.component.load-more-button.loading-button"]',
    '[data-testid="issue-view-activity-comment.comment-show-more-replies.show-more-button"]'
  ],
  history: [
    // The testid sits on a WRAPPER, not the button itself — resolveClickable()
    // in expander.js walks down to the real control, so listing the wrapper
    // is enough and survives Atlassian moving the attribute onto the button.
    '[data-testid="issue-history.ui.history-items.load-more-button"]'
  ],

  /**
   * One element per comment, each carrying the numeric comment id that
   * findLatest() maxes over (newest = highest, since Jira issues ids in
   * creation order). Jira Cloud dropped the old `comment-<n>` DOM id — the id
   * now rides on the wrapper's `data-componentid` and the `comment-base-item-<n>`
   * testid (present even for off-screen comments). Best-effort; may drift.
   */
  commentItems: [
    '[data-componentid^="issue-comment-base.ui.comment.comment-in-view-wrapper."]',
    '[data-testid^="comment-base-item-"]',
    '[id^="comment-"]'
  ],

  /** Whole-comment block, resolved from any match for a clean scroll target. */
  commentBlock: '[data-componentid^="issue-comment-base.ui.comment.comment-in-view-wrapper."]'
};

/**
 * Text patterns for the fallback matcher. Deliberately strict and anchored so
 * a generic "More" menu button never matches.
 */
var UNRAVELER_TEXT_PATTERNS = {
  comments: [
    /^show\s+more\s+comments?$/i,
    /^show\s+more\s+repl(y|ies)$/i,
    /^show\s+\d+\s+more\s+repl(y|ies)$/i,
    /^view\s+(all\s+)?\d+\s+(more|remaining)\b/i,
    /^\d+\s+(more|remaining)\s+comments?$/i,
    /\bolder\s+comments?\b/i
  ],
  history: [
    /^load\s+more$/i,
    /^load\s+\d+\s+older\s+history\s+items?$/i,
    /^show\s+more\s+history$/i
  ]
};

// Make the values reachable from the popup, which loads this file via <script>.
if (typeof globalThis !== 'undefined') {
  globalThis.UNRAVELER_DEFAULTS = UNRAVELER_DEFAULTS;
  globalThis.UNRAVELER_SELECTORS = UNRAVELER_SELECTORS;
  globalThis.UNRAVELER_TEXT_PATTERNS = UNRAVELER_TEXT_PATTERNS;
}
