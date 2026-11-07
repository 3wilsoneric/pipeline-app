import assert from "node:assert/strict";
import test from "node:test";
import { loadEntry } from "./contact-import-fixtures.mjs";
const { createEditorHistory, messageKey, recordEditorChange, stepEditorHistory } = loadEntry("components/pipeline/meet-client-editor-history.ts");
const message = text => ({ subject: null, body: null, sectionEdits: { bio: { text, source: "Original" } } });

test("typing groups undo together; layout, reset and note changes stay reversible", () => {
  const initial = message("Original");
  let history = createEditorHistory(initial);
  history = recordEditorChange(history, initial, message("A"), "bio", "bio", 1000);
  history = recordEditorChange(history, history.present.message, message("AB"), "bio", "bio", 1200);
  assert.equal(history.past.length, 1);
  const formatted = { ...history.present.message, sectionFormats: { bio: "bullets" } };
  history = recordEditorChange(history, history.present.message, formatted, "bio", "", 1300);
  assert.equal(history.past.length, 2);
  history = stepEditorHistory(history, "undo");
  assert.equal(history.present.message.sectionEdits.bio.text, "AB");
  assert.equal(history.present.message.sectionFormats, undefined);
  history = stepEditorHistory(history, "undo");
  assert.equal(messageKey(history.present.message), messageKey(initial));
  history = stepEditorHistory(stepEditorHistory(history, "redo"), "redo");
  assert.equal(messageKey(history.present.message), messageKey(formatted));
  const note = { ...formatted, note: "Keep this clinical note." };
  history = recordEditorChange(history, formatted, note, "message");
  history = recordEditorChange(history, note, formatted, "message");
  history = stepEditorHistory(history, "undo");
  assert.equal(history.present.message.note, note.note);
});

test("history stops at external updates and bounds retained edits without persisting them", () => {
  let history = createEditorHistory(message("Start"));
  for (let i = 0; i < 70; i++) history = recordEditorChange(history, history.present.message, message(String(i)), "bio", "", i * 1000);
  assert.equal(history.past.length, 50);
  history = stepEditorHistory(history, "undo");
  history = recordEditorChange(history, history.present.message, message("New direction"), "bio");
  assert.equal(history.future.length, 0);
  const external = message("Reloaded from another session");
  history = recordEditorChange(history, external, message("Next edit"), "bio");
  assert.equal(history.past.length, 1);
  history = stepEditorHistory(history, "undo");
  assert.equal(messageKey(history.present.message), messageKey(external));
  const order = ["message", "bio", "coordination", "medications", "safety", "diet", "billing", "support"];
  assert.equal(messageKey(message("Same")), messageKey({ ...message("Same"), sectionOrder: order, sectionFormats: {} }));
});
