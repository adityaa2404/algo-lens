# Algo Lens — AI Code Analyzer for LeetCode

Algo Lens is a Chrome extension that brings AI-powered code review directly into your LeetCode workflow. Write your solution, click Analyze, and get a structured breakdown in seconds — time and space complexity with visual graphs, the approach you followed, a suggested optimal approach, edge cases you may have missed, pattern tags for spaced repetition, and a fully runnable optimized rewrite — all rendered in a side panel without leaving the problem page.

It uses Google Gemini under the hood, including thinking models that reason through your code before responding. Your API key is stored locally in the browser and all requests go directly from your machine to Google — no intermediate server, no data collection.

Built for people who want to understand why their solution is what it is, not just whether it passes.

## Features

- Side panel UI, not a cramped popup
- Full code extraction via Monaco API (not scroll-limited DOM scraping)
- Thinking-model support with tiered budgets (Flash, Flash-Lite, Pro)
- Searchable analysis history (last 25 runs)
- Syntax highlighting and copy buttons on all code blocks
- Bring your own Gemini key — nothing leaves your browser except the direct call to Google

## Prerequisites

- Google Chrome 114 or later
- A Gemini API key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey) (free tier available)
- Python 3 with Pillow installed (only needed to generate icons once)

## Setup

### 1. Get the code

```
git clone https://github.com/algolens/algolens.git
cd algolens
```

### 2. Load the extension in Chrome

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this folder.
4. The onboarding tab opens automatically.
5. Paste your Gemini API key and click **Save & verify**.

### 3. Use it

- Open any LeetCode problem page.
- Click the floating **Analyze** button injected next to the editor, or
- Click the Algo Lens icon in the Chrome toolbar, or
- Press `Ctrl+Shift+L` (`Cmd+Shift+L` on Mac).
- The side panel opens and analysis runs automatically.

## Project layout

```
manifest.json          MV3 manifest
background.js          Service worker (side panel, commands, context menu)
content.js             Isolated-world content script (metadata + inline button)
content-main.js        MAIN-world content script (Monaco API access)
inline.css             Styles for the injected Analyze button
sidepanel.html/css/js  Side panel UI
onboarding.html/css/js First-run API key setup
privacy.html           Privacy policy
icons/                 Generated PNG icons (16, 32, 48, 128)
scripts/               Dev helpers (icon generation, packaging)
backend/               Optional Python proxy — not shipped to the store
```

## Technical notes

- **Code extraction** — A MAIN-world content script accesses `window.monaco.editor.getEditors()[0].getValue()` directly, bypassing Monaco's DOM virtualization. Falls back to `textarea.value` then `.view-line` DOM scraping if Monaco is unavailable.
- **Thinking models** — Gemini 2.5+ models use `thinkingConfig.thinkingBudget`: 4096 tokens for Flash-Lite, 8192 for Flash, unlimited (`-1`) for Pro.
- **Storage** — `chrome.storage.local` only. No sync, no cookies, no analytics, no external servers.
- **Permissions** — `activeTab`, `storage`, `sidePanel`, `scripting`, `contextMenus`, plus host permissions for `leetcode.com` and `generativelanguage.googleapis.com`.
- **No bundler** — Vanilla JS. The source you read is the source Chrome runs.

## License

MIT — see [LICENSE](LICENSE).
