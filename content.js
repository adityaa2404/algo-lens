/* Algo Lens content script — LeetCode problem pages only.
 *
 * Responsibilities:
 *   1. Extract problem metadata (title, slug, id, description, URL).
 *   2. Extract the user's current code from the Monaco editor.
 *   3. Detect the active language.
 *   4. Inject a floating "Analyze with Algo Lens" action button next to the editor.
 *   5. Answer "extractLeetCodeContext" messages from the side panel / service worker.
 */

(() => {
  if (window.__algoLensInjected) return;
  window.__algoLensInjected = true;

  /* ---------- DOM helpers ---------- */
  const textFromSelectors = (selectors) => {
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      const text = el && el.innerText ? el.innerText.trim() : "";
      if (text) return text;
    }
    return "";
  };

  /* ---------- Extraction ---------- */
  const getProblemMetadata = () => {
    const pathMatch = location.pathname.match(/^\/problems\/([^/]+)/);
    const slug = pathMatch ? pathMatch[1] : "";

    const title = textFromSelectors([
      "div.text-title-large a",
      "div[data-cy='question-title']",
      "a[href*='/problems/'][class*='title']",
      "h1"
    ]);

    const description = textFromSelectors([
      "div.elfjS",
      "div[data-track-load='description_content']",
      "div[data-cy='question-content']",
      "div[class*='content__u3I1']"
    ]);

    let frontendId = "";
    try {
      const ld = document.querySelector('script[type="application/ld+json"]');
      if (ld && ld.textContent) {
        const obj = JSON.parse(ld.textContent);
        const name = obj && obj.name ? String(obj.name) : "";
        const idMatch = name.match(/^(\d+)\./);
        frontendId = idMatch ? idMatch[1] : "";
      }
    } catch { /* ignore */ }

    if (!frontendId && title) {
      const m = title.match(/^(\d+)\./);
      if (m) frontendId = m[1];
    }

    return {
      title: title || slug || "LeetCode Problem",
      slug,
      description,
      frontendId,
      url: location.href
    };
  };

  // Ask the MAIN-world helper for the full Monaco buffer (not scroll-limited).
  // Returns a Promise that resolves to the code string.
  const extractCodeFromMonaco = () => new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 800);
    document.addEventListener("__algoLens:code", function handler(e) {
      clearTimeout(timeout);
      document.removeEventListener("__algoLens:code", handler);
      resolve((e.detail && e.detail.code) || null);
    }, { once: true });
    document.dispatchEvent(new CustomEvent("__algoLens:getCode"));
  });

  // DOM fallback — only gets visible lines (Monaco virtualizes rendering).
  const extractCodeFromDOM = () => {
    // textarea.value is the full buffer for CodeMirror-style editors
    const ta = document.querySelector("textarea.inputarea") ||
               document.querySelector("textarea[data-mode-id]");
    if (ta && ta.value && ta.value.trim()) return ta.value.trim();

    // .view-line scrape — last resort, may be incomplete on long files
    const lines = [...document.querySelectorAll(".view-lines .view-line")]
      .map((l) => l.innerText)
      .filter(Boolean);
    return lines.length > 0 ? lines.join("\n") : "";
  };

  const MODE_ID_MAP = {
    cpp: "C++",
    c: "C",
    csharp: "C#",
    java: "Java",
    python: "Python",
    python3: "Python3",
    javascript: "JavaScript",
    typescript: "TypeScript",
    go: "Go",
    rust: "Rust",
    kotlin: "Kotlin",
    swift: "Swift",
    ruby: "Ruby",
    scala: "Scala",
    php: "PHP",
    dart: "Dart",
    elixir: "Elixir",
    erlang: "Erlang",
    racket: "Racket",
    mysql: "MySQL"
  };

  const LANG_WHITELIST = new Set(Object.values(MODE_ID_MAP));

  const extractLanguage = () => {
    // Most reliable: Monaco editor annotates its root with data-mode-id.
    const monaco = document.querySelector(".monaco-editor [data-mode-id]");
    const modeId = monaco && monaco.getAttribute("data-mode-id");
    if (modeId && MODE_ID_MAP[modeId.toLowerCase()]) return MODE_ID_MAP[modeId.toLowerCase()];

    // Fallback: scan buttons that look like the language picker — but only
    // accept text that's actually a known language name.
    const candidates = document.querySelectorAll("button, [role='button'], span, div");
    for (const el of candidates) {
      const t = (el.innerText || "").trim();
      if (!t || t.length > 20) continue;
      if (LANG_WHITELIST.has(t)) return t;
      // "C++" etc. might appear at the start of a larger "C++ v" label.
      for (const lang of LANG_WHITELIST) {
        if (t === lang) return lang;
        if (t.startsWith(lang + " ") || t.startsWith(lang + "\n")) return lang;
      }
    }
    return "unknown";
  };

  const extractionConfidence = (code) => {
    if (!code || code.length < 10) return "low";
    if (code.length < 30 && !/[;{}:]/.test(code)) return "low";
    return "high";
  };

  const extractContext = async () => {
    const problem = getProblemMetadata();
    const language = extractLanguage();

    // Try MAIN-world Monaco API first (full buffer, scroll-independent).
    // Fall back to DOM scraping if the helper isn't ready yet.
    let code = await extractCodeFromMonaco();
    const source = code ? "monaco-api" : "dom-fallback";
    if (!code) code = extractCodeFromDOM();

    const result = {
      ok: true,
      problem,
      code: code || "",
      language,
      extractionConfidence: extractionConfidence(code || "")
    };
    console.log("%c[Algo Lens/content]", "color:#7ee1ff", "extract:", {
      slug: problem.slug,
      title: problem.title,
      language,
      codeLength: (code || "").length,
      source,
      confidence: result.extractionConfidence
    });
    return result;
  };

  /* ---------- Message bridge ---------- */
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== "object") return false;
    if (message.type === "extractLeetCodeContext") {
      extractContext()
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, message: String(error && error.message || error) }));
      return true; // keep message channel open for async response
    }
    return false;
  });

  /* ---------- Inline analyze button ---------- */
  const BUTTON_ID = "algolens-inline-btn";

  const createInlineButton = () => {
    if (document.getElementById(BUTTON_ID)) return;
    const btn = document.createElement("button");
    btn.id = BUTTON_ID;
    btn.type = "button";
    btn.setAttribute("aria-label", "Analyze with Algo Lens");
    btn.innerHTML = `
      <span class="algolens-dot"></span>
      <span class="algolens-label">Analyze</span>
    `;
    btn.addEventListener("click", () => {
      // No `await` here — `chrome.sidePanel.open()` in the SW must run in the
      // same user-gesture tick as this click, so fire-and-forget the message.
      btn.classList.add("is-busy");
      chrome.runtime.sendMessage({ type: "algolens:open-side-panel" });
      chrome.runtime.sendMessage({ type: "algolens:request-analyze" });
      setTimeout(() => btn.classList.remove("is-busy"), 1200);
    });
    document.body.appendChild(btn);
  };

  // Only inject on problem pages
  if (/^\/problems\//.test(location.pathname)) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", createInlineButton, { once: true });
    } else {
      createInlineButton();
    }

    // Re-inject on SPA navigation inside LeetCode
    let lastPath = location.pathname;
    const observer = new MutationObserver(() => {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        const existing = document.getElementById(BUTTON_ID);
        if (/^\/problems\//.test(location.pathname)) {
          if (!existing) createInlineButton();
        } else if (existing) {
          existing.remove();
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
