# Privacy Policy — Unraveler

**Last updated: 2 October 2026**

Unraveler is a Chrome extension that expands collapsed comment threads and History
entries on Jira Cloud issue pages. It is open source; the source is at
<https://github.com/mjr2595/unraveler>.

## Summary

Unraveler collects no data. It has no server, makes no network requests, and contains
no analytics, tracking or telemetry of any kind. The developer has no access to your
browsing, your Jira issues, or anything you do with the extension.

## What the extension does with your data

Nothing is collected, transmitted, sold or shared. There is no third party involved.

Specifically:

- **Page content stays in the page.** Unraveler reads the buttons on the Jira issue
  you are looking at and clicks them. Comment text is never copied, stored, or sent
  anywhere.
- **No account, no identifier.** The extension does not create or transmit an
  identifier of any kind.
- **No network calls.** The extension makes no requests to any server, including one
  belonging to the developer.

## What is stored, and where

Unraveler stores only your settings — the toggles, the numeric limits, and any custom
CSS selectors you add. These are kept in Chrome's extension storage.

If you have Chrome sync signed in, `chrome.storage.sync` places that settings data in
**your own** Google account, on Google's infrastructure, encrypted using your
credentials. It is the same mechanism Chrome uses for your bookmarks. The developer
cannot read it. Turning off Chrome sync for extensions, or removing the extension,
deletes it.

## Permissions, and why each one exists

| Permission                                | Why it is needed                                                                                                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                                 | Saves your settings on this device / in your Chrome sync account.                                                                                               |
| `scripting`                               | Registers the content script on a custom domain after you grant it from the popup.                                                                              |
| Read and change data on `*.atlassian.net` | Reads and clicks the "Show more comments" / "Show more replies" / "Load more" buttons on Jira Cloud issues.                                                     |
| Request access to sites you choose        | Granted per-origin, and only when you click "Enable here" in the popup on a Jira instance running on a custom domain. It is never requested for any other site. |

Unraveler never runs code fetched from the internet. All of its code ships inside the
extension package and is auditable at the repository above.

## Permissions you can change

- Turn off all activity with the master switch in the popup.
- Remove any custom-domain access at `chrome://extensions` → site access.
- Uninstall from `chrome://extensions`. That deletes the stored settings.

## Children

Unraveler is a developer tool and is not directed at children.

## Changes

Any change to how data is handled will be published in this file and in the extension
repository before the updated extension is published.

## Contact

Questions about this policy: open an issue at
<https://github.com/mjr2595/unraveler/issues>.
