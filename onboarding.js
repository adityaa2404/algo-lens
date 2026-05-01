const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", async () => {
  $("version").textContent = chrome.runtime.getManifest().version;

  const stored = await chrome.storage.local.get(["apiKey"]);
  if (stored.apiKey) {
    $("apiKey").value = stored.apiKey;
    setStatus("Key already saved — you're good to go.", "ok");
  }

  $("toggleKey").addEventListener("click", () => {
    const input = $("apiKey");
    input.type = input.type === "password" ? "text" : "password";
    $("toggleKey").textContent = input.type === "password" ? "👁" : "🙈";
  });

  $("saveKey").addEventListener("click", verifyAndSave);
  $("apiKey").addEventListener("keydown", (e) => {
    if (e.key === "Enter") verifyAndSave();
  });
});

function setStatus(text, kind = "") {
  const el = document.getElementById("status");
  el.textContent = text;
  el.className = "status" + (kind ? ` ${kind}` : "");
}

async function verifyAndSave() {
  const key = document.getElementById("apiKey").value.trim();
  const btn = document.getElementById("saveKey");
  if (!key) {
    setStatus("Paste your Gemini API key first.", "err");
    return;
  }

  btn.disabled = true;
  setStatus("Verifying with Gemini…");

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Reply with exactly: ok" }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 8 }
        })
      }
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error((data && data.error && data.error.message) || `Gemini responded ${res.status}`);
    }
    await chrome.storage.local.set({ apiKey: key, model: "gemini-2.5-flash", stream: true });
    setStatus("Verified! You can close this tab.", "ok");
  } catch (error) {
    setStatus(`Couldn't verify: ${error.message || error}`, "err");
  } finally {
    btn.disabled = false;
  }
}
