import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const { evidenceLink } = loadTypeScriptModule(process.cwd(), "lib/extraction/evidence-link.ts");

test("source links preserve ordinary evidence paths and HTTP URLs", () => {
  for (const value of ["/api/packets/7/evidence/name?page=2#source", "https://example.test/source.pdf", "http://localhost:3216/api/evidence/7"]) {
    assert.equal(evidenceLink(value), value);
  }
  assert.equal(evidenceLink("//example.test/source.pdf"), "https://example.test/source.pdf");
});

test("source links reject executable protocols including mixed case and embedded controls", () => {
  for (const value of [undefined, "", " ", "javascript:alert(1)", "JaVaScRiPt:alert(1)", "java\nscript:alert(1)", "\tjavascript:alert(1)", "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)", "file:///private/source.pdf", "workbook://source", "https://["]) {
    assert.equal(evidenceLink(value), null, String(value));
  }
});
