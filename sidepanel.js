/* Algo Lens — side panel logic */

const DEFAULT_MODEL = "gemini-2.5-pro";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const HISTORY_LIMIT = 25;

// Live models (Apr 2026). "-latest" aliases get routed by Google to whichever
// version is healthy; versioned names are the concrete fallbacks.
const FALLBACK_MODELS = [
  "gemini-flash-latest",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.5-flash-lite"
];

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

const COMPLEXITY_STEPS = ["constant", "logn", "linear", "nlogn", "quadratic", "cubic", "exponential"];
const COMPLEXITY_LABELS = {
  constant: "O(1)",
  logn: "O(log n)",
  linear: "O(n)",
  nlogn: "O(n log n)",
  quadratic: "O(n²)",
  cubic: "O(n³)",
  exponential: "O(2^n)",
  unknown: "Unknown"
};

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const els = {};
let currentAbort = null;
let activeTabId = null;
let lastLeetCodeTabId = null;
let lastExtraction = null;
let lastAnalysis = null;

const log = (...args) => { console.log("%c[Algo Lens]", "color:#7ee1ff", ...args); debugPush("log", args); };
const warn = (...args) => { console.warn("%c[Algo Lens]", "color:#ffd98c", ...args); debugPush("warn", args); };

const debugBuffer = [];
function debugPush(kind, args) {
  const safe = args.map((a) => {
    if (a instanceof Error) return { __error: true, name: a.name, message: a.message, status: a.status, stack: a.stack };
    try { JSON.stringify(a); return a; } catch { return String(a); }
  });
  debugBuffer.push({ t: Date.now(), kind, args: safe });
  if (debugBuffer.length > 60) debugBuffer.shift();
}

document.addEventListener("DOMContentLoaded", init);

function init() {
  [
    "brandSub", "analyzeBtn", "stopBtn", "result", "skeleton", "hint",
    "problemCard", "problemId", "problemTitle", "problemLang", "problemLink",
    "manualCode", "apiKey", "modelSelect", "streamToggle", "autoAnalyzeToggle",
    "saveBtn", "clearHistoryBtn", "toggleKey", "historySearch", "historyList",
    "historyEmpty", "toast", "privacyLink", "version",
    "debugDump", "refreshDebug", "copyDebug", "clearDebug"
  ].forEach((id) => (els[id] = $(id)));

  els.version.textContent = chrome.runtime.getManifest().version;

  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  els.analyzeBtn.addEventListener("click", () => analyze({ trigger: "button" }));
  els.stopBtn.addEventListener("click", stopAnalyze);
  els.saveBtn.addEventListener("click", saveSettings);
  els.clearHistoryBtn.addEventListener("click", clearHistory);
  els.toggleKey.addEventListener("click", toggleKey);
  els.historySearch.addEventListener("input", renderHistoryList);
  els.privacyLink.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL("privacy.html") });
  });

  els.refreshDebug.addEventListener("click", renderDebugDump);
  els.copyDebug.addEventListener("click", () => {
    renderDebugDump();
    navigator.clipboard.writeText(els.debugDump.textContent || "").then(() => toast("Copied debug log"));
  });
  els.clearDebug.addEventListener("click", () => {
    debugBuffer.length = 0;
    renderDebugDump();
    toast("Debug log cleared");
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (!message || typeof message !== "object") return;
    if (message.type === "algolens:analyze-active") {
      if (message.tabId) activeTabId = message.tabId;
      analyze({ trigger: "shortcut" });
    } else if (message.type === "algolens:analyze-snippet") {
      switchTab("analyze");
      if (message.snippet) {
        els.manualCode.value = message.snippet;
        const wrap = document.getElementById("manualWrap");
        if (wrap) wrap.open = true;
        analyze({ trigger: "snippet", snippet: message.snippet });
      }
    }
  });

  loadSettings().then(() => {
    probeActiveLeetCodeTab();
    renderHistoryList();
  });
}

/* ---------- Tabs ---------- */
function switchTab(name) {
  document.body.dataset.view = name;
  document.querySelectorAll(".tab").forEach((btn) => {
    const active = btn.dataset.tab === name;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("is-active", view.id === `view-${name}`);
  });
  if (name === "history") renderHistoryList();
}

/* ---------- Status + toast ---------- */
function setStatus(text, kind = "") {
  els.brandSub.textContent = text;
  els.brandSub.className = "brand-sub" + (kind ? ` ${kind}` : "");
}

let toastTimer = null;
function toast(text) {
  els.toast.textContent = text;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (els.toast.hidden = true), 1800);
}

/* ---------- Settings ---------- */
async function loadSettings() {
  const stored = await chrome.storage.local.get([
    "apiKey", "model", "stream", "autoAnalyze", "manualCode", "lastAnalysis"
  ]);
  els.apiKey.value = stored.apiKey || "";

  // Migrate retired / invalid model names to the live default.
  const validModels = new Set(Array.from(els.modelSelect.options).map((o) => o.value));
  const chosen = stored.model && validModels.has(stored.model) ? stored.model : DEFAULT_MODEL;
  if (stored.model && stored.model !== chosen) {
    log("migrating retired model", stored.model, "→", chosen);
    chrome.storage.local.set({ model: chosen });
  }
  els.modelSelect.value = chosen;

  els.streamToggle.checked = stored.stream !== false;
  els.autoAnalyzeToggle.checked = stored.autoAnalyze === true;
  els.manualCode.value = stored.manualCode || "";

  if (!stored.apiKey) {
    setStatus("Add your Gemini key in Settings", "error");
  }
  if (stored.lastAnalysis) {
    renderAnalysis(stored.lastAnalysis.analysis, stored.lastAnalysis.meta);
    lastAnalysis = stored.lastAnalysis;
  }
}

async function saveSettings() {
  await chrome.storage.local.set({
    apiKey: els.apiKey.value.trim(),
    model: els.modelSelect.value,
    stream: els.streamToggle.checked,
    autoAnalyze: els.autoAnalyzeToggle.checked,
    manualCode: els.manualCode.value
  });
  setStatus("Settings saved", "success");
  toast("Saved");
}

function toggleKey() {
  const show = els.apiKey.type === "password";
  els.apiKey.type = show ? "text" : "password";
  els.toggleKey.textContent = show ? "🙈" : "👁";
}

/* ---------- LeetCode extraction ---------- */
async function findLeetCodeTab() {
  // 1. Active tab in current window if it's LeetCode
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active && active.url && active.url.includes("leetcode.com/problems/")) return active;

  // 2. Last known LC tab if it's still open and still on a problem
  if (lastLeetCodeTabId != null) {
    try {
      const cached = await chrome.tabs.get(lastLeetCodeTabId);
      if (cached && cached.url && cached.url.includes("leetcode.com/problems/")) return cached;
    } catch { /* tab closed */ }
  }

  // 3. Any other LC problem tab in current window
  const winTabs = await chrome.tabs.query({ currentWindow: true, url: "https://leetcode.com/problems/*" });
  if (winTabs.length) return winTabs[0];

  // 4. Any LC problem tab across windows
  const all = await chrome.tabs.query({ url: "https://leetcode.com/problems/*" });
  return all[0] || null;
}

async function probeActiveLeetCodeTab() {
  try {
    const tab = await findLeetCodeTab();
    log("probe: leetcode tab =", tab ? { id: tab.id, url: tab.url } : null);
    if (!tab) {
      showProblemCard(null);
      setStatus("Open a LeetCode problem to begin");
      return;
    }
    lastLeetCodeTabId = tab.id;
    activeTabId = tab.id;
    const data = await chrome.tabs.sendMessage(tab.id, { type: "extractLeetCodeContext" }).catch((e) => {
      warn("probe: sendMessage failed:", e.message || e);
      return null;
    });
    log("probe: extract result =", data);
    if (data && data.ok) {
      lastExtraction = data;
      showProblemCard(data.problem, data.language);
      setStatus("Ready to analyze");
    } else {
      setStatus("Couldn't read problem — reload the LeetCode tab", "error");
    }
  } catch (error) {
    warn("probe: unexpected error:", error);
  }
}

function showProblemCard(problem, language) {
  if (!problem) {
    els.problemCard.hidden = true;
    return;
  }
  els.problemCard.hidden = false;
  els.problemId.textContent = problem.frontendId ? `#${problem.frontendId}` : "#—";
  els.problemTitle.textContent = problem.title || "LeetCode Problem";
  els.problemLink.href = safeUrl(problem.url || "#");
  els.problemLang.textContent = (language || "unknown").toLowerCase();
}

/* ---------- Analyze flow ---------- */
async function analyze({ trigger = "button", snippet = null } = {}) {
  if (currentAbort) return; // already in flight

  const apiKey = els.apiKey.value.trim();
  if (!apiKey) {
    switchTab("settings");
    setStatus("Add your Gemini key to continue", "error");
    toast("API key required");
    return;
  }

  try {
    let extracted = lastExtraction;
    if (!snippet) {
      const tab = await findLeetCodeTab();
      if (!tab) throw new Error("Open a LeetCode problem tab first");
      lastLeetCodeTabId = tab.id;
      activeTabId = tab.id;
      extracted = await chrome.tabs.sendMessage(tab.id, { type: "extractLeetCodeContext" })
        .catch(() => null);
      if (!extracted || !extracted.ok) {
        throw new Error("Couldn't reach the LeetCode page — reload that tab, then retry");
      }
      lastExtraction = extracted;
      showProblemCard(extracted.problem, extracted.language);
    }

    const manual = els.manualCode.value.trim();
    const code = snippet
      || (extracted && extracted.extractionConfidence !== "low" && extracted.code ? extracted.code : manual || (extracted && extracted.code) || "");
    if (!code) throw new Error("No code found — paste it in the manual box");
    if (!hasSubstantialCode(code)) throw new Error("Write your solution first, then analyze.");

    const problem = snippet
      ? { title: "Snippet", slug: "snippet", description: "", frontendId: "", url: "" }
      : (extracted.problem || {});
    const language = extracted && extracted.language ? extracted.language : "unknown";
    const preferredModel = els.modelSelect.value || DEFAULT_MODEL;
    const useStream = els.streamToggle.checked;

    beginBusy();

    log("analyze: start", {
      trigger, language, codeLength: code.length,
      problem: { title: problem.title, slug: problem.slug, id: problem.frontendId },
      preferredModel, useStream
    });

    const t0 = performance.now();
    let result = null;
    let usedModel = preferredModel;

    const modelsToTry = [preferredModel, ...FALLBACK_MODELS.filter((m) => m !== preferredModel)];
    let lastError = null;

    for (const model of modelsToTry) {
      if (!currentAbort) throw new Error("Stopped");
      const isThinking = isThinkingModel(model);
      const label = model + (isThinking ? " — thinking…" : "");
      setStatus(`Analyzing with ${label}`, "busy");
      log(`analyze: calling ${model} (thinking=${isThinking})`);
      try {
        result = await callGemini({ apiKey, model, problem, code, language, stream: false, onDelta: null });
        usedModel = model;
        log(`analyze: ${model} ok in ${Math.round(performance.now() - t0)}ms`);
        break;
      } catch (error) {
        if (error && (error.name === "AbortError" || /aborted/i.test(String(error.message || "")))) throw error;
        warn(`analyze: ${model} failed (${Math.round(performance.now() - t0)}ms):`, error.status || "", error.message || error);
        lastError = error;
        if (!isRetryable(error)) break;
        // Retryable — try next model in chain
      }
    }

    if (!result) throw lastError || new Error("All models failed");

    if (!result) throw new Error("No response from Gemini");

    const analysis = normalizeAnalysis(result);
    const meta = { problem, code, language, model: usedModel, timestamp: Date.now() };
    lastAnalysis = { analysis, meta };
    await chrome.storage.local.set({ lastAnalysis });
    await pushHistory(analysis, meta);

    renderAnalysis(analysis, meta);
    endBusy("success", `Analyzed with ${usedModel}`);
  } catch (error) {
    if (error && (error.name === "AbortError" || /aborted/i.test(String(error.message || "")))) {
      endBusy("", "Stopped");
      return;
    }
    endBusy("error", shortenError(error));
    if (!lastAnalysis) els.result.innerHTML = "";
  }
}

function beginBusy() {
  currentAbort = new AbortController();
  els.analyzeBtn.disabled = true;
  els.stopBtn.hidden = false;
  els.stopBtn.disabled = false;
  els.skeleton.hidden = false;
  els.result.innerHTML = "";
  setStatus("Analyzing…", "busy");
}

function endBusy(kind = "", message = "") {
  els.analyzeBtn.disabled = false;
  els.stopBtn.hidden = true;
  els.skeleton.hidden = true;
  if (currentAbort) {
    currentAbort = null;
  }
  if (message) setStatus(message, kind);
}

function stopAnalyze() {
  if (currentAbort) currentAbort.abort();
  endBusy("", "Stopped");
}

// Returns false if code is just a starter template (empty function body / no logic).
function hasSubstantialCode(code) {
  const lines = code.split("\n").map((l) => l.trim()).filter((l) => {
    if (!l) return false;
    // Skip lines that are purely structural boilerplate
    if (/^(class|public:|private:|protected:|def |func |function |impl |mod |namespace )/i.test(l)) return false;
    if (/^[{};]+$/.test(l)) return false;
    if (/^\/\/|^#|^\/\*|\*\//.test(l)) return false;
    // Skip bare return types / signatures with no body logic
    if (/^(int|void|bool|string|long|double|float|vector|list|dict|map|auto)\s+\w+\s*\(/.test(l)) return false;
    return true;
  });
  return lines.length >= 2;
}

function shortenError(error) {
  const msg = String((error && error.message) || error || "Unknown error");
  return msg.length > 80 ? msg.slice(0, 78) + "…" : msg;
}

/* ---------- Gemini client (streaming + non-streaming) ---------- */
function buildPrompt(problem, code, language, attempt = 0) {
  const lang = language || "unknown";
  const pid = problem.frontendId || "";

  const lines = [
    "You are a senior competitive programmer doing a post-submission code review. You are talking directly to the person who wrote the code — use 'your code', 'you used', 'you iterate' etc. Never say 'the user' or 'the user's code'.",
    "Respond with a single JSON object. No markdown fences. No text before or after the JSON.",
    "",
    "JSON schema (all fields required):",
    `{"codeReading":"<1-2 sentences: what the code does, grounded in actual variable names>","currentApproach":"<short label e.g. Binary Search / Prefix Sum + Recurrence>","suggestedApproach":"<optimal algorithm — same as current if already optimal>","keyIdea":"<one sentence: core insight of optimal solution>","approach":"<3-5 sentences about the user code: variables, loop logic, why it works>","timeComplexity":"<exact e.g. O(log(m*n))>","timeComplexityClass":"<constant|logn|linear|nlogn|quadratic|cubic|exponential|unknown>","timeComplexityReasoning":"<bullet breakdown: each function/loop and its cost, then overall — e.g. - rev(n): O(log n) — processes each digit once\\n- loop over range [l,h]: up to O(n) iterations\\n- check(i) inside loop: O(sqrt n) per call\\n- Overall: O(n sqrt n)>","spaceComplexity":"<exact>","spaceComplexityClass":"<constant|logn|linear|nlogn|quadratic|cubic|exponential|unknown>","spaceComplexityReasoning":"<same bullet style for space>","mistakesAndEdgeCases":["<real bugs only>"],"patternTags":["<algorithm tags>"],"optimizedSolution":{"explanation":"<what changed and why>","code":"<full working code>"},"references":[{"source":"","url":"","note":""}]}`,
    "",
    `Problem: ${problem.title || "Unknown"}${pid ? ` (#${pid})` : ""}`,
    `URL: ${problem.url || ""}`,
    `Language: ${lang}`,
    "",
    "Problem Statement:",
    problem.description || "(no description captured)",
    "",
    "=== USER CODE START ===",
    code || "",
    "=== USER CODE END ===",
    "",
    "STEP 1 — READ THE CODE (do this before anything else):",
    "  Read every line of the submitted code between the markers above.",
    "  List to yourself: what variables are declared, what loops exist, what the loop bodies do.",
    "  If you see a while/for loop, the body IS present — do not say it is missing or incomplete.",
    "  Ignore helper functions that are defined but not called — they do not affect correctness.",
    "",
    "STEP 2 — FILL THE JSON using these rules:",
    "  codeReading: describe what you read in STEP 1, grounded in specific variable names and operations. Use 'your code', 'you use', 'you iterate'.",
    "  currentApproach: name the algorithm/pattern the submitted code actually uses.",
    "  suggestedApproach: name the optimal algorithm (same as current if already optimal).",
    "  keyIdea: the core mathematical/algorithmic insight of the optimal solution.",
    "  approach: explain what the submitted code does using 'your code / you'. Mention actual variable names. Never plagiarize the problem statement.",
    "  timeComplexity: exact complexity of the submitted code. Be precise (e.g. 'O(log(m*n))' not 'O(log N)').",
    "  timeComplexityReasoning: bullet-point breakdown using '- label: cost — reason' per line. Cover each major function/loop separately, then end with '- Overall: <complexity>'. Use \\n between bullets. Be specific to the actual code.",
    "  spaceComplexityReasoning: same bullet style. Cover each data structure or call stack, then '- Overall: <complexity>'.",
    `  optimizedSolution.code: fresh ${lang} implementation — new variable names, do NOT copy the submitted style.`,
    `    Write ONLY the function body as it would appear in LeetCode's editor — no #include, no using namespace std, no main(), no class wrapper unless the problem requires it.`,
    `    ${lang} syntax rules: C++ → std::vector<int>, std::unordered_map etc (never 'using namespace std'). Python → len(), // for integer division. Use the exact function signature LeetCode provides.`,
    "  mistakesAndEdgeCases: only real bugs that produce wrong output. Never invent issues in working code.",
    `  references: include exactly:`,
    `    {"source":"WalkCC","url":"https://walkccc.me/LeetCode/problems/${pid || "<id>"}/","note":"clean editorial"}`,
    `    {"source":"NeetCode","url":"https://neetcode.io/solutions/${problem.slug || "<slug>"}","note":"video + code"}`,
    `    {"source":"AlgoMaster","url":"https://algomaster.io/practice/leetcode/${pid || "<id>"}","note":"pattern guide"}`,
  ];

  if (attempt === 0) {
    lines.push("", "Output only the JSON object. No extra text before or after.");
  } else {
    lines.push(
      "",
      "Write all prose in your own words — do not copy the problem statement.",
      "For optimizedSolution.code use distinct variable names from the user's code.",
      "Output only the JSON object. No extra text."
    );
  }
  return lines.join("\n");
}

function isThinkingModel(model) {
  // Gemini 2.5+ and 3+ have thinking enabled by default; 1.x and 2.0 do not.
  return /gemini-(2\.5|3[\.\d]*)/i.test(model);
}

async function callGemini({ apiKey, model, problem, code, language, stream, onDelta, attempt = 0 }) {
  const generationConfig = {
    temperature: attempt === 0 ? 0.2 : 0.6,
    // 16k output tokens — enough for full JSON + optimized code without truncation.
    // Thinking tokens are billed separately and don't count against this limit.
    maxOutputTokens: 16384
  };

  // Always non-streaming — simpler, more reliable, no SSE parsing edge cases.
  stream = false;
  if (isThinkingModel(model)) {
    // Scale thinking budget by model tier: lite models don't need to overthink.
    // -1 = dynamic (model decides). Pro/Flash get full budget; lite gets a cap
    // so it doesn't spend 90s thinking and still truncates on output.
    const isLite = /lite/i.test(model);
    const isPro = /pro/i.test(model);
    generationConfig.thinkingConfig = {
      thinkingBudget: isLite ? 4096 : isPro ? -1 : 8192
    };
  }

  // Snapshot the abort signal now — if the user stops mid-stream, currentAbort
  // gets nulled by endBusy() before the fallback fetch runs, so we'd lose the
  // signal. Capturing it here ensures both the stream and any fallback are aborted.
  const abortSignal = currentAbort ? currentAbort.signal : undefined;

  const body = {
    contents: [{ role: "user", parts: [{ text: buildPrompt(problem, code, language, attempt) }] }],
    // Code-review use case — disable safety blocking. Gemini's defaults filter
    // perfectly benign algorithmic code on famous LC problems.
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" }
    ],
    generationConfig
  };

  if (!stream) {
    const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: abortSignal
    });
    const data = await safeJson(res);
    if (!res.ok) throw httpError(res.status, data);
    const text = extractTextFromResponse(data);
    if (!text) throw geminiEmptyError(data);
    return parseAnalysisJson(text);
  }

  const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: abortSignal
  });
  if (!res.ok) {
    const data = await safeJson(res);
    throw httpError(res.status, data);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";
  let lastEvent = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    // Normalize \r\n → \n so the split works regardless of server line-ending style
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";
    for (const chunk of parts) {
      const line = chunk.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const jsonStr = line.slice(5).trim();
      if (!jsonStr || jsonStr === "[DONE]") continue;
      try {
        const event = JSON.parse(jsonStr);
        lastEvent = event;
        const delta = extractTextFromResponse(event);
        if (delta) {
          accumulated += delta;
          if (onDelta) {
            try { onDelta(accumulated); } catch (cbErr) { warn("onDelta error:", cbErr); }
          }
        }
      } catch {
        // Swallow malformed SSE frame and continue
      }
    }
  }

  if (!accumulated.trim()) {
    // Stream came back empty (common with thinking models or \r\n encoding issues).
    // Fall back to a single non-streaming call before giving up.
    warn("stream returned nothing, retrying as non-stream");
    const url2 = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res2 = await fetch(url2, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: abortSignal
    });
    const data2 = await safeJson(res2);
    if (!res2.ok) throw httpError(res2.status, data2);
    const text2 = extractTextFromResponse(data2);
    if (!text2) throw geminiEmptyError(data2);
    return parseAnalysisJson(text2);
  }
  return parseAnalysisJson(accumulated);
}

async function safeJson(res) {
  try { return await res.json(); } catch { return null; }
}

function extractTextFromResponse(data) {
  if (!data) return "";
  const cand = data.candidates && data.candidates[0];
  if (!cand || !cand.content || !Array.isArray(cand.content.parts)) return "";
  // Skip thought parts (thinking tokens) — only keep actual response text.
  return cand.content.parts
    .filter((p) => p && p.text && !p.thought)
    .map((p) => p.text)
    .join("");
}

function parseAnalysisJson(text) {
  const clean = String(text || "").replace(/```json/gi, "```").replace(/```/g, "").trim();
  if (!clean) throw new Error("Gemini returned empty response");
  try {
    return JSON.parse(clean);
  } catch {
    const first = clean.indexOf("{");
    const last = clean.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(clean.slice(first, last + 1));
      } catch {
        throw new Error("Gemini response wasn't valid JSON");
      }
    }
    throw new Error("Gemini response wasn't valid JSON");
  }
}

function httpError(status, data) {
  const message = (data && data.error && data.error.message) || `Gemini ${status}`;
  const err = new Error(message);
  err.status = status;
  err.geminiData = data;
  return err;
}

function isRetryable(error) {
  if (!error) return false;
  // Fatal errors: auth / bad request — all models will fail the same way.
  if (error.status === 400 || error.status === 401 || error.status === 403) return false;
  // 404 on one model just means "try the next one", treat as retryable for chain.
  if (error.status === 404) return true;
  if (error.status && RETRY_STATUS.has(error.status)) return true;
  // Empty / filtered / recitation — try the next model, it may not filter.
  if (error.isEmpty) return true;
  const msg = String(error.message || "").toLowerCase();
  if (/api key|unauthor|forbidden/i.test(msg)) return false;
  return /overload|unavailable|high demand|try again|rate limit|quota|not found|is not support/i.test(msg);
}

function geminiEmptyError(data) {
  warn("empty Gemini response, raw payload:", data);
  const cand = data && data.candidates && data.candidates[0];
  const finish = cand && cand.finishReason;
  const blocked = data && data.promptFeedback && data.promptFeedback.blockReason;
  const safety = cand && cand.safetyRatings && cand.safetyRatings.find((r) => r.blocked);

  let message;
  if (blocked) message = `Gemini blocked the prompt (${blocked}). Try a shorter selection.`;
  else if (finish === "MAX_TOKENS") message = "Response hit token limit — try a shorter problem or smaller model.";
  else if (finish === "SAFETY" || safety) message = "Gemini filtered the response (safety).";
  else if (finish === "RECITATION") message = "Gemini blocked (recitation) — problem too close to training data.";
  else if (finish) message = `Gemini stopped: ${finish}`;
  else message = "Gemini returned an empty response.";

  const err = new Error(message);
  err.isEmpty = true;
  err.finishReason = finish;
  err.blockReason = blocked;
  return err;
}

function tryParsePartial(text) {
  const clean = String(text || "").replace(/```json/gi, "```").replace(/```/g, "").trim();
  const first = clean.indexOf("{");
  if (first < 0) return null;
  // Walk backwards from the last } to find the longest valid prefix.
  // Cap at 60 attempts to avoid freezing the UI on large invalid payloads.
  let end = clean.length;
  for (let tries = 0; tries < 60; tries++, end--) {
    const last = clean.lastIndexOf("}", end);
    if (last <= first) return null;
    end = last;
    try { return JSON.parse(clean.slice(first, end + 1)); } catch { /* keep trimming */ }
  }
  return null;
}

/* ---------- Normalization ---------- */
function normalizeAnalysis(raw) {
  const a = raw && typeof raw === "object" ? raw : {};
  const opt = a.optimizedSolution && typeof a.optimizedSolution === "object" ? a.optimizedSolution : {};
  return {
    codeReading: String(a.codeReading || ""),
    currentApproach: String(a.currentApproach || ""),
    suggestedApproach: String(a.suggestedApproach || ""),
    keyIdea: String(a.keyIdea || ""),
    approach: String(a.approach || ""),
    timeComplexity: String(a.timeComplexity || ""),
    timeComplexityClass: String(a.timeComplexityClass || ""),
    timeComplexityReasoning: String(a.timeComplexityReasoning || ""),
    spaceComplexity: String(a.spaceComplexity || ""),
    spaceComplexityClass: String(a.spaceComplexityClass || ""),
    spaceComplexityReasoning: String(a.spaceComplexityReasoning || ""),
    mistakesAndEdgeCases: Array.isArray(a.mistakesAndEdgeCases) ? a.mistakesAndEdgeCases.map(String) : [],
    patternTags: Array.isArray(a.patternTags) ? a.patternTags.map(String) : [],
    optimizedSolution: {
      explanation: String(opt.explanation || ""),
      code: String(opt.code || "")
    },
    references: Array.isArray(a.references) ? a.references.map(normalizeReference) : []
  };
}

function normalizeReference(r) {
  return {
    source: String(r && r.source ? r.source : "Reference"),
    url: String(r && r.url ? r.url : ""),
    note: String(r && r.note ? r.note : "")
  };
}


/* ---------- Rendering ---------- */
function renderPartial(accumulated, meta) {
  const partial = tryParsePartial(accumulated);
  if (!partial) return;
  const normalized = normalizeAnalysis(partial);
  renderAnalysis(normalized, meta, { partial: true });
}

function renderAnalysis(data, meta = {}, opts = {}) {
  els.skeleton.hidden = true;

  const { problem = {}, code = "", language = "unknown" } = meta;
  const tags = (data.patternTags || []).filter(Boolean);
  const mistakes = (data.mistakesAndEdgeCases || []).filter(Boolean);
  const optCode = (data.optimizedSolution && data.optimizedSolution.code) || "";
  const optExpl = (data.optimizedSolution && data.optimizedSolution.explanation) || "";
  const refs = data.references || [];

  const refsHtml = refs.length
    ? `<h3>References</h3><ul>${refs.map((r) => `<li><a href="${safeUrl(r.url)}" target="_blank" rel="noreferrer noopener">${esc(r.source)}</a>${r.note ? " — " + esc(r.note) : ""}</li>`).join("")}</ul>`
    : "";

  const tagsHtml = tags.length
    ? `<div class="pill-row">${tags.map((t) => `<span class="pill">#${esc(t)}</span>`).join("")}</div>`
    : "";

  const sameApproach = data.currentApproach && data.suggestedApproach &&
    data.currentApproach.trim().toLowerCase() === data.suggestedApproach.trim().toLowerCase();

  const approachMetaHtml = (data.currentApproach || data.suggestedApproach || data.keyIdea) ? `
    <div class="approach-meta">
      ${data.currentApproach ? `<div class="approach-row"><span class="approach-label">Current</span><span class="approach-value">${escMd(data.currentApproach)}</span></div>` : ""}
      ${data.suggestedApproach && !sameApproach ? `<div class="approach-row"><span class="approach-label">Suggested</span><span class="approach-value suggested">${escMd(data.suggestedApproach)}</span></div>` : ""}
      ${data.keyIdea ? `<div class="approach-row"><span class="approach-label">Key idea</span><span class="approach-value key-idea">${escMd(data.keyIdea)}</span></div>` : ""}
    </div>` : "";

  els.result.innerHTML = `
    ${tagsHtml}
    <div class="metrics-grid">
      ${renderComplexityCard("Time", data.timeComplexity, data.timeComplexityClass)}
      ${renderComplexityCard("Space", data.spaceComplexity, data.spaceComplexityClass)}
    </div>
    ${renderComplexityReasoning(data.timeComplexityReasoning, data.spaceComplexityReasoning)}
    <h3>Approach</h3>
    ${approachMetaHtml}
    <p>${escMd(data.approach || (opts.partial ? "…" : ""))}</p>
    ${mistakes.length ? `<h3>Edge cases &amp; mistakes</h3><ul>${mistakes.map((m) => `<li>${escMd(m)}</li>`).join("")}</ul>` : ""}
    ${optExpl || optCode ? `
    <div class="opt-section">
      <div class="opt-header">
        <h3 style="margin:0">Optimized solution</h3>
        <button type="button" class="opt-reveal-btn" aria-expanded="false">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 3C4.5 3 1.5 6 1 8c.5 2 3.5 5 7 5s6.5-3 7-5c-.5-2-3.5-5-7-5Zm0 8a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm0-4.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" fill="currentColor"/></svg>
          Reveal
        </button>
      </div>
      <div class="opt-body" hidden>
        ${optExpl ? `<p>${escMd(optExpl)}</p>` : ""}
        ${optCode ? renderCodeBlock(optCode, code, language) : ""}
      </div>
    </div>` : ""}
    ${refsHtml}
  `;

  // Wire up copy / diff buttons
  const root = els.result;
  root.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = root.querySelector(btn.dataset.copy);
      if (!target) return;
      navigator.clipboard.writeText(target.textContent || "").then(() => toast("Copied"));
    });
  });
  const revealBtn = root.querySelector(".opt-reveal-btn");
  if (revealBtn) {
    revealBtn.addEventListener("click", () => {
      const body = revealBtn.closest(".opt-section").querySelector(".opt-body");
      const revealed = body.hidden;
      body.hidden = !revealed;
      revealBtn.setAttribute("aria-expanded", String(revealed));
      revealBtn.innerHTML = revealed
        ? `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 2l12 12M8 3C4.5 3 1.5 6 1 8c.3 1.2 1.4 2.7 2.9 3.8M6.1 6.1A3 3 0 0 1 11 8.9M10 10a3 3 0 0 1-4.1.1" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg> Hide`
        : `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M8 3C4.5 3 1.5 6 1 8c.5 2 3.5 5 7 5s6.5-3 7-5c-.5-2-3.5-5-7-5Zm0 8a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm0-4.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" fill="currentColor"/></svg> Reveal`;
    });
  }
  root.querySelectorAll(".cstep-more").forEach((btn) => {
    const op = btn.previousElementSibling;
    // Only show the button if text is actually truncated
    if (op && op.scrollWidth > op.offsetWidth) {
      btn.classList.add("is-visible");
    }
    btn.addEventListener("click", () => {
      if (!op) return;
      const expanded = op.classList.toggle("is-expanded");
      btn.textContent = expanded ? "…less" : "…more";
    });
  });
  root.querySelectorAll("[data-diff-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const wrap = btn.closest(".code-block");
      if (!wrap) return;
      const isDiff = wrap.classList.toggle("is-diff");
      btn.classList.toggle("is-on", isDiff);
      const code = wrap.querySelector("code");
      if (!code) return;
      if (isDiff) {
        code.innerHTML = renderDiff(wrap.dataset.origCode || "", wrap.dataset.optCode || "");
      } else {
        code.innerHTML = highlight(wrap.dataset.optCode || "", wrap.dataset.lang || "");
      }
    });
  });
}

function renderComplexityCard(title, text, className) {
  const rank = complexityRank(className || text);
  const samples = complexitySamples(rank);
  const { line, area } = sparklinePath(samples);
  const label = complexityLabel(className, text);
  const gid = `g-${title.toLowerCase()}`;
  return `
    <div class="metric-card">
      <div class="metric-label"><span>${esc(title)}</span><span class="metric-value">${esc(label)}</span></div>
      <svg class="chart" viewBox="0 0 260 64" preserveAspectRatio="none" aria-label="${esc(title)} growth">
        <defs>
          <linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="#7ee1ff" stop-opacity="0.7"/>
            <stop offset="100%" stop-color="#7ee1ff" stop-opacity="0.02"/>
          </linearGradient>
        </defs>
        <rect class="chart-bg" x="0.5" y="0.5" width="259" height="63" rx="10"/>
        <path class="chart-fill" d="${area}" style="fill: url(#${gid})"/>
        <path class="chart-line" d="M ${line.replace(/ /g, " L ").replace(/,/g, " ")}"/>
      </svg>
      <div class="timeline"><span>n=1</span><span>n=8</span><span>n=64</span><span>n=1k</span></div>
    </div>
  `;
}

function renderComplexityReasoning(timeR, spaceR) {
  if (!timeR && !spaceR) return "";
  const renderBullets = (text) => {
    if (!text) return "";
    // Split on newlines, render each "- label: cost — reason" line
    return text.split(/\n/).map((line) => {
      const trimmed = line.replace(/^[-•]\s*/, "").trim();
      if (!trimmed) return "";
      // Bold the "Overall" line
      const isOverall = /^overall/i.test(trimmed);
      return `<li class="${isOverall ? "cr-overall" : ""}">${escMd(trimmed)}</li>`;
    }).filter(Boolean).join("");
  };
  return `
    <div class="complexity-reasoning-block">
      ${timeR ? `<div class="cr-section"><span class="cr-label">Time</span><ul class="cr-list">${renderBullets(timeR)}</ul></div>` : ""}
      ${spaceR ? `<div class="cr-section"><span class="cr-label">Space</span><ul class="cr-list">${renderBullets(spaceR)}</ul></div>` : ""}
    </div>`;
}

function renderCodeBlock(optCode, origCode, language) {
  const lang = (language || "").toLowerCase();
  return `
    <div class="code-block" data-lang="${esc(lang)}" data-orig-code="${esc(origCode || "")}" data-opt-code="${esc(optCode || "")}">
      <div class="toolbar">
        <span class="label">optimized · ${esc(lang || "code")}</span>
        <div class="group">
          ${origCode ? `<button type="button" data-diff-toggle>Diff</button>` : ""}
          <button type="button" data-copy=".code-block pre code">Copy</button>
        </div>
      </div>
      <pre><code>${highlight(optCode, lang)}</code></pre>
    </div>
  `;
}

/* ---------- Complexity helpers ---------- */
function complexityRank(value) {
  const n = String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return COMPLEXITY_STEPS.includes(n) ? COMPLEXITY_STEPS.indexOf(n) : COMPLEXITY_STEPS.length - 1;
}

function complexityLabel(cls, text) {
  // Always prefer the raw text from the model (e.g. "O(log(m*n))") over the
  // generic class label. The class is used only for graph shape (complexityRank).
  if (text && text.trim()) return text.trim();
  if (cls && COMPLEXITY_LABELS[cls]) return COMPLEXITY_LABELS[cls];
  return COMPLEXITY_LABELS.unknown;
}

function complexitySamples(rank) {
  const base = [1, 2, 4, 8, 16, 32];
  const curves = {
    0: base.map(() => 1),
    1: base.map((n) => Math.log2(n) + 1),
    2: base.map((n) => n / 4),
    3: base.map((n) => (n * Math.log2(n)) / 8),
    4: base.map((n) => (n * n) / 64),
    5: base.map((n) => (n * n * n) / 512),
    6: base.map((n) => Math.pow(2, n / 8))
  };
  return curves[rank] || curves[2];
}

function sparklinePath(samples, w = 260, h = 64) {
  const max = Math.max(...samples, 1);
  const min = Math.min(...samples, 0);
  const pts = samples.map((v, i) => {
    const x = (i / (samples.length - 1)) * w;
    const nv = (v - min) / (max - min || 1);
    const y = h - 8 - nv * (h - 20);
    return [x, y];
  });
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `M 0 ${h - 6} ${pts.map(([x, y]) => `L ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ")} L ${w} ${h - 6} Z`;
  return { line, area };
}

/* ---------- Utilities: esc / safeUrl / highlight / diff ---------- */
function esc(v) {
  return String(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Escape then render `inline code` backticks as <code> elements.
function escMd(v) {
  return esc(v).replace(/`([^`]+)`/g, "<code>$1</code>");
}

function safeUrl(v) {
  try {
    const url = new URL(String(v || ""), window.location.href);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "#";
  } catch { return "#"; }
}

const KEYWORDS_PY = new Set(("def class if elif else for while return import from as try except finally raise pass break continue lambda yield with async await True False None not and or in is global nonlocal").split(" "));
const KEYWORDS_JS = new Set(("function class if else for while return import from as try catch finally throw break continue yield async await true false null undefined let const var new typeof instanceof in of delete void this super extends default export").split(" "));
const KEYWORDS_CPP = new Set(("auto break case catch class const continue default delete do else enum explicit extern false for friend if inline int long namespace new nullptr operator private protected public return short signed sizeof static struct switch template this throw true try typedef typeid typename union unsigned using virtual void volatile while"));
const KEYWORDS_JAVA = new Set(("abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new null package private protected public return short static strictfp super switch synchronized this throw throws transient true false try void volatile while").split(" "));

function pickKeywords(lang) {
  const l = String(lang || "").toLowerCase();
  if (l.includes("python") || l === "py") return KEYWORDS_PY;
  if (l.includes("java") && !l.includes("script")) return KEYWORDS_JAVA;
  if (l.includes("c++") || l.includes("cpp") || l === "c") return KEYWORDS_CPP;
  return KEYWORDS_JS; // js/ts and default
}

function highlight(code, lang) {
  const keywords = pickKeywords(lang);
  const lines = String(code || "").split("\n");
  return lines.map((line) => highlightLine(line, keywords)).join("\n");
}

function highlightLine(line, keywords) {
  // Tokenize: strings, comments, numbers, identifiers, else raw.
  const out = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    const ch = line[i];
    // Line comment
    if ((ch === "/" && line[i + 1] === "/") || ch === "#") {
      out.push(`<span class="hl-com">${esc(line.slice(i))}</span>`);
      i = n;
      break;
    }
    // String
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < n && line[j] !== ch) {
        if (line[j] === "\\") j += 2; else j += 1;
      }
      j = Math.min(j + 1, n);
      out.push(`<span class="hl-str">${esc(line.slice(i, j))}</span>`);
      i = j; continue;
    }
    // Number
    if (/\d/.test(ch)) {
      let j = i;
      while (j < n && /[\d_.xXa-fA-F]/.test(line[j])) j++;
      out.push(`<span class="hl-num">${esc(line.slice(i, j))}</span>`);
      i = j; continue;
    }
    // Identifier
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(line[j])) j++;
      const word = line.slice(i, j);
      if (keywords.has(word)) {
        out.push(`<span class="hl-kw">${esc(word)}</span>`);
      } else if (line[j] === "(") {
        out.push(`<span class="hl-fn">${esc(word)}</span>`);
      } else {
        out.push(esc(word));
      }
      i = j; continue;
    }
    out.push(esc(ch));
    i++;
  }
  return out.join("");
}

function renderDiff(a, b) {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  // LCS-based minimal diff
  const m = aLines.length, n = bLines.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = aLines[i] === bLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (aLines[i] === bLines[j]) { out.push(["", aLines[i]]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push(["del", aLines[i]]); i++; }
    else { out.push(["add", bLines[j]]); j++; }
  }
  while (i < m) out.push(["del", aLines[i++]]);
  while (j < n) out.push(["add", bLines[j++]]);
  return out.map(([kind, line]) => {
    const cls = kind === "add" ? "diff-add" : kind === "del" ? "diff-del" : "";
    const prefix = kind === "add" ? "+ " : kind === "del" ? "- " : "  ";
    return `<span class="${cls}">${esc(prefix + line)}</span>`;
  }).join("\n");
}

/* ---------- History ---------- */
async function pushHistory(analysis, meta) {
  const store = await chrome.storage.local.get(["history"]);
  const list = Array.isArray(store.history) ? store.history : [];
  const entry = {
    id: `${meta.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
    problem: meta.problem || {},
    language: meta.language,
    model: meta.model,
    code: meta.code,
    analysis,
    timestamp: meta.timestamp
  };
  const dedup = [entry, ...list.filter((item) => !(item.problem && entry.problem && item.problem.slug === entry.problem.slug && item.code === entry.code))];
  await chrome.storage.local.set({ history: dedup.slice(0, HISTORY_LIMIT) });
}

async function renderHistoryList() {
  const store = await chrome.storage.local.get(["history"]);
  const list = Array.isArray(store.history) ? store.history : [];
  const query = (els.historySearch.value || "").toLowerCase().trim();
  const filtered = query
    ? list.filter((item) => {
        const t = (item.problem && item.problem.title || "").toLowerCase();
        const tags = (item.analysis && item.analysis.patternTags || []).join(" ").toLowerCase();
        return t.includes(query) || tags.includes(query);
      })
    : list;

  els.historyList.innerHTML = "";
  els.historyEmpty.hidden = filtered.length > 0;

  filtered.forEach((item) => {
    const li = document.createElement("li");
    li.className = "history-item";
    const title = (item.problem && item.problem.title) || "Snippet";
    const id = (item.problem && item.problem.frontendId) ? `#${item.problem.frontendId}` : "";
    const when = timeAgo(item.timestamp);
    const tComp = (item.analysis && item.analysis.timeComplexity) || "";
    li.innerHTML = `
      <p class="history-title">${esc(title)}</p>
      <div class="history-meta">
        ${id ? `<span>${esc(id)}</span><span class="sep">·</span>` : ""}
        <span>${esc(item.language || "unknown")}</span>
        <span class="sep">·</span>
        <span>${esc(tComp || "—")}</span>
        <span class="sep">·</span>
        <span>${esc(when)}</span>
      </div>
    `;
    li.addEventListener("click", () => {
      if (currentAbort) stopAnalyze();
      switchTab("analyze");
      lastAnalysis = { analysis: item.analysis, meta: { problem: item.problem, code: item.code, language: item.language, model: item.model, timestamp: item.timestamp } };
      showProblemCard(item.problem, item.language);
      renderAnalysis(item.analysis, lastAnalysis.meta);
      setStatus("Restored from history");
    });
    els.historyList.appendChild(li);
  });
}

async function clearHistory() {
  if (!confirm("Delete all saved analyses?")) return;
  await chrome.storage.local.set({ history: [] });
  await renderHistoryList();
  toast("History cleared");
}

function renderDebugDump() {
  if (!els.debugDump) return;
  if (!debugBuffer.length) {
    els.debugDump.textContent = "(no events yet — run Analyze and click Refresh)";
    return;
  }
  const lines = debugBuffer.map((entry) => {
    const ts = new Date(entry.t).toISOString().slice(11, 23);
    const tag = entry.kind === "warn" ? "[warn] " : "";
    const body = entry.args.map((a) => {
      if (a && typeof a === "object") return JSON.stringify(a, null, 2);
      return String(a);
    }).join(" ");
    return `${ts} ${tag}${body}`;
  });
  els.debugDump.textContent = lines.join("\n\n");
  els.debugDump.scrollTop = els.debugDump.scrollHeight;
}

function timeAgo(ts) {
  const diff = Date.now() - Number(ts || 0);
  if (!ts || isNaN(diff)) return "just now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
