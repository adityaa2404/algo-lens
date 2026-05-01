# Privacy Policy — Algo Lens

_Last updated: April 17, 2026_

Algo Lens is a **bring-your-own-key** Chrome extension. We don't run servers, and we don't collect, transmit, or sell any personal data. This document explains exactly what stays on your device and what leaves it.

## What stays on your device

Stored via `chrome.storage.local` on your browser only:

- Your Gemini API key.
- Your model and UI preferences (streaming toggle, auto-analyze, selected model).
- Up to 25 most-recent analyses (problem title, your code, Gemini's response, timestamp).
- An optional manual code snippet you paste into the fallback box.

You can wipe all of it via **Settings → Clear history** or by uninstalling the extension.

## What leaves your device — and where it goes

When you click **Analyze**, the following is sent directly from your browser to Google's Gemini API (`generativelanguage.googleapis.com`), authenticated with your own key:

- The LeetCode problem title, URL, and description scraped from the current tab.
- The code you wrote in the LeetCode editor (or pasted in the manual box).
- The detected language.

Google's handling of that data is governed by the [Gemini API terms](https://ai.google.dev/gemini-api/terms) and [Google's privacy policy](https://policies.google.com/privacy). We never see the data — the request goes **browser → Google**, end of story.

## What we don't do

- No analytics, telemetry, or crash reporting.
- No remote code execution — no `eval`, no dynamic script loading.
- No ad networks, no third-party SDKs.
- No background scraping — we only read the page when you explicitly click Analyze.

## Permissions, explained

| Permission | Reason |
|---|---|
| `activeTab` | Read the current LeetCode tab when you invoke Analyze. |
| `storage` | Save your API key, preferences, and history locally. |
| `sidePanel` | Render the Algo Lens panel next to LeetCode. |
| `scripting` | Register the content script that powers the floating Analyze button. |
| `contextMenus` | Add the "Analyze snippet" right-click item. |
| `host: https://leetcode.com/*` | Scrape the problem you're looking at. |
| `host: https://generativelanguage.googleapis.com/*` | Call Gemini with your key. |

## Contact

Questions? Open an issue at https://github.com/algolens/algolens/issues.
