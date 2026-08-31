(() => {
  "use strict";

  const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const scalar = (value) => ["string", "number", "boolean"].includes(typeof value);
  const text = (value) => scalar(value) ? String(value).trim() : "";
  const CONTENT_KEY = /^(answer|body|caption|content|description|html|interview|label|markdown|name|note|notes|plain_?text|response|summary|text|title|value)$/i;
  const CONTENT_CONTEXT = /(answer|assessment|block|canvas|cell|checklist|content|document|element|field|interview|note|page|paragraph|response|section|subtask|table|task|text)/i;
  const NON_CONTENT_CONTEXT = /(access|avatar|collaborator|directory|file_directory|member|permission|share|telemetry|user_profile)/i;

  const walk = (value, visitor, path = [], depth = 0) => {
    if (depth > 20 || value === null || typeof value !== "object") return;
    visitor(value, path);
    if (Array.isArray(value)) {
      value.forEach((child, index) => walk(child, visitor, [...path, index], depth + 1));
      return;
    }
    Object.entries(value).forEach(([key, child]) => walk(child, visitor, [...path, key], depth + 1));
  };

  const uniqueById = (items) => {
    const result = new Map();
    for (const item of items) {
      const id = text(item?.id);
      if (!id) continue;
      result.set(id, { ...(result.get(id) || {}), ...item, id });
    }
    return [...result.values()];
  };

  const isCanvasCatalogRequest = (body, url = "") => {
    const method = requestMethodName(body);
    const signal = `${url} ${method}`;
    return /(?:get|list|search|find|query|fetch|load|retrieve|view).*(?:canvas|task)|(?:canvas|task).*(?:get|list|search|directory|index|feed)/i.test(signal)
      && !/(access|activity|comment|file|member|permission|share)/i.test(signal);
  };

  const hasExplicitCanvasCollection = (payload) => {
    let found = false;
    walk(payload, (node) => {
      if (found || !isObject(node)) return;
      for (const [key, value] of Object.entries(node)) {
        if (/^canvases$/i.test(key) && Array.isArray(value) && value.some((item) => isObject(item) && scalar(item.id))) {
          found = true;
          return;
        }
      }
    });
    return found;
  };

  const paginationInfo = (payload) => {
    let next = null;
    let hasMore = false;
    let observed = false;
    walk(payload, (node) => {
      if (!isObject(node)) return;
      for (const [key, value] of Object.entries(node)) {
        if (/^(page_key|next_page_key|next_cursor|cursor|continuation_token)$/i.test(key)) {
          observed = true;
          if (value !== null && value !== undefined && String(value)) next = value;
        }
        if (/^(has_more|hasMore|more_available)$/i.test(key)) {
          observed = true;
          if (value === true) hasMore = true;
        }
      }
    });
    return { next, hasMore, observed };
  };

  const extractReferences = (payload, body = null, url = "") => {
    const canvases = [];
    const projects = [];
    const catalogRequest = isCanvasCatalogRequest(body, url);
    walk(payload, (node) => {
      if (!isObject(node)) return;
      for (const [key, value] of Object.entries(node)) {
        if (!Array.isArray(value)) continue;
        if (/^canvases$/i.test(key) || (catalogRequest && /^(items|records|results|tasks)$/i.test(key))) {
          for (const item of value) {
            if (!isObject(item) || !scalar(item.id)) continue;
            const kind = text(item.kind || item.type || item.object_type || item.objectType);
            if (!/^canvases$/i.test(key) && kind && !/(canvas|task)/i.test(kind)) continue;
            canvases.push({
              id: item.id,
              name: item.name || item.title || "",
              workspace_id: item.workspace_id || item.workspaceId || "",
              project_id: item.project_id || item.projectId || "",
              parent_id: item.parent_id || item.parentId || "",
              url: item.url || item.slug || "",
              archived: item.archived ?? "",
              created_by: item.created_by || item.createdBy || "",
              created_at: item.created_at || item.createdAt || "",
              last_updated_by: item.last_updated_by || item.lastUpdatedBy || "",
              last_updated_at: item.last_updated_at || item.lastUpdatedAt || ""
            });
          }
        }
        if (/^projects$/i.test(key)) {
          for (const item of value) {
            if (!isObject(item) || !scalar(item.id)) continue;
            projects.push({
              id: item.id,
              name: item.name || item.title || "",
              workspace_id: item.workspace_id || item.workspaceId || "",
              parent_id: item.parent_id || item.parentId || "",
              archived: item.archived ?? "",
              created_by: item.created_by || item.createdBy || "",
              last_updated_by: item.last_updated_by || item.lastUpdatedBy || ""
            });
          }
        }
      }
    });
    return { canvases: uniqueById(canvases), projects: uniqueById(projects) };
  };

  const expectedCanvasCount = (payload, body = null, url = "") => {
    const counts = [];
    const catalogRequest = isCanvasCatalogRequest(body, url);
    walk(payload, (node) => {
      if (!isObject(node)) return;
      for (const [key, value] of Object.entries(node)) {
        if (/^(canvas_count|expected_canvas_count)$/i.test(key) && Number.isFinite(Number(value))) counts.push(Number(value));
        if (catalogRequest && /^(count|result_count|total|total_count)$/i.test(key) && Number.isFinite(Number(value))) counts.push(Number(value));
      }
    });
    return counts.length ? Math.max(...counts) : null;
  };

  const requestMethodName = (body) => text(body?.method || body?.operationName || body?.action);
  const unsafeReadPattern = /(add|invite|update|set|remove|delete|transfer|change|create|archive|restore|enable|disable|revoke|grant|save|write|upsert|publish|submit)/i;
  const safeReadPattern = /^(get|list|fetch|read|search|load|find|query|retrieve|view)/i;
  const isSafeReadRequest = (httpMethod, body) => {
    if (String(httpMethod).toUpperCase() === "GET") return true;
    if (String(httpMethod).toUpperCase() !== "POST") return false;
    const name = requestMethodName(body);
    return Boolean(name && safeReadPattern.test(name) && !unsafeReadPattern.test(name));
  };

  const collectKeys = (payload) => {
    const keys = [];
    walk(payload, (node) => {
      if (isObject(node)) keys.push(...Object.keys(node));
    });
    return keys;
  };

  const decodeEntities = (value) => String(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  const normalizeText = (value, key = "") => {
    const source = key.toLowerCase() === "html" || /<\/?[a-z][\s\S]*>/i.test(String(value))
      ? decodeEntities(value)
      : String(value);
    return source
      .replace(/\r\n?/g, "\n")
      .replace(/[\t\f\v]+/g, " ")
      .replace(/[ ]{2,}/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  };

  const parseEmbeddedJson = (value) => {
    if (typeof value !== "string" || value.length > 5_000_000 || !/^[\[{]/.test(value.trim())) return null;
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  };

  const pathString = (path) => path.map(String).join(".");
  const blockKind = (path, key) => {
    const signal = `${pathString(path)}.${key}`.toLowerCase();
    if (/subtask|checklist/.test(signal)) return "checklist";
    if (/table|row|cell/.test(signal)) return "table_cell";
    if (/title|heading|label|name/.test(key)) return "heading";
    if (/html/.test(key)) return "rich_text";
    if (/markdown/.test(key)) return "markdown";
    return "text";
  };

  const shouldKeepText = (value, path, key) => {
    if (!value || value.length > 2_000_000) return false;
    if (/^(https?:\/\/\S+|data:\S+|[0-9a-f]{24,}|[0-9a-f-]{32,})$/i.test(value)) return false;
    const context = `${pathString(path)}.${key}`;
    if (NON_CONTENT_CONTEXT.test(context) && !CONTENT_CONTEXT.test(key)) return false;
    return CONTENT_KEY.test(key) || CONTENT_CONTEXT.test(context);
  };

  const extractContentEvidence = (payload, sourceMethod = "") => {
    const blocks = [];
    const seen = new Set();
    const parsedValues = new WeakSet();

    const add = (rawValue, path, key, explicitKind) => {
      const value = normalizeText(rawValue, key);
      if (!shouldKeepText(value, path, key)) return;
      const parent = pathString(path.slice(0, -1));
      const kind = explicitKind || blockKind(path, key);
      const dedupeKey = `${sourceMethod}|${parent}|${kind}|${value}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      blocks.push({
        order: blocks.length,
        kind,
        text: value,
        source_method: sourceMethod,
        source_path: pathString([...path, key])
      });
    };

    const visit = (node, path = [], depth = 0) => {
      if (depth > 24 || node === null || node === undefined) return;
      if (Array.isArray(node)) {
        node.forEach((child, index) => visit(child, [...path, index], depth + 1));
        return;
      }
      if (!isObject(node) || parsedValues.has(node)) return;
      parsedValues.add(node);

      const label = text(node.label || node.title || node.name || node.text);
      const checked = node.checked ?? node.completed ?? node.done ?? node.is_checked;
      if (label && typeof checked === "boolean") add(`${checked ? "[x]" : "[ ]"} ${label}`, path, "checklist", "checklist");

      for (const [key, value] of Object.entries(node)) {
        if (typeof value === "string") {
          const embedded = parseEmbeddedJson(value);
          if (embedded) visit(embedded, [...path, key, "$json"], depth + 1);
          else if (CONTENT_KEY.test(key) || key === "insert") add(value, path, key);
          continue;
        }
        if (value && typeof value === "object") visit(value, [...path, key], depth + 1);
      }
    };

    visit(payload);
    return {
      blocks,
      plain_text: blocks.map((block) => block.text).join("\n"),
      character_count: blocks.reduce((total, block) => total + block.text.length, 0)
    };
  };

  const contentCandidateScore = (url, body, payload) => {
    const method = requestMethodName(body);
    const requestSignal = `${url || ""} ${method}`.toLowerCase();
    if (/(access|collaborator|comment|directory|file|member|permission|share|user)/i.test(requestSignal)) return -100;
    const keySignal = collectKeys(payload).join(" ").toLowerCase();
    const bodySignal = JSON.stringify(body || {}).toLowerCase();
    const evidence = extractContentEvidence(payload, method);
    let score = 0;
    if (/(canvas|board|task)/i.test(method)) score += 6;
    if (/(canvas|board|task)/i.test(requestSignal)) score += 3;
    if (/"(canvas|board|task)(_id)?"/.test(bodySignal)) score += 3;
    if (/(block|content|document|element|node|page|section|subtask|text)/i.test(keySignal)) score += 5;
    if (evidence.blocks.length >= 2) score += 4;
    if (evidence.character_count >= 80) score += 4;
    if (evidence.character_count >= 500) score += 2;
    return score;
  };

  const findCanvasIdPaths = (body) => {
    const paths = [];
    walk(body, (node, path) => {
      if (!isObject(node)) return;
      for (const [key, value] of Object.entries(node)) {
        if (/(^|_)(canvas|board|task)(_|)(id|ids|key|url)$/i.test(key) && scalar(value)) paths.push([...path, key]);
      }
    });
    if (paths.length) return paths;

    const method = requestMethodName(body);
    const hasCanvasType = /"(canvas|board|task)"/i.test(JSON.stringify(body || {}));
    if (/canvas|board|task/i.test(method) || hasCanvasType) {
      walk(body?.params || [], (node, path) => {
        if (Array.isArray(node)) {
          node.forEach((value, index) => {
            if (scalar(value) && /canvas|board|task/i.test(method)) paths.push(["params", ...path, index]);
          });
          return;
        }
        if (!isObject(node)) return;
        for (const [key, value] of Object.entries(node)) {
          if (/^(id|object_id|target_id|resource_id|item_id)$/i.test(key) && scalar(value)) paths.push(["params", ...path, key]);
        }
      });
    }
    return paths.filter((path, index, all) => all.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(path)) === index);
  };

  const setAtPath = (root, path, value) => {
    let target = root;
    for (let index = 0; index < path.length - 1; index += 1) target = target[path[index]];
    const key = path[path.length - 1];
    const existing = target[key];
    target[key] = typeof existing === "number" && /^\d+$/.test(String(value)) ? Number(value) : String(value);
  };

  globalThis.AlloCanvasTextCore = {
    contentCandidateScore,
    expectedCanvasCount,
    extractContentEvidence,
    extractReferences,
    findCanvasIdPaths,
    hasExplicitCanvasCollection,
    isCanvasCatalogRequest,
    isSafeReadRequest,
    normalizeText,
    paginationInfo,
    requestMethodName,
    setAtPath,
    walk
  };
})();
