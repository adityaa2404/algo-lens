/* Algo Lens — MAIN world helper.
 * Runs in the page's JS context so it can access window.monaco directly.
 * Communicates with the isolated-world content.js via CustomEvents on document.
 */
(function () {
  if (window.__algoLensMainInjected) return;
  window.__algoLensMainInjected = true;

  function getMonacoValue() {
    try {
      // Primary: use Monaco's public API
      if (window.monaco && window.monaco.editor) {
        const editors = window.monaco.editor.getEditors();
        for (const ed of editors) {
          const val = ed.getValue && ed.getValue();
          if (val && val.trim()) return val;
        }
        // Fallback: iterate models (handles split-pane setups)
        const models = window.monaco.editor.getModels();
        for (const m of models) {
          const val = m.getValue && m.getValue();
          if (val && val.trim()) return val;
        }
      }
    } catch { /* monaco not ready */ }
    return null;
  }

  document.addEventListener("__algoLens:getCode", function () {
    const code = getMonacoValue();
    document.dispatchEvent(new CustomEvent("__algoLens:code", { detail: { code } }));
  });
})();
