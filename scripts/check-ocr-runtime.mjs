import assert from "node:assert/strict";
import { createCanvas } from "@napi-rs/canvas";
import english from "@tesseract.js-data/eng";
import { createWorker } from "tesseract.js";

// Run inside the final image: loading the public API alone does not exercise
// the worker's dynamic dependencies, WASM, installed language data or canvas.
const canvas = createCanvas(64, 64);
const context = canvas.getContext("2d");
context.fillStyle = "white";
context.fillRect(0, 0, 64, 64);
const timeout = setTimeout(() => process.exit(1), 30_000);
const worker = await createWorker("eng", 1, { langPath: english.langPath, cacheMethod: "none" });
try {
  const result = await worker.recognize(canvas.toBuffer("image/png"));
  assert.equal(typeof result.data.text, "string");
  console.log(JSON.stringify({ ok: true, packagedOcrWorker: true }));
} finally {
  await worker.terminate();
  clearTimeout(timeout);
}
