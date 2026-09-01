(() => {
  "use strict";

  const DATABASE_NAME = "pipeline-offline-v1";
  const DATABASE_VERSION = 2;
  const ACTIVE_STORE = "active";
  const ACTIVE_KEY = "current-assessment";
  const KEYS_STORE = "keys";
  const RECORDS_STORE = "records";
  const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

  const elements = {
    app: document.querySelector("#app"),
    empty: document.querySelector("#empty"),
    emptyTitle: document.querySelector("#empty-title"),
    emptyDetail: document.querySelector("#empty-detail"),
    retry: document.querySelector("#retry"),
    clientName: document.querySelector("#client-name"),
    saveStatus: document.querySelector("#save-status"),
    returnOnline: document.querySelector("#return-online"),
    progressCount: document.querySelector("#progress-count"),
    progressBar: document.querySelector("#progress-bar"),
    sections: document.querySelector("#sections"),
    sectionNumber: document.querySelector("#section-number"),
    sectionTitle: document.querySelector("#section-title"),
    sectionDescription: document.querySelector("#section-description"),
    readOnly: document.querySelector("#read-only"),
    groups: document.querySelector("#groups"),
  };

  let database;
  let activeRecord;
  let storedRecord;
  let encryptionKey;
  let workingSet;
  let activeSection;
  let saveChain = Promise.resolve();

  elements.retry.addEventListener("click", () => window.location.reload());
  elements.returnOnline.addEventListener("click", () => {
    if (!navigator.onLine || !workingSet) return;
    const target = safeReturnPath(workingSet.returnPath);
    window.location.assign(target);
  });
  window.addEventListener("online", updateConnectionState);
  window.addEventListener("offline", updateConnectionState);
  if ("BroadcastChannel" in window) {
    const controlChannel = new BroadcastChannel("pipeline-offline-control");
    controlChannel.addEventListener("message", (event) => {
      if (event.data?.type !== "PIPELINE_OFFLINE_DATA_CLEARED") return;
      database?.close();
      workingSet = null;
      showEmpty("Offline assessment cleared.", "Pipeline removed this device's working set after sign-out or an account change. Reconnect and sign in before continuing.");
    });
  }

  void initialize();

  async function initialize() {
    try {
      database = await openDatabase();
      activeRecord = await request(database.transaction(ACTIVE_STORE).objectStore(ACTIVE_STORE).get(ACTIVE_KEY));
      if (!activeRecord || activeRecord.expiresAt <= Date.now()) {
        if (activeRecord) await clearExpiredActiveRecord();
        showEmpty("A connection is required.", "No current offline assessment is available on this device. Reconnect to Pipeline and open an assessment before working offline.");
        return;
      }

      storedRecord = await request(database.transaction(RECORDS_STORE).objectStore(RECORDS_STORE).get(activeRecord.recordId));
      encryptionKey = (await request(database.transaction(KEYS_STORE).objectStore(KEYS_STORE).get(activeRecord.principal)))?.key;
      if (!storedRecord || storedRecord.expiresAt <= Date.now() || !encryptionKey || storedRecord.principal !== activeRecord.principal) {
        await clearExpiredActiveRecord();
        showEmpty("Offline assessment unavailable.", "This device no longer has a valid encrypted working set. Reconnect to Pipeline to restore it.");
        return;
      }

      workingSet = await decryptWorkingSet(encryptionKey, activeRecord.principal, activeRecord.recordId, storedRecord);
      if (!validWorkingSet(workingSet)) throw new Error("The offline working set is invalid.");
      activeSection = firstUsefulSection(workingSet);
      elements.empty.classList.add("hidden");
      elements.app.classList.remove("hidden");
      elements.clientName.textContent = `${textValue(workingSet.draft.data.resident_name) || "Client"} assessment`;
      elements.readOnly.classList.toggle("hidden", workingSet.editable);
      render();
      updateConnectionState();
    } catch {
      showEmpty("Offline assessment could not open.", "Pipeline could not decrypt the active working set on this device. Reconnect before continuing; no local data was sent or exposed.");
    }
  }

  function render() {
    renderSections();
    renderQuestions();
    renderProgress();
  }

  function renderSections() {
    elements.sections.replaceChildren(...workingSet.sections.map((section) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.section = section.key;
      if (section.key === activeSection) button.setAttribute("aria-current", "step");
      const label = document.createElement("span");
      label.textContent = section.label;
      const count = document.createElement("small");
      const visible = visibleQuestions(section.key);
      count.textContent = `${visible.filter((question) => hasValue(workingSet.draft.data[question.field])).length}/${visible.length}`;
      button.append(label, count);
      button.addEventListener("click", () => {
        activeSection = section.key;
        render();
      });
      return button;
    }));
  }

  function renderQuestions() {
    const section = workingSet.sections.find((item) => item.key === activeSection) || workingSet.sections[0];
    const questions = visibleQuestions(section.key);
    elements.sectionNumber.textContent = `Offline interview · section ${workingSet.sections.indexOf(section) + 1} of ${workingSet.sections.length}`;
    elements.sectionTitle.textContent = section.label;
    elements.sectionDescription.textContent = section.description;

    const grouped = [];
    for (const question of questions) {
      let group = grouped.find((item) => item.label === question.group);
      if (!group) {
        group = { label: question.group, questions: [] };
        grouped.push(group);
      }
      group.questions.push(question);
    }

    elements.groups.replaceChildren(...grouped.map((group) => {
      const sectionElement = document.createElement("section");
      sectionElement.className = "group";
      const title = document.createElement("h3");
      title.textContent = group.label;
      const grid = document.createElement("div");
      grid.className = "grid";
      grid.append(...group.questions.map(renderQuestion));
      sectionElement.append(title, grid);
      return sectionElement;
    }));
  }

  function renderQuestion(question) {
    const wrapper = document.createElement("div");
    wrapper.className = `field${question.span === "full" || question.control === "multi_select" ? " full" : ""}`;
    const id = `offline-${question.field}`;
    const required = question.required || Boolean(question.requiredWhen && matchesRule(question.requiredWhen));
    const label = document.createElement(question.control === "multi_select" ? "legend" : "label");
    if (question.control !== "multi_select") label.htmlFor = id;
    label.textContent = question.label;
    if (required) {
      const marker = document.createElement("span");
      marker.className = "required";
      marker.textContent = " *";
      label.append(marker);
    }

    const field = question.control === "multi_select"
      ? renderMultiSelect(question, id)
      : question.control === "textarea"
        ? renderTextarea(question, id)
        : question.control === "select" || question.control === "yes_no" || question.control === "rating"
          ? renderSelect(question, id)
          : renderInput(question, id);
    wrapper.append(label, field);

    if (question.help) {
      const help = document.createElement("p");
      help.className = "help";
      help.textContent = question.help;
      wrapper.append(help);
    }
    if (workingSet.draft.data[question.field] === "unable_to_assess") {
      wrapper.append(renderUnableReason(question));
    }
    return wrapper;
  }

  function renderInput(question, id) {
    const input = document.createElement("input");
    input.id = id;
    input.type = question.control === "date" ? "date" : question.control === "number" ? "number" : "text";
    input.value = textValue(workingSet.draft.data[question.field]);
    input.placeholder = question.placeholder || "";
    if (question.min !== undefined) input.min = String(question.min);
    if (question.max !== undefined) input.max = String(question.max);
    input.disabled = !workingSet.editable;
    input.addEventListener("input", () => {
      const value = question.control === "number" ? input.value === "" ? null : Number(input.value) : input.value || null;
      updateField(question, value, false);
    });
    return input;
  }

  function renderTextarea(question, id) {
    const textarea = document.createElement("textarea");
    textarea.id = id;
    const current = workingSet.draft.data[question.field];
    textarea.value = Array.isArray(current) ? current.join("\n") : textValue(current);
    textarea.placeholder = question.placeholder || "";
    textarea.disabled = !workingSet.editable;
    textarea.addEventListener("input", () => {
      const existing = workingSet.draft.data[question.field];
      const value = Array.isArray(existing)
        ? textarea.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
        : textarea.value || null;
      updateField(question, value, false);
    });
    return textarea;
  }

  function renderSelect(question, id) {
    const select = document.createElement("select");
    select.id = id;
    select.disabled = !workingSet.editable;
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = "Select";
    select.append(blank);
    const options = question.control === "rating"
      ? Array.from({ length: (question.max || 5) - (question.min || 1) + 1 }, (_, index) => {
        const value = String((question.min || 1) + index);
        return { value, label: value };
      })
      : question.options || [];
    for (const option of options) {
      const element = document.createElement("option");
      element.value = option.value;
      element.textContent = option.label;
      select.append(element);
    }
    select.value = textValue(workingSet.draft.data[question.field]);
    select.addEventListener("change", () => {
      const value = question.control === "rating" ? select.value === "" ? null : Number(select.value) : select.value || null;
      updateField(question, value, true);
    });
    return select;
  }

  function renderMultiSelect(question, id) {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "choices";
    fieldset.id = id;
    fieldset.disabled = !workingSet.editable;
    const selected = Array.isArray(workingSet.draft.data[question.field]) ? workingSet.draft.data[question.field] : [];
    for (const option of question.options || []) {
      const label = document.createElement("label");
      label.className = "choice";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = option.value;
      input.checked = selected.includes(option.value);
      const text = document.createElement("span");
      text.textContent = option.label;
      input.addEventListener("change", () => {
        const next = new Set(Array.isArray(workingSet.draft.data[question.field]) ? workingSet.draft.data[question.field] : []);
        if (input.checked) next.add(option.value);
        else next.delete(option.value);
        updateField(question, [...next], true);
      });
      label.append(input, text);
      fieldset.append(label);
    }
    return fieldset;
  }

  function renderUnableReason(question) {
    const wrapper = document.createElement("div");
    wrapper.className = "unable";
    const label = document.createElement("label");
    const id = `offline-${question.field}-reason`;
    label.htmlFor = id;
    label.textContent = "Why could this not be assessed?";
    const textarea = document.createElement("textarea");
    textarea.id = id;
    textarea.disabled = !workingSet.editable;
    textarea.value = workingSet.draft.data.unable_to_assess_reasons?.[question.field] || "";
    textarea.addEventListener("input", () => {
      const reasons = { ...(workingSet.draft.data.unable_to_assess_reasons || {}) };
      if (textarea.value.trim()) reasons[question.field] = textarea.value;
      else delete reasons[question.field];
      workingSet.draft.data.unable_to_assess_reasons = reasons;
      markDirty(question.section);
    });
    wrapper.append(label, textarea);
    return wrapper;
  }

  function updateField(question, value, rerender) {
    workingSet.draft.data[question.field] = value;
    if (value !== "unable_to_assess" && workingSet.draft.data.unable_to_assess_reasons) {
      delete workingSet.draft.data.unable_to_assess_reasons[question.field];
    }
    markDirty(question.section);
    if (rerender) render();
    else renderProgress();
  }

  function markDirty(section) {
    const dirty = new Set(workingSet.draft.dirtySections || []);
    dirty.add(section);
    workingSet.draft.dirtySections = [...dirty];
    workingSet.draft.savedAt = new Date().toISOString();
    workingSet.savedAt = workingSet.draft.savedAt;
    elements.saveStatus.textContent = "Saving encrypted draft on this device...";
    saveChain = saveChain.then(saveWorkingSet).catch(() => {
      elements.saveStatus.textContent = "Local save failed · keep this window open";
    });
  }

  async function saveWorkingSet() {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: encode(`${activeRecord.principal}:${activeRecord.recordId}`) },
      encryptionKey,
      encode(JSON.stringify(workingSet)),
    );
    const now = Date.now();
    storedRecord = { ...storedRecord, iv: iv.buffer, ciphertext, updatedAt: now, expiresAt: now + EXPIRY_MS };
    activeRecord = { ...activeRecord, updatedAt: now, expiresAt: now + EXPIRY_MS };
    const transaction = database.transaction([RECORDS_STORE, ACTIVE_STORE], "readwrite");
    transaction.objectStore(RECORDS_STORE).put(storedRecord);
    transaction.objectStore(ACTIVE_STORE).put(activeRecord);
    await transactionDone(transaction);
    elements.saveStatus.textContent = "Saved on this device · syncs after reconnect";
  }

  function renderProgress() {
    const visible = workingSet.questions.filter((question) => isVisible(question));
    const answered = visible.filter((question) => hasValue(workingSet.draft.data[question.field])).length;
    const percent = visible.length ? Math.round((answered / visible.length) * 100) : 100;
    elements.progressCount.textContent = `${answered}/${visible.length}`;
    elements.progressBar.style.width = `${percent}%`;
    for (const button of elements.sections.querySelectorAll("button")) {
      const questions = visibleQuestions(button.dataset.section);
      button.querySelector("small").textContent = `${questions.filter((question) => hasValue(workingSet.draft.data[question.field])).length}/${questions.length}`;
    }
  }

  function visibleQuestions(section) {
    return workingSet.questions.filter((question) => question.section === section && isVisible(question));
  }

  function isVisible(question) {
    return !question.showWhen || matchesRule(question.showWhen);
  }

  function matchesRule(rule) {
    const current = workingSet.draft.data[rule.field];
    if (rule.operator === "includes") return Array.isArray(current) && typeof rule.value === "string" && current.includes(rule.value);
    if (rule.operator === "one_of") return !Array.isArray(current) && Array.isArray(rule.value) && rule.value.includes(String(current ?? ""));
    if (rule.operator === "not_equals") return hasValue(current) && String(current) !== rule.value;
    return !Array.isArray(current) && String(current ?? "") === rule.value;
  }

  function firstUsefulSection(value) {
    const dirty = value.draft.dirtySections?.[0];
    return value.sections.some((section) => section.key === dirty) ? dirty : value.sections[0].key;
  }

  function hasValue(value) {
    if (Array.isArray(value)) return value.some((item) => String(item).trim());
    if (typeof value === "string") return value.trim().length > 0;
    if (value && typeof value === "object") return Object.keys(value).length > 0;
    return value !== null && value !== undefined;
  }

  function textValue(value) {
    if (value === null || value === undefined) return "";
    return String(value);
  }

  function updateConnectionState() {
    if (navigator.onLine) {
      elements.returnOnline.disabled = false;
      elements.returnOnline.textContent = "Return to Pipeline and sync";
    } else {
      elements.returnOnline.disabled = true;
      elements.returnOnline.textContent = "Offline · reconnect to sync";
    }
  }

  function showEmpty(title, detail) {
    elements.app.classList.add("hidden");
    elements.empty.classList.remove("hidden");
    elements.emptyTitle.textContent = title;
    elements.emptyDetail.textContent = detail;
    elements.retry.classList.remove("hidden");
  }

  function validWorkingSet(value) {
    return Boolean(
      value
      && value.schema === 1
      && typeof value.returnPath === "string"
      && typeof value.editable === "boolean"
      && value.draft?.schema === 1
      && value.draft?.data
      && Array.isArray(value.sections)
      && value.sections.length > 0
      && Array.isArray(value.questions),
    );
  }

  function safeReturnPath(value) {
    return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.includes("\n") && !value.includes("\r")
      ? value
      : scopeRoot();
  }

  function scopeRoot() {
    return window.location.pathname.replace(/\/offline-assessment\.html$/, "/");
  }

  async function clearExpiredActiveRecord() {
    if (!database || !activeRecord) return;
    const transaction = database.transaction([ACTIVE_STORE, RECORDS_STORE], "readwrite");
    transaction.objectStore(ACTIVE_STORE).delete(ACTIVE_KEY);
    if (activeRecord.recordId) transaction.objectStore(RECORDS_STORE).delete(activeRecord.recordId);
    await transactionDone(transaction);
  }

  function openDatabase() {
    if (!("indexedDB" in window) || !crypto?.subtle) return Promise.reject(new Error("Encrypted storage is unavailable."));
    return new Promise((resolve, reject) => {
      const opening = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      opening.onupgradeneeded = () => {
        const db = opening.result;
        if (!db.objectStoreNames.contains(KEYS_STORE)) db.createObjectStore(KEYS_STORE, { keyPath: "id" });
        if (!db.objectStoreNames.contains(RECORDS_STORE)) {
          const records = db.createObjectStore(RECORDS_STORE, { keyPath: "id" });
          records.createIndex("principal", "principal");
        }
        if (!db.objectStoreNames.contains("mutations")) {
          const mutations = db.createObjectStore("mutations", { keyPath: "id" });
          mutations.createIndex("principal", "principal");
        }
        if (!db.objectStoreNames.contains(ACTIVE_STORE)) db.createObjectStore(ACTIVE_STORE, { keyPath: "id" });
      };
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error || new Error("Offline storage could not be opened."));
    });
  }

  async function decryptWorkingSet(key, principal, recordId, value) {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: value.iv, additionalData: encode(`${principal}:${recordId}`) },
      key,
      value.ciphertext,
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
  }

  function request(value) {
    return new Promise((resolve, reject) => {
      value.onsuccess = () => resolve(value.result);
      value.onerror = () => reject(value.error || new Error("Offline storage operation failed."));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Offline storage transaction failed."));
      transaction.onabort = () => reject(transaction.error || new Error("Offline storage transaction was aborted."));
    });
  }

  function encode(value) {
    return new TextEncoder().encode(value);
  }
})();
