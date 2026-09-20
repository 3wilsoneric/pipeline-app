import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScriptModule } from "./ts-module-loader.mjs";

const { evidenceLink } = loadTypeScriptModule(process.cwd(), "lib/extraction/evidence-link.ts");

test("source links use the authenticated packet evidence route", () => {
  assert.equal(evidenceLink("packet-7", "demographics.date_of_birth"), "/api/packets/packet-7/evidence/demographics.date_of_birth");
  assert.equal(evidenceLink("packet-7", "name/page?part#source"), "/api/packets/packet-7/evidence/name%2Fpage%3Fpart%23source");
});

test("document-controlled identifiers cannot supply a protocol or escape the route", () => {
  for (const value of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "java\nscript:alert(1)", "data:text/html,<script>alert(1)</script>", "https://elsewhere.test/", "//elsewhere.test/", "../other?x#y"]) {
    const path = evidenceLink(value, value);
    assert.equal(path, `/api/packets/${encodeURIComponent(value)}/evidence/${encodeURIComponent(value)}`);
    assert.equal(new URL(path, "https://pipeline.test").origin, "https://pipeline.test");
  }
  assert.equal(evidenceLink(undefined, "name"), null);
  assert.equal(evidenceLink("", "name"), null);
  assert.equal(evidenceLink("packet-7", ""), null);
  assert.equal(evidenceLink("..", "name"), null);
  assert.equal(evidenceLink("packet-7", "."), null);
  assert.equal(evidenceLink("packet-7", "\ud800"), null);
});
