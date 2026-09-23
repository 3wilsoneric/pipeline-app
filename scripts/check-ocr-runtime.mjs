import assert from "node:assert/strict";
import { createCanvas, GlobalFonts, PDFDocument } from "@napi-rs/canvas";
import english from "@tesseract.js-data/eng";
import { createWorker } from "tesseract.js";

// Run inside the final image: loading the public API alone does not exercise
// the worker's dynamic dependencies, WASM, installed language data or canvas.
const canvas = createCanvas(64, 64);
// Exercise the same native writer and runtime font used by packet data sheets.
assert.ok(GlobalFonts.has("Noto Sans"), "Client data sheets require the packaged Noto Sans font");
const pdf = new PDFDocument();
const pdfContext = pdf.beginPage(612, 792);
pdfContext.font = '12px "Noto Sans"';
pdfContext.fillText("Client data sheet - José", 44, 44);
pdf.endPage();
assert.equal(pdf.close().subarray(0, 5).toString(), "%PDF-");
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
