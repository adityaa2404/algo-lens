const SIDE_PANEL_PATH = "sidepanel.html";
const ONBOARDING_URL = chrome.runtime.getURL("onboarding.html");

// Run on every service-worker startup, not just install, so settings persist
// after the SW sleeps. Wrapped in a try: some Chrome channels don't expose
// setPanelBehavior on all platforms.
(async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.warn("sidePanel.setPanelBehavior failed", error);
  }
  try {
    await chrome.sidePanel.setOptions({ path: SIDE_PANEL_PATH, enabled: true });
  } catch (error) {
    console.warn("sidePanel.setOptions failed", error);
  }
})();

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.create(
    {
      id: "algolens-analyze-selection",
      title: "Analyze snippet with Algo Lens",
      contexts: ["selection"],
      documentUrlPatterns: ["https://leetcode.com/*"]
    },
    () => void chrome.runtime.lastError
  );

  if (details.reason === "install") {
    chrome.tabs.create({ url: ONBOARDING_URL });
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "algolens-analyze-selection" || !tab) return;
  // Open panel synchronously to preserve user gesture
  chrome.sidePanel.open({ tabId: tab.id, windowId: tab.windowId }).catch(() => {});
  const text = info.selectionText || "";
  broadcast({ type: "algolens:analyze-snippet", snippet: text, tabId: tab.id });
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "analyze-current") {
    resolveActiveTab(tab).then((activeTab) => {
      if (!activeTab) return;
      chrome.sidePanel.open({ tabId: activeTab.id, windowId: activeTab.windowId }).catch(() => {});
      setTimeout(() => {
        broadcast({ type: "algolens:analyze-active", tabId: activeTab.id });
      }, 600);
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") return false;

  if (message.type === "algolens:open-side-panel") {
    const tab = sender && sender.tab;
    if (!tab) {
      sendResponse({ ok: false, message: "no tab context" });
      return false;
    }
    // MUST be synchronous — call open() without awaiting anything first so the
    // user-gesture token propagated by runtime.onMessage is still valid.
    chrome.sidePanel.open({ windowId: tab.windowId })
      .catch((error) => console.warn("sidePanel.open failed", error));
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === "algolens:request-analyze") {
    const tabId = sender && sender.tab ? sender.tab.id : null;
    // Delay slightly so the panel can finish mounting on first open.
    setTimeout(() => broadcast({ type: "algolens:analyze-active", tabId }), 350);
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

function broadcast(payload) {
  chrome.runtime.sendMessage(payload).catch(() => {});
}

async function resolveActiveTab(tab) {
  if (tab) return tab;
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  return active || null;
}

