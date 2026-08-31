(() => {
  "use strict";

  if (window.__alloCanvasTextExporterInstalled) return;
  window.__alloCanvasTextExporterInstalled = true;

  const Core = globalThis.AlloCanvasTextCore;
  const PAGE_EVENT = "allo-canvas-text-page-event";
  const CONTROL_EVENT = "allo-canvas-text-control";
  const FULL_TREE_METHOD = "getFileDirectoryTree";
  const TREE_NODES_METHOD = "listFileDirectoryTreeNodes";
  const MAX_CONTENT_TEMPLATES = 8;
  const SAFE_HEADER_NAMES = new Set(["accept", "content-type", "x-requested-with-custom"]);
  const canvases = new Map();
  const projects = new Map();
  const contentTemplates = new Map();
  const candidateDiagnostics = new Map();
  const treeRootTemplates = new Map();
  const cancelledRuns = new Set();
  let fullTreeTemplate;
  let treeChildTemplate;
  let pagedCanvasTemplate;
  let expectedCanvases = null;
  let activeRun = null;

  const emit = (detail) => {
    try {
      window.dispatchEvent(new CustomEvent(PAGE_EVENT, { detail }));
    } catch {
      // The exporter must never affect the ALLO application.
    }
  };

  const randomRequestId = () => `ro_canvas_text_exporter_${crypto.randomUUID().replace(/-/g, "")}_${Date.now().toString(36)}`;
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const clone = (value) => {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  };

  const parseBody = (body) => {
    if (typeof body !== "string" || body.length > 500_000) return undefined;
    try { return JSON.parse(body); } catch { return undefined; }
  };

  const safeHeaders = (headersLike) => {
    const result = [];
    try {
      for (const [key, value] of new Headers(headersLike || {}).entries()) {
        if (SAFE_HEADER_NAMES.has(key.toLowerCase())) result.push([key, value]);
      }
    } catch {
      // Minimal headers are sufficient for ALLO's read RPC calls.
    }
    return result;
  };

  const makeTemplate = (url, method, body, headersLike, credentials = "include") => ({
    url: new URL(url, location.href).href,
    method: String(method || "GET").toUpperCase(),
    body: clone(body),
    headers: safeHeaders(headersLike),
    credentials
  });

  const rememberReferences = (payload, body, url) => {
    const refs = Core.extractReferences(payload, body, url);
    refs.canvases.forEach((canvas) => canvases.set(String(canvas.id), { ...(canvases.get(String(canvas.id)) || {}), ...canvas }));
    refs.projects.forEach((project) => projects.set(String(project.id), { ...(projects.get(String(project.id)) || {}), ...project }));
    const expected = Core.expectedCanvasCount(payload, body, url);
    if (expected) expectedCanvases = Math.max(expectedCanvases || 0, expected);
    return refs;
  };

  const valuePaths = (root, expectedValue) => {
    const result = [];
    Core.walk(root, (node, path) => {
      if (!node || Array.isArray(node) || typeof node !== "object") return;
      for (const [key, value] of Object.entries(node)) {
        if (["string", "number"].includes(typeof value) && String(value) === String(expectedValue)) result.push([...path, key]);
      }
    });
    return result;
  };

  const namedParentPaths = (root) => {
    const result = [];
    Core.walk(root, (node, path) => {
      if (!node || Array.isArray(node) || typeof node !== "object") return;
      for (const [key, value] of Object.entries(node)) {
        if (/(tree_parent_id|parent_id|project_id|projectId)$/i.test(key) && ["string", "number"].includes(typeof value)) result.push([...path, key]);
      }
    });
    return result;
  };

  const publishStatus = () => emit({
    type: "template-status",
    fullTreeReady: Boolean(fullTreeTemplate),
    treeRootsReady: treeRootTemplates.size,
    treeChildReady: Boolean(treeChildTemplate),
    pagedCanvasReady: Boolean(pagedCanvasTemplate),
    domCatalogReady: /^\/canvases(?:\/|$)/i.test(location.pathname),
    contentTemplateCount: contentTemplates.size,
    candidateDiagnostics: [...candidateDiagnostics.values()].sort((a, b) => b.score - a.score).slice(0, 8),
    observedCanvasCount: canvases.size,
    expectedCanvasCount: expectedCanvases,
    activeRun
  });

  const inspectResponse = (rawUrl, method, rawBody, headersLike, credentials, payload) => {
    const body = parseBody(rawBody);
    const parsedUrl = new URL(rawUrl, location.href);
    if (parsedUrl.origin !== location.origin || !parsedUrl.pathname.startsWith("/api/")) return;
    if (body?.request_id && String(body.request_id).startsWith("ro_canvas_text_exporter_")) return;

    const refs = rememberReferences(payload, body, parsedUrl.pathname);
    if (!body || !Core.isSafeReadRequest(method, body)) {
      publishStatus();
      return;
    }

    const methodName = Core.requestMethodName(body);
    const template = makeTemplate(parsedUrl.href, method, body, headersLike, credentials);

    if (methodName === FULL_TREE_METHOD) fullTreeTemplate = template;

    if (methodName === TREE_NODES_METHOD) {
      const parent = payload?.data?.parent || {};
      if (parent.id === null || parent.id === undefined || parent.id === "") {
        treeRootTemplates.set(String(parent.kind || body?.params?.[0]?.tree_kind || "root"), template);
      } else {
        const parentPaths = valuePaths(body, parent.id);
        template.parentPaths = parentPaths.length ? parentPaths : namedParentPaths(body);
        if (template.parentPaths.length) treeChildTemplate = template;
      }
    }

    const onAllCanvasesPage = /^\/canvases(?:\/|$)/i.test(location.pathname);
    const isFileDirectoryRead = methodName === FULL_TREE_METHOD || methodName === TREE_NODES_METHOD;
    const catalogResponse = Core.isCanvasCatalogRequest(body, parsedUrl.pathname)
      || (onAllCanvasesPage && Core.hasExplicitCanvasCollection(payload));
    if (refs.canvases.length >= 1 && catalogResponse && !isFileDirectoryRead && Core.findCanvasIdPaths(body).length === 0) {
      if (!pagedCanvasTemplate || refs.canvases.length > pagedCanvasTemplate.sampleCount) {
        pagedCanvasTemplate = {
          ...template,
          sampleCount: refs.canvases.length,
          expectedCanvasCount: Core.expectedCanvasCount(payload, body, parsedUrl.pathname)
        };
      }
    }

    const canvasIdPaths = Core.findCanvasIdPaths(body);
    const score = Core.contentCandidateScore(parsedUrl.pathname, body, payload);
    if (canvasIdPaths.length) {
      candidateDiagnostics.set(`${parsedUrl.pathname}|${methodName}`, {
        methodName,
        sourcePath: parsedUrl.pathname,
        score,
        canvasIdPathCount: canvasIdPaths.length
      });
    }
    if (canvasIdPaths.length && score >= 12 && contentTemplates.size < MAX_CONTENT_TEMPLATES) {
      const key = `${parsedUrl.pathname}|${methodName}`;
      contentTemplates.set(key, {
        ...template,
        key,
        methodName,
        canvasIdPaths,
        score
      });
    }

    publishStatus();
  };

  const originalFetch = window.fetch;
  window.fetch = function patchedFetch(input, init = {}) {
    const requestInput = typeof Request !== "undefined" && input instanceof Request;
    const rawUrl = typeof input === "string" || input instanceof URL ? String(input) : input?.url;
    const method = String(init.method || input?.method || "GET").toUpperCase();
    const rawBodyPromise = init.body !== undefined
      ? Promise.resolve(typeof init.body === "string" ? init.body : String(init.body))
      : requestInput
        ? input.clone().text().catch(() => undefined)
        : Promise.resolve(undefined);
    const headersLike = init.headers || input?.headers;
    const credentials = init.credentials || input?.credentials || "include";
    const responsePromise = originalFetch.apply(this, arguments);
    if (rawUrl) {
      responsePromise.then(async (response) => {
        try {
          if (!(response.headers.get("content-type") || "").match(/json/i)) return;
          const [rawBody, payload] = await Promise.all([rawBodyPromise, response.clone().json()]);
          inspectResponse(rawUrl, method, rawBody, headersLike, credentials, payload);
        } catch {
          // Ignore inspection failures and preserve the original response.
        }
      }).catch(() => {});
    }
    return responsePromise;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
    this.__alloCanvasTextExporterRequest = { method: String(method || "GET").toUpperCase(), url: String(url) };
    return originalOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function patchedSend(body) {
    const meta = this.__alloCanvasTextExporterRequest;
    if (meta) {
      meta.body = body;
      this.addEventListener("loadend", () => {
        try {
          const contentType = this.getResponseHeader("content-type") || "";
          if (!/json/i.test(contentType)) return;
          const payload = this.responseType === "json" ? this.response : JSON.parse(this.responseText);
          inspectResponse(meta.url, meta.method, meta.body, {}, "include", payload);
        } catch {
          // Ignore inspection failures and preserve ALLO's request.
        }
      }, { once: true });
    }
    return originalSend.apply(this, arguments);
  };

  const refreshCsrfToken = async () => {
    const response = await originalFetch.call(window, "/api/csrf-token", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Pragma: "no-cache",
        "Cache-Control": "no-store",
        "X-Requested-With-Custom": "CSRFRefresh"
      }
    });
    const payload = await response.json();
    if (!response.ok || !payload?.ok || !payload.csrf_token) throw new Error(payload?.error || `Could not refresh the read-only session token (${response.status}).`);
    window.XC_SRF = payload.csrf_token;
    return payload.csrf_token;
  };

  const buildHeaders = async (template) => {
    const headers = new Headers(template.headers || []);
    headers.set("Accept", "application/json");
    headers.set("Content-Type", "application/json");
    headers.set("X-Requested-With-Custom", "Fetch");
    headers.set("Pragma", "no-cache");
    headers.set("Cache-Control", "no-store");
    headers.set("x-bc-anti-cs-rf", await refreshCsrfToken());
    return headers;
  };

  const executeTemplate = async (template, transformBody, retry = 0) => {
    const body = clone(template.body);
    if (transformBody) transformBody(body);
    if (body.request_id !== undefined) body.request_id = randomRequestId();
    if (body.socket_id !== undefined && !body.socket_id) delete body.socket_id;
    const response = await originalFetch.call(window, template.url, {
      method: template.method,
      mode: "cors",
      cache: "no-store",
      credentials: "include",
      redirect: "follow",
      headers: await buildHeaders(template),
      body: JSON.stringify(body)
    });
    if (response.status === 429 && retry < 3) {
      const retryAfter = Math.min(30_000, Math.max(1500, Number(response.headers.get("retry-after")) * 1000 || 3000 * (retry + 1)));
      await delay(retryAfter);
      return executeTemplate(template, transformBody, retry + 1);
    }
    const payload = await response.json();
    if (!response.ok || !payload?.ok) throw new Error(payload?.error || `Read request failed (${response.status}).`);
    return payload;
  };

  const dropCacheKey = (body) => {
    if (body?.params?.[0] && typeof body.params[0] === "object") delete body.params[0].if_none_match;
  };

  const nextPageKey = (payload) => Core.paginationInfo(payload).next;
  const setPageKey = (body, key, treeMode = false) => {
    const params = body?.params?.[0];
    if (!params || typeof params !== "object") return;
    delete params.if_none_match;
    const candidateKeys = treeMode ? ["tree_page_key", "page_key", "cursor"] : ["page_key", "cursor", "next_cursor"];
    candidateKeys.forEach((candidate) => delete params[candidate]);
    if (key) params[candidateKeys[0]] = key;
  };

  const emitCatalog = (runId, refs, source) => {
    refs.canvases.forEach((canvas) => canvases.set(String(canvas.id), { ...(canvases.get(String(canvas.id)) || {}), ...canvas }));
    refs.projects.forEach((project) => projects.set(String(project.id), { ...(projects.get(String(project.id)) || {}), ...project }));
    if (refs.canvases.length || refs.projects.length) emit({
      type: "catalog-batch", runId, source, canvases: refs.canvases, projects: refs.projects,
      observedCanvasCount: canvases.size, expectedCanvasCount: expectedCanvases
    });
  };

  const scanPaged = async (runId, template, source, transformBase, treeMode = false) => {
    let cursor;
    const seen = new Set();
    for (let page = 0; page < 5000; page += 1) {
      if (cancelledRuns.has(runId)) return { complete: false, pages: page };
      const payload = await executeTemplate(template, (body) => {
        if (transformBase) transformBase(body);
        setPageKey(body, cursor, treeMode);
      });
      expectedCanvases = Math.max(
        expectedCanvases || 0,
        Core.expectedCanvasCount(payload, template.body, new URL(template.url).pathname) || 0
      ) || null;
      const refs = Core.extractReferences(payload, template.body, new URL(template.url).pathname);
      emitCatalog(runId, refs, source);
      const next = nextPageKey(payload);
      const hasMore = Core.paginationInfo(payload).hasMore;
      if (!next) {
        if (hasMore) throw new Error(`${source} says more canvases exist but did not return a continuation key.`);
        return { complete: true, pages: page + 1 };
      }
      if (seen.has(String(next))) throw new Error(`${source} repeated a continuation key before reaching the end.`);
      seen.add(String(next));
      cursor = next;
      await delay(80);
    }
    throw new Error(`${source} exceeded the safe 5,000-page limit.`);
  };

  const compactText = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const elementLabel = (element) => compactText(
    element?.getAttribute?.("aria-label") || element?.getAttribute?.("title") || element?.innerText || element?.textContent
  );
  const currentTaskId = () => new URL(location.href).searchParams.get("task") || "";
  const isVisible = (element) => {
    if (!element?.isConnected) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) !== 0;
  };

  const waitFor = async (predicate, timeoutMs = 10_000, intervalMs = 100) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = predicate();
      if (value) return value;
      await delay(intervalMs);
    }
    return null;
  };

  const waitForDom = (predicate, timeoutMs = 10_000) => {
    const immediate = predicate();
    if (immediate) return Promise.resolve(immediate);
    return new Promise((resolve) => {
      let finished = false;
      let observer;
      let timer;
      const finish = (value) => {
        if (finished) return;
        finished = true;
        observer?.disconnect();
        clearTimeout(timer);
        resolve(value || null);
      };
      observer = new MutationObserver(() => {
        try { finish(predicate()); } catch { /* Retry on the next mutation. */ }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
      timer = setTimeout(() => {
        try { finish(predicate()); } catch { finish(null); }
      }, timeoutMs);
    });
  };

  const progressOverlay = () => {
    if (typeof document === "undefined") return null;
    let overlay = document.querySelector("#allo-canvas-extractor-progress");
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "allo-canvas-extractor-progress";
    Object.assign(overlay.style, {
      position: "fixed", right: "18px", bottom: "18px", zIndex: "2147483647",
      padding: "10px 14px", borderRadius: "8px", background: "#143f43", color: "#fff",
      font: "600 13px/1.35 -apple-system, BlinkMacSystemFont, sans-serif",
      boxShadow: "0 8px 24px rgba(0,0,0,.28)", pointerEvents: "none"
    });
    document.documentElement.appendChild(overlay);
    return overlay;
  };

  const reportProgress = (runId, stage, completed, discovered, extra = {}) => {
    const detail = {
      type: "worker-progress", runId, stage, completed, discovered,
      updatedAt: new Date().toISOString(), ...extra
    };
    emit(detail);
    const labels = {
      starting: "Starting", opening: "Opening next canvas", reading: "Capturing notes",
      closing: "Closing canvas", loading: "Loading more canvases", complete: "Complete",
      cancelled: "Stopped safely", skipped: "Skipped an unreadable card", error: "Needs attention"
    };
    const skipped = Number(extra.skipped) || 0;
    const overlay = progressOverlay();
    if (overlay) overlay.textContent = `Canvas extraction · ${completed} captured · ${discovered} discovered${skipped ? ` · ${skipped} skipped` : ""} · ${labels[stage] || stage}`;
  };

  const canvasCardCandidates = () => {
    const occurrences = new Map();
    return [...document.querySelectorAll("button, [role='button']")]
      .map((element) => {
        const label = elementLabel(element);
        const match = /^Open\s+(.+)/i.exec(label);
        if (!match || /^(canvas|ALLO Assistant)\b/i.test(match[1]) || !isVisible(element) || element.closest("a[href]")) return null;
        const name = compactText(match[1]);
        let cardRoot = element.parentElement;
        let hasMatchingActions = false;
        for (let depth = 0; cardRoot && depth < 4; depth += 1, cardRoot = cardRoot.parentElement) {
          hasMatchingActions = [...cardRoot.querySelectorAll("button, [role='button']")]
            .some((candidate) => elementLabel(candidate) === `${name} actions`);
          if (hasMatchingActions) break;
        }
        if (!hasMatchingActions) return null;
        const lines = String(element.innerText || element.textContent || "")
          .split(/\n+/)
          .map(compactText)
          .filter(Boolean);
        const projectName = lines.find((line) => line !== name && !/^Open\b/i.test(line) && !/(?:ago|yesterday|today)$/i.test(line)) || "";
        const baseKey = `${name}\u0000${projectName}`;
        const occurrence = occurrences.get(baseKey) || 0;
        occurrences.set(baseKey, occurrence + 1);
        return { element, name, projectName, key: `${baseKey}\u0000${occurrence}` };
      })
      .filter(Boolean);
  };

  const findCanvasSurface = (canvasName) => {
    const dialogs = [...document.querySelectorAll("[role='dialog'], [aria-modal='true']")]
      .filter((element) => isVisible(element) && compactText(element.innerText).includes(canvasName));
    if (dialogs.length) return dialogs.sort((a, b) => compactText(b.innerText).length - compactText(a.innerText).length)[0];

    const heading = [...document.querySelectorAll("h1, h2, h3, h4, [role='heading']")]
      .find((element) => compactText(element.innerText || element.textContent) === canvasName);
    let node = heading;
    while (node && node !== document.body) {
      const text = compactText(node.innerText);
      const hasClose = [...node.querySelectorAll("button, [role='button']")]
        .some((element) => /^Close$/i.test(elementLabel(element)));
      if (hasClose && text.length >= 120) return node;
      node = node.parentElement;
    }
    return null;
  };

  const settledCanvasText = async (canvasName) => {
    const openedAt = Date.now();
    let latest = await waitForDom(() => {
      const surface = findCanvasSurface(canvasName);
      const text = Core.normalizeText(surface?.innerText || "");
      return text.length >= 80 ? { surface, text } : null;
    }, 10_000);
    if (!latest) {
      const surface = findCanvasSurface(canvasName);
      return { surface, text: Core.normalizeText(surface?.innerText || "") };
    }

    return new Promise((resolve) => {
      let finished = false;
      let settleTimer;
      let observer;
      let hardTimer;
      const finish = () => {
        if (finished) return;
        finished = true;
        observer?.disconnect();
        clearTimeout(settleTimer);
        clearTimeout(hardTimer);
        resolve(latest);
      };
      const inspect = () => {
        const surface = findCanvasSurface(canvasName);
        const text = Core.normalizeText(surface?.innerText || "");
        if (text.length >= latest.text.length) latest = { surface, text };
        clearTimeout(settleTimer);
        const minimumDelay = Math.max(0, 1500 - (Date.now() - openedAt));
        settleTimer = setTimeout(finish, Math.max(900, minimumDelay));
      };
      observer = new MutationObserver(inspect);
      observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      hardTimer = setTimeout(finish, 12_000);
      inspect();
    });
  };

  const closeOpenCanvas = async (surface) => {
    if (!currentTaskId()) return true;
    const roots = [surface, document].filter(Boolean);
    let closeButton;
    for (const root of roots) {
      closeButton = [...root.querySelectorAll("button, [role='button']")]
        .find((element) => isVisible(element) && /^Close$/i.test(elementLabel(element)));
      if (closeButton) break;
    }
    if (closeButton) closeButton.click();
    const closed = await waitForDom(() => !currentTaskId(), 5000);
    if (closed) return true;
    const backButton = [...document.querySelectorAll("button, [role='button']")]
      .find((element) => isVisible(element) && /^Back to\b/i.test(elementLabel(element)));
    if (backButton) backButton.click();
    if (await waitForDom(() => !currentTaskId(), 5000)) return true;
    history.back();
    return Boolean(await waitForDom(() => !currentTaskId(), 5000));
  };

  const scrollContainerFor = (element) => {
    let node = element?.parentElement;
    while (node && node !== document.body) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/i.test(style.overflowY) && node.scrollHeight > node.clientHeight + 100) return node;
      node = node.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  };

  const scrollForMoreCanvases = async (candidate) => {
    const scroller = scrollContainerFor(candidate?.element);
    const beforeHeight = scroller.scrollHeight;
    const beforeTop = scroller.scrollTop;
    scroller.scrollTop = scroller.scrollHeight;
    await delay(1200);
    return scroller.scrollHeight > beforeHeight || scroller.scrollTop > beforeTop;
  };

  const runRenderedCanvasExport = async (runId) => {
    if (!/^\/canvases(?:\/|$)/i.test(location.pathname)) throw new Error("Open ALLO → All canvases before starting the extractor.");
    const contentRunId = `rendered-${runId}`;
    const processedCards = new Set();
    let completed = 0;
    let skipped = 0;
    let stableBottomPasses = 0;
    let lastCandidate;
    emit({ type: "content-start", runId: contentRunId, total: 0, contentTemplateCount: 0, captureMode: "rendered-dom" });
    reportProgress(runId, "starting", 0, 0);

    await closeOpenCanvas(findCanvasSurface(compactText(document.querySelector("[role='dialog'] h1, [role='dialog'] h2, [role='dialog'] h3")?.textContent)));

    for (let pass = 0; pass < 10_000; pass += 1) {
      if (cancelledRuns.has(runId)) break;
      const candidates = canvasCardCandidates();
      const pending = candidates.filter((candidate) => !processedCards.has(candidate.key));
      reportProgress(runId, pending.length ? "opening" : "loading", completed, Math.max(candidates.length, processedCards.size), { skipped });

      if (pending.length) {
        // ALLO re-renders the grid whenever a canvas closes. Process one fresh element
        // per pass so stale React nodes cannot silently skip the rest of a batch.
        const candidate = pending[0];
        processedCards.add(candidate.key);
        lastCandidate = candidate;
        reportProgress(runId, "opening", completed, Math.max(candidates.length, processedCards.size), { skipped });
        candidate.element.scrollIntoView({ block: "center", inline: "nearest" });
        const beforeTask = currentTaskId();
        candidate.element.click();
        const taskId = await waitForDom(() => {
          const value = currentTaskId();
          return value && value !== beforeTask ? value : null;
        });
        if (!taskId) {
          skipped += 1;
          reportProgress(runId, "skipped", completed, Math.max(candidates.length, processedCards.size), { skipped });
          continue;
        }

        const projectId = candidate.projectName ? `rendered:${candidate.projectName}` : "";
        const canvas = {
          id: taskId,
          name: candidate.name,
          project_id: projectId,
          url: location.href,
          captured_from: "all-canvases-rendered-ui"
        };
        const project = projectId ? { id: projectId, name: candidate.projectName } : null;
        emitCatalog(runId, { canvases: [canvas], projects: project ? [project] : [] }, "all-canvases-rendered-ui");

        reportProgress(runId, "reading", completed, Math.max(candidates.length, processedCards.size), { skipped });
        const captured = await settledCanvasText(candidate.name);
        const errors = captured.text ? [] : ["Canvas opened, but no rendered text surface was found."];
        completed += 1;
        emit({
          type: "content-result",
          runId: contentRunId,
          index: completed - 1,
          completed,
          total: Math.max(completed, processedCards.size),
          result: {
            captured_at: new Date().toISOString(),
            canvas,
            project,
            blocks: captured.text ? [{ order: 0, kind: "rendered_canvas", text: captured.text, source_method: "rendered-dom", source_path: location.pathname }] : [],
            plain_text: captured.text,
            character_count: captured.text.length,
            errors,
            raw_responses: captured.text ? [{ source_method: "rendered-dom", source_path: location.pathname, payload: { plain_text: captured.text } }] : []
          }
        });
        reportProgress(runId, "closing", completed, Math.max(candidates.length, processedCards.size), { skipped });
        if (!await closeOpenCanvas(captured.surface)) throw new Error(`Could not safely close canvas ${candidate.name}.`);
        continue;
      }

      const beforeCount = processedCards.size;
      reportProgress(runId, "loading", completed, Math.max(canvasCardCandidates().length, processedCards.size), { skipped });
      const scrolled = await scrollForMoreCanvases(candidates.at(-1) || lastCandidate);
      const afterCandidates = canvasCardCandidates();
      const hasNewCards = afterCandidates.some((candidate) => !processedCards.has(candidate.key));
      if (hasNewCards || scrolled || processedCards.size > beforeCount) stableBottomPasses = 0;
      else stableBottomPasses += 1;
      if (stableBottomPasses >= 3) break;
    }

    if (!completed) throw new Error("No canvas cards were found. Confirm the All canvases grid is visible, then run again.");
    if (cancelledRuns.has(runId)) {
      emit({ type: "content-cancelled", runId: contentRunId, completed, total: completed });
      reportProgress(runId, "cancelled", completed, Math.max(canvases.size, processedCards.size), { skipped });
      return { complete: false, source: "all-canvases-rendered-ui" };
    }
    const verifiedComplete = Number.isFinite(Number(expectedCanvases))
      && Number(expectedCanvases) > 0
      && canvases.size >= Number(expectedCanvases);
    if (!verifiedComplete) {
      emit({
        type: "content-error",
        runId: contentRunId,
        completed,
        total: Math.max(completed, processedCards.size),
        error: `Rendered traversal stopped after ${completed} canvases without an authoritative total.`
      });
      return { complete: false, source: "all-canvases-rendered-ui", completed, skipped };
    }
    emit({ type: "content-complete", runId: contentRunId, completed, total: completed });
    reportProgress(runId, "complete", completed, Math.max(canvases.size, processedCards.size), { skipped });
    return { complete: true, source: "all-canvases-rendered-ui" };
  };

  const bootstrapContentTemplate = async (runId) => {
    if (contentTemplates.size) return true;
    const candidate = canvasCardCandidates()[0];
    if (!candidate) return false;

    reportProgress(runId, "opening", 0, canvases.size);
    candidate.element.scrollIntoView({ block: "center", inline: "nearest" });
    const beforeTask = currentTaskId();
    candidate.element.click();
    const taskId = await waitForDom(() => {
      const value = currentTaskId();
      return value && value !== beforeTask ? value : null;
    }, 10_000);
    if (!taskId) return false;

    reportProgress(runId, "reading", 0, canvases.size);
    const captured = await settledCanvasText(candidate.name);
    await waitFor(() => contentTemplates.size > 0, 5000, 100);
    reportProgress(runId, "closing", 0, canvases.size);
    if (!await closeOpenCanvas(captured.surface)) throw new Error("Could not safely close the template canvas.");
    return contentTemplates.size > 0;
  };

  const runCatalog = async (runId) => {
    cancelledRuns.delete(runId);
    canvases.clear();
    projects.clear();
    expectedCanvases = pagedCanvasTemplate?.expectedCanvasCount || null;
    activeRun = { kind: "catalog", runId };
    emit({ type: "catalog-start", runId });
    try {
      if (/^\/canvases(?:\/|$)/i.test(location.pathname)) {
        await waitFor(() => pagedCanvasTemplate, 8000, 100);
      }

      let scan;
      if (pagedCanvasTemplate) {
        reportProgress(runId, "loading", 0, 0);
        scan = await scanPaged(runId, pagedCanvasTemplate, "all-canvases-native-api");
        if (!scan.complete) throw new Error("The authoritative canvas catalog did not reach its final page.");
        if (!await bootstrapContentTemplate(runId)) {
          throw new Error("ALLO's read-only canvas-content request could not be identified. No partial export was marked complete.");
        }
        const content = await runContent(`native-${runId}`, [...canvases.values()]);
        if (content.cancelled) cancelledRuns.add(runId);
        if (!content.complete && !content.cancelled) throw new Error(content.error || "The native canvas-content export did not complete.");
      } else if (/^\/canvases(?:\/|$)/i.test(location.pathname)) {
        scan = await runRenderedCanvasExport(runId);
        if (!scan.complete && !cancelledRuns.has(runId)) {
          throw new Error(`Only ${scan.completed || canvases.size} canvases were captured; ALLO's full inventory could not be verified.`);
        }
      } else {
        throw new Error("Open ALLO → All canvases before starting the extractor.");
      }

      if (cancelledRuns.has(runId)) {
        emit({ type: "catalog-cancelled", runId, canvasCount: canvases.size, expectedCanvasCount: expectedCanvases });
      } else {
        emit({
          type: "catalog-complete", runId, canvasCount: canvases.size, projectCount: projects.size,
          expectedCanvasCount: expectedCanvases,
          completeCoverage: Boolean(scan.complete && (!expectedCanvases || canvases.size >= expectedCanvases)),
          source: scan.source || "all-canvases-list"
        });
      }
    } catch (error) {
      emit({ type: "catalog-error", runId, error: String(error?.message || error), canvasCount: canvases.size, expectedCanvasCount: expectedCanvases });
    } finally {
      activeRun = null;
      publishStatus();
    }
  };

  const runContent = async (runId, suppliedCanvases) => {
    const canvasList = Array.isArray(suppliedCanvases) && suppliedCanvases.length ? suppliedCanvases : [...canvases.values()];
    const templates = [...contentTemplates.values()].sort((a, b) => b.score - a.score).slice(0, MAX_CONTENT_TEMPLATES);
    if (!canvasList.length) {
      const error = "No canvas catalog is loaded. Run the canvas scan first.";
      emit({ type: "content-error", runId, error });
      return { complete: false, cancelled: false, error };
    }
    if (!templates.length) {
      const error = "No native canvas-content read has been captured. Open one canvas and wait until its notes are visible.";
      emit({ type: "content-error", runId, error });
      return { complete: false, cancelled: false, error };
    }

    cancelledRuns.delete(runId);
    activeRun = { kind: "content", runId };
    emit({ type: "content-start", runId, total: canvasList.length, contentTemplateCount: templates.length });
    let completed = 0;
    const progressRunId = runId.replace(/^native-/, "");
    reportProgress(progressRunId, "reading", completed, canvasList.length);
    try {
      for (const canvas of canvasList) {
        if (cancelledRuns.has(runId)) break;
        const rawResponses = [];
        const blocks = [];
        const errors = [];

        for (const template of templates) {
          try {
            const payload = await executeTemplate(template, (body) => {
              template.canvasIdPaths.forEach((path) => Core.setAtPath(body, path, canvas.id));
            });
            const evidence = Core.extractContentEvidence(payload, template.methodName);
            blocks.push(...evidence.blocks);
            rawResponses.push({
              source_method: template.methodName,
              source_path: new URL(template.url).pathname,
              character_count: evidence.character_count,
              payload
            });
          } catch (error) {
            errors.push(`${template.methodName}: ${String(error?.message || error)}`);
          }
        }

        const uniqueBlocks = [];
        const seenBlocks = new Set();
        for (const block of blocks) {
          const key = `${block.kind}|${block.text}`;
          if (seenBlocks.has(key)) continue;
          seenBlocks.add(key);
          uniqueBlocks.push({ ...block, order: uniqueBlocks.length });
        }
        completed += 1;
        emit({
          type: "content-result",
          runId,
          index: completed - 1,
          completed,
          total: canvasList.length,
          result: {
            schema_version: "allo-canvas-native-content-v1",
            captured_at: new Date().toISOString(),
            canvas,
            project: projects.get(String(canvas.project_id || "")) || null,
            blocks: uniqueBlocks,
            plain_text: uniqueBlocks.map((block) => block.text).join("\n"),
            character_count: uniqueBlocks.reduce((total, block) => total + block.text.length, 0),
            errors,
            raw_responses: rawResponses
          }
        });
        reportProgress(progressRunId, "reading", completed, canvasList.length);
        await delay(180);
      }

      if (cancelledRuns.has(runId)) {
        emit({ type: "content-cancelled", runId, completed, total: canvasList.length });
        reportProgress(progressRunId, "cancelled", completed, canvasList.length);
        return { complete: false, cancelled: true, completed };
      }
      emit({ type: "content-complete", runId, completed, total: canvasList.length });
      reportProgress(progressRunId, "complete", completed, canvasList.length);
      return { complete: true, cancelled: false, completed };
    } catch (error) {
      const message = String(error?.message || error);
      emit({ type: "content-error", runId, error: message, completed, total: canvasList.length });
      reportProgress(progressRunId, "error", completed, canvasList.length, { error: message });
      return { complete: false, cancelled: false, completed, error: message };
    } finally {
      activeRun = null;
      publishStatus();
    }
  };

  window.addEventListener(CONTROL_EVENT, (event) => {
    const detail = event.detail || {};
    if (detail.action === "status") publishStatus();
    if (detail.action === "start-catalog" && detail.runId) runCatalog(detail.runId);
    if (detail.action === "start-content" && detail.runId) runContent(detail.runId, detail.canvases);
    if (detail.action === "cancel" && detail.runId) {
      cancelledRuns.add(detail.runId);
      if (detail.runId.startsWith("rendered-")) cancelledRuns.add(detail.runId.slice("rendered-".length));
      if (detail.runId.startsWith("native-")) cancelledRuns.add(detail.runId.slice("native-".length));
    }
  });

  publishStatus();
})();
