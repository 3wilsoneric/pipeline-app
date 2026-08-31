(() => {
  "use strict";

  const PAGE_EVENT = "allo-canvas-text-page-event";
  const CONTROL_EVENT = "allo-canvas-text-control";
  let latestStatus = {
    fullTreeReady: false,
    treeRootsReady: 0,
    treeChildReady: false,
    pagedCanvasReady: false,
    domCatalogReady: false,
    contentTemplateCount: 0,
    candidateDiagnostics: [],
    observedCanvasCount: 0,
    expectedCanvasCount: null,
    activeRun: null
  };
  let forwarding = Promise.resolve();

  const sendBackground = (message) => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else if (!response?.ok) reject(new Error(response?.error || "The exporter background process rejected the request."));
      else resolve(response);
    });
  });

  window.addEventListener(PAGE_EVENT, (event) => {
    if (!event.detail || typeof event.detail !== "object") return;
    if (event.detail.type === "template-status") latestStatus = { ...latestStatus, ...event.detail };
    forwarding = forwarding
      .then(() => sendBackground({ type: "ALLO_CANVAS_TEXT_PAGE_EVENT", event: event.detail }))
      .catch(() => {});
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    (async () => {
      if (message?.type === "ALLO_CANVAS_TEXT_TAB_STATUS") return { ok: true, ...latestStatus, path: location.pathname };

      if (message?.type === "ALLO_CANVAS_TEXT_START_CATALOG") {
        const runId = `catalog-${Date.now()}-${crypto.randomUUID()}`;
        await sendBackground({ type: "ALLO_CANVAS_TEXT_RESET_CATALOG", runId });
        window.dispatchEvent(new CustomEvent(CONTROL_EVENT, { detail: { action: "start-catalog", runId } }));
        return { ok: true, runId };
      }

      if (message?.type === "ALLO_CANVAS_TEXT_START_CONTENT") {
        const runId = `content-${Date.now()}-${crypto.randomUUID()}`;
        const prepared = await sendBackground({ type: "ALLO_CANVAS_TEXT_PREPARE_CONTENT", runId });
        window.dispatchEvent(new CustomEvent(CONTROL_EVENT, {
          detail: { action: "start-content", runId, canvases: prepared.canvases }
        }));
        return { ok: true, runId, total: prepared.canvases.length };
      }

      if (message?.type === "ALLO_CANVAS_TEXT_CANCEL") {
        window.dispatchEvent(new CustomEvent(CONTROL_EVENT, { detail: { action: "cancel", runId: message.runId } }));
        return { ok: true };
      }

      return { ok: false, error: "Unknown tab message." };
    })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  });
})();
