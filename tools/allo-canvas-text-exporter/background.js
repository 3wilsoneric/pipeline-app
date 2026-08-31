"use strict";

const STATE_KEY = "alloCanvasTextState";
const CANVAS_PREFIX = "alloCanvasTextCanvas:";
const PROJECT_PREFIX = "alloCanvasTextProject:";
const RESULT_PREFIX = "alloCanvasTextResult:";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const updateAction = async ({ stage = "", completed = 0, error = "" } = {}) => {
  if (!chrome.action) return;
  const terminal = stage === "complete" || stage === "cancelled" || stage === "error";
  const text = !stage || stage === "idle"
    ? ""
    : stage === "complete"
    ? "DONE"
    : stage === "error"
      ? "!"
      : stage === "cancelled"
        ? ""
        : completed > 0
          ? (completed > 999 ? "999+" : String(completed))
          : "...";
  const title = error
    ? `ALLO Canvas Notes Extractor: ${error}`
    : terminal
      ? `ALLO Canvas Notes Extractor: ${stage}`
      : stage === "idle"
        ? "ALLO Canvas Notes Extractor: ready"
        : `ALLO Canvas Notes Extractor: ${completed} captured · ${stage || "working"}`;
  const color = stage === "error" ? "#b42318" : stage === "complete" ? "#247247" : "#2f7f85";

  await Promise.allSettled([
    chrome.action.setBadgeText?.({ text }),
    chrome.action.setBadgeBackgroundColor?.({ color }),
    chrome.action.setTitle?.({ title })
  ]);
};

const getState = async () => {
  const result = await chrome.storage.local.get({ [STATE_KEY]: null });
  return result[STATE_KEY] || {
    catalog: { status: "not_started", count: 0, expected: null },
    content: { status: "not_started", completed: 0, total: 0 }
  };
};

const saveState = (state) => chrome.storage.local.set({ [STATE_KEY]: state });

const removeByPrefixes = async (prefixes) => {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((key) => prefixes.some((prefix) => key.startsWith(prefix)));
  if (keys.length) await chrome.storage.local.remove(keys);
};

const updateState = async (section, updates) => {
  const state = await getState();
  state[section] = { ...(state[section] || {}), ...updates };
  await saveState(state);
  return state;
};

const sendTabMessage = (tabId, message) => new Promise((resolve, reject) => {
  chrome.tabs.sendMessage(tabId, message, (response) => {
    if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
    else if (!response?.ok) reject(new Error(response?.error || "The ALLO worker tab rejected the request."));
    else resolve(response);
  });
});

const createWorkerTab = async (url = "https://allo.io/canvases") => {
  const tab = await chrome.tabs.create({ url, active: false });
  if (!tab?.id) throw new Error("Chrome did not create the ALLO worker tab.");
  await chrome.tabs.update(tab.id, { autoDiscardable: false });
  await updateState("worker", {
    tabId: tab.id,
    status: "starting",
    stage: "starting",
    completed: 0,
    discovered: 0,
    skipped: 0,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error: null
  });
  await updateAction({ stage: "starting" });
  return tab;
};

const storedCanvases = async () => {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(CANVAS_PREFIX))
    .map(([, value]) => value)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
};

const canvasUrl = (canvas) => {
  const options = encodeURIComponent(JSON.stringify({ "canvas-from": "All Canvases" }));
  return `https://allo.io/canvases?task=${encodeURIComponent(canvas.id)}&task_options=${options}`;
};

const startImportedContentScan = async () => {
  const canvases = await storedCanvases();
  if (!canvases.length) throw new Error("The imported canvas catalog is empty.");

  const tab = await createWorkerTab(canvasUrl(canvases[0]));
  try {
    let templateReady = false;
    for (let canvasIndex = 0; canvasIndex < Math.min(5, canvases.length) && !templateReady; canvasIndex += 1) {
      if (canvasIndex > 0) await chrome.tabs.update(tab.id, { url: canvasUrl(canvases[canvasIndex]) });
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const latest = await chrome.tabs.get(tab.id);
        if (latest?.status === "complete") {
          try {
            const status = await sendTabMessage(tab.id, { type: "ALLO_CANVAS_TEXT_TAB_STATUS" });
            if (Number(status.contentTemplateCount) > 0) {
              templateReady = true;
              break;
            }
          } catch {
            // Content scripts can initialize shortly after the tab reports complete.
          }
        }
        await delay(250);
      }
    }
    if (!templateReady) throw new Error("ALLO loaded the canvases, but no reusable read-only content request was observed.");

    const response = await sendTabMessage(tab.id, { type: "ALLO_CANVAS_TEXT_START_CONTENT" });
    await updateState("worker", {
      tabId: tab.id,
      runId: response.runId,
      status: "running",
      stage: "reading",
      completed: 0,
      discovered: response.total,
      error: null
    });
    return { ok: true, tabId: tab.id, runId: response.runId, total: response.total, importedCatalog: true };
  } catch (error) {
    const message = String(error?.message || error);
    await updateState("worker", { tabId: tab.id, status: "error", stage: "error", error: message });
    await updateAction({ stage: "error", error: message });
    throw error;
  }
};

const startWorkerScan = async () => {
  const current = await getState();
  if (["starting", "running"].includes(current.worker?.status)) {
    return { ok: true, tabId: current.worker.tabId, runId: current.worker.runId, alreadyRunning: true };
  }
  if (current.catalog?.source === "imported-file-manifest" && current.catalog?.count > 0) {
    return startImportedContentScan();
  }

  const tab = await createWorkerTab();
  try {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      const latest = await chrome.tabs.get(tab.id);
      if (latest?.status === "complete") {
        try {
          const response = await sendTabMessage(tab.id, { type: "ALLO_CANVAS_TEXT_START_CATALOG" });
          await updateState("worker", { tabId: tab.id, runId: response.runId, status: "running", error: null });
          return { ok: true, tabId: tab.id, runId: response.runId };
        } catch {
          // Content scripts can finish installing shortly after the tab reports complete.
        }
      }
      await delay(250);
    }
    throw new Error("The ALLO worker tab loaded, but the extractor did not initialize.");
  } catch (error) {
    const message = String(error?.message || error);
    await updateState("worker", { tabId: tab.id, status: "error", stage: "error", error: message });
    await updateAction({ stage: "error", error: message });
    throw error;
  }
};

const handlePageEvent = async (event) => {
  if (!event || typeof event !== "object") return;

  if (event.type === "worker-progress") {
    const status = event.stage === "complete"
      ? "complete"
      : event.stage === "cancelled"
        ? "cancelled"
        : event.stage === "error"
          ? "error"
          : "running";
    await updateState("worker", {
      runId: event.runId,
      status,
      stage: event.stage,
      completed: Number(event.completed) || 0,
      discovered: Number(event.discovered) || 0,
      skipped: Number(event.skipped) || 0,
      updatedAt: event.updatedAt || new Date().toISOString(),
      completedAt: ["complete", "cancelled", "error"].includes(event.stage) ? new Date().toISOString() : null,
      error: event.error || null
    });
    await updateAction({ stage: event.stage, completed: Number(event.completed) || 0, error: event.error || "" });
    return;
  }

  if (event.type === "catalog-start") {
    await updateState("catalog", {
      runId: event.runId, status: "running", startedAt: new Date().toISOString(), completedAt: null,
      count: 0, projectCount: 0, expected: null, completeCoverage: false, error: null
    });
    return;
  }

  if (event.type === "catalog-batch") {
    const entries = {};
    for (const canvas of event.canvases || []) entries[`${CANVAS_PREFIX}${String(canvas.id)}`] = canvas;
    for (const project of event.projects || []) entries[`${PROJECT_PREFIX}${String(project.id)}`] = project;
    if (Object.keys(entries).length) await chrome.storage.local.set(entries);
    await updateState("catalog", {
      status: "running",
      count: Number(event.observedCanvasCount) || 0,
      expected: event.expectedCanvasCount ?? null,
      lastSource: event.source || ""
    });
    return;
  }

  if (event.type === "catalog-complete") {
    if (!event.completeCoverage) {
      const error = `Canvas inventory stopped at ${Number(event.canvasCount) || 0} without verified full coverage.`;
      await updateState("catalog", {
        status: "error",
        completedAt: new Date().toISOString(),
        count: event.canvasCount,
        projectCount: event.projectCount,
        expected: event.expectedCanvasCount ?? null,
        completeCoverage: false,
        error
      });
      await updateState("worker", { status: "error", stage: "error", completedAt: new Date().toISOString(), error });
      await updateAction({ stage: "error", completed: Number(event.canvasCount) || 0, error });
      return;
    }
    await updateState("catalog", {
      status: "complete", completedAt: new Date().toISOString(), count: event.canvasCount,
      projectCount: event.projectCount, expected: event.expectedCanvasCount ?? null,
      completeCoverage: Boolean(event.completeCoverage), error: null
    });
    await updateState("worker", { status: "complete", stage: "complete", completedAt: new Date().toISOString(), error: null });
    await updateAction({ stage: "complete", completed: Number(event.canvasCount) || 0 });
    return;
  }

  if (event.type === "catalog-error" || event.type === "catalog-cancelled") {
    await updateState("catalog", {
      status: event.type === "catalog-error" ? "error" : "cancelled",
      completedAt: new Date().toISOString(), count: event.canvasCount || 0,
      expected: event.expectedCanvasCount ?? null, error: event.error || null
    });
    await updateState("worker", {
      status: event.type === "catalog-error" ? "error" : "cancelled",
      stage: event.type === "catalog-error" ? "error" : "cancelled",
      completedAt: new Date().toISOString(),
      error: event.error || null
    });
    await updateAction({
      stage: event.type === "catalog-error" ? "error" : "cancelled",
      completed: Number(event.canvasCount) || 0,
      error: event.error || ""
    });
    return;
  }

  if (event.type === "content-start") {
    await updateState("content", {
      runId: event.runId, status: "running", startedAt: new Date().toISOString(), completedAt: null,
      completed: 0, total: event.total || 0, contentTemplateCount: event.contentTemplateCount || 0,
      captureMode: event.captureMode || "native-api", error: null
    });
    return;
  }

  if (event.type === "content-result") {
    const key = `${RESULT_PREFIX}${event.runId}:${String(event.index).padStart(6, "0")}`;
    await chrome.storage.local.set({ [key]: event.result });
    await updateState("content", { status: "running", completed: event.completed, total: event.total });
    return;
  }

  if (["content-complete", "content-error", "content-cancelled"].includes(event.type)) {
    const status = event.type.replace("content-", "");
    await updateState("content", {
      status, completedAt: new Date().toISOString(),
      completed: event.completed || 0, total: event.total || 0, error: event.error || null
    });
    const current = await getState();
    if (["starting", "running", "cancelling"].includes(current.worker?.status)) {
      const workerStatus = status === "complete" ? "complete" : status === "cancelled" ? "cancelled" : "error";
      await updateState("worker", {
        status: workerStatus,
        stage: workerStatus,
        completed: event.completed || 0,
        discovered: event.total || current.worker?.discovered || 0,
        completedAt: new Date().toISOString(),
        error: event.error || null
      });
      await updateAction({ stage: workerStatus, completed: Number(event.completed) || 0, error: event.error || "" });
    }
  }
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === "ALLO_CANVAS_TEXT_PAGE_EVENT") {
      await handlePageEvent(message.event);
      return { ok: true };
    }

    if (message?.type === "ALLO_CANVAS_TEXT_RESET_CATALOG") {
      await removeByPrefixes([CANVAS_PREFIX, PROJECT_PREFIX, RESULT_PREFIX]);
      const current = await getState();
      const state = {
        catalog: { runId: message.runId, status: "starting", count: 0, expected: null, completeCoverage: false },
        content: { status: "not_started", completed: 0, total: 0 },
        worker: { ...(current.worker || {}), runId: message.runId, status: "running", error: null }
      };
      await saveState(state);
      return { ok: true, state };
    }

    if (message?.type === "ALLO_CANVAS_TEXT_PREPARE_CONTENT") {
      const state = await getState();
      if (state.catalog?.status !== "complete") throw new Error("Complete the canvas catalog scan first.");
      if (!state.catalog?.completeCoverage) throw new Error("The canvas catalog count is not verified against ALLO's expected count. Do not run a partial text export.");
      await removeByPrefixes([RESULT_PREFIX]);
      const all = await chrome.storage.local.get(null);
      const canvases = Object.entries(all)
        .filter(([key]) => key.startsWith(CANVAS_PREFIX))
        .map(([, value]) => value)
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
      if (!canvases.length) throw new Error("The completed catalog contains no canvases.");
      state.content = { runId: message.runId, status: "starting", completed: 0, total: canvases.length, error: null };
      await saveState(state);
      return { ok: true, canvases };
    }

    if (message?.type === "ALLO_CANVAS_TEXT_IMPORT_CATALOG") {
      const canvases = Array.isArray(message.canvases) ? message.canvases : [];
      if (!canvases.length) throw new Error("No canvas rows were found in the selected manifest.");
      await removeByPrefixes([CANVAS_PREFIX, PROJECT_PREFIX, RESULT_PREFIX]);
      const entries = {};
      const projects = new Map();
      for (const canvas of canvases) {
        if (!canvas?.id) continue;
        entries[`${CANVAS_PREFIX}${String(canvas.id)}`] = canvas;
        if (canvas.project_id && canvas.project_name) projects.set(String(canvas.project_id), { id: String(canvas.project_id), name: canvas.project_name });
      }
      for (const project of projects.values()) entries[`${PROJECT_PREFIX}${project.id}`] = project;
      if (!Object.keys(entries).length) throw new Error("The selected manifest contains no usable canvas IDs.");
      await chrome.storage.local.set(entries);
      const count = Object.keys(entries).filter((key) => key.startsWith(CANVAS_PREFIX)).length;
      const state = {
        catalog: {
          status: "complete",
          source: "imported-file-manifest",
          count,
          expected: count,
          projectCount: projects.size,
          completeCoverage: true,
          importedAt: new Date().toISOString(),
          error: null
        },
        content: { status: "not_started", completed: 0, total: count },
        worker: { status: "not_started", stage: "idle", completed: 0, discovered: count, error: null }
      };
      await saveState(state);
      await updateAction({ stage: "idle", completed: 0 });
      return { ok: true, count, projectCount: projects.size };
    }

    if (message?.type === "ALLO_CANVAS_TEXT_START_DEDICATED_SCAN") return startWorkerScan();

    if (message?.type === "ALLO_CANVAS_TEXT_CANCEL_DEDICATED_SCAN") {
      const state = await getState();
      const tabId = state.worker?.tabId;
      const runId = state.content?.status === "running" ? state.content.runId : state.catalog?.runId;
      if (!tabId || !runId) throw new Error("No dedicated canvas extraction is running.");
      await sendTabMessage(tabId, { type: "ALLO_CANVAS_TEXT_CANCEL", runId });
      await updateState("worker", { status: "cancelling", stage: "cancelling", updatedAt: new Date().toISOString() });
      await updateAction({ stage: "cancelling", completed: Number(state.worker?.completed) || 0 });
      return { ok: true };
    }

    if (message?.type === "ALLO_CANVAS_TEXT_STATUS") return { ok: true, state: await getState() };
    return { ok: false, error: "Unknown background message." };
  })().then(sendResponse).catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});
