# Unraveler — Jira Thread Expander

Chrome extension (MV3) that automatically expands Jira Cloud issue threads by clicking
every _Show more comments_, _Show more replies_, and history _Load more_ button until
the whole thread is on screen.

No build step. Load the folder unpacked and it works.

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. **Load unpacked** → select this folder
4. Open a Jira issue

It runs automatically. The toolbar badge shows the click count: blue while working,
green when finished, orange if it stopped at a safety limit.

`Alt+Shift+E` re-runs it on demand. The popup has a manual **Expand now** button and
all the settings.

### Sites

Enabled out of the box on `*.atlassian.net`.

Jira Cloud also supports custom domains, so if your instance lives somewhere else open
the popup on that site and click **Enable here** — it requests the origin permission and
registers the content script for it. To make a host permanent instead, add it to
`host_permissions` and `content_scripts[0].matches` in `manifest.json`.

## Settings

| Setting                 | Default | Notes                                                                                       |
| ----------------------- | ------- | ------------------------------------------------------------------------------------------- |
| Master switch           | on      | Disables all clicking                                                                       |
| Expand automatically    | on      | Off = manual button / `Alt+Shift+E` only                                                    |
| Comments & replies      | on      |                                                                                             |
| History "Load more"     | on      |                                                                                             |
| Match button text       | on      | Fallback for when Atlassian renames a testid                                                |
| Keep scroll position    | on      | Counters the [JRACLOUD-94212](https://jira.atlassian.com/browse/JRACLOUD-94212) jump-to-top |
| Shift-click to load all | off     | Works on Jira Server/DC; unverified on Cloud, may do nothing                                |
| Max clicks per run      | 100     | Safety cap                                                                                  |
| Max seconds per run     | 90      | Safety cap                                                                                  |
| Log to console          | off     | Prefixed `[Unraveler]`                                                                      |
| Extra selectors         | —       | One CSS selector per line                                                                   |

## When Atlassian renames a testid

They will — these testids aren't a public API. Symptoms: badge stays blank, or the popup
says _"Matched by text — testids may have changed."_

1. Open a Jira issue, right-click the _Show more comments_ button → **Inspect**
2. Read its `data-testid` (or the nearest ancestor that has one)
3. Either paste `[data-testid="the.new.id"]` into **Extra selectors** in the popup
   (no reload needed), or edit `src/shared/defaults.js` → `UNRAVELER_SELECTORS`
   and reload the extension

The text fallback should keep things working in the meantime.

## Tests

31 behavioural assertions run the real `src/content/expander.js` against a minimal DOM
mock — no reimplementation of the logic under test.

```bash
bun  run test/engine.test.js      # or
deno run --allow-read test/engine.test.js
```

Covered: pagination to completion, the JRACLOUD-94212 collapse loop, click caps, busy /
`aria-disabled` buttons, wrapper→button resolution, text-fallback activation, text-fallback
false positives, per-thread signature isolation, blacklist isolation between siblings,
shift-click propagation, feature toggles, scroll restoration, malformed user selectors,
and empty pages.

## Layout

```
manifest.json
src/
  shared/defaults.js     settings + selectors + text patterns  ← edit selectors here
  content/expander.js    the engine (click loop, progress detection)
  content/main.js        SPA nav detection, messaging, auto-trigger
  background.js          badge, keyboard command, optional hosts
  popup/                 status UI + settings
test/                    DOM mock + regression suite
```

## Known limitations

- **Only expands what's mounted.** Jira's History lives behind a tab. If the _History_ or
  _All_ tab isn't selected, those buttons aren't in the DOM. Unraveler deliberately does
  not switch tabs for you.
- **The ~30-second collapse can't be fully fixed.** Comments sometimes collapse back long
  after loading (JRACLOUD-94212). Fast collapses are handled; a delayed one happens after
  the run has already finished. Press `Alt+Shift+E` to re-expand.
- **Very large issues will hit the caps.** Thousands of history entries will stop at 60
  clicks / 90 seconds. Raise the limits in the popup, or press `Alt+Shift+E` again — a
  fresh run resumes from wherever the last one stopped.
