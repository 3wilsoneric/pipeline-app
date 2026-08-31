import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const context = vm.createContext({ globalThis: {} });
vm.runInContext(fs.readFileSync(new URL("../manifest-core.js", import.meta.url), "utf8"), context);
const ManifestCore = context.globalThis.AlloCanvasManifestCore;

const manifest = [
  "# ALLO read-only inventory",
  '"object_id","project_id","project_name","canvas_id","canvas_name"',
  '"file-1","project-1","June, Admissions","canvas-1","Client ""One"""',
  '"file-2","project-1","June, Admissions","canvas-1","Client ""One"""',
  '"file-3","project-2","July Admissions","canvas-2","Client Two"'
].join("\r\n");

const canvases = ManifestCore.canvasesFromManifest(manifest);
assert.equal(canvases.length, 2);
assert.equal(canvases[0].id, "canvas-1");
assert.equal(canvases[0].name, 'Client "One"');
assert.equal(canvases[0].project_name, "June, Admissions");
assert.match(canvases[0].url, /task=canvas-1/);
assert.throws(() => ManifestCore.canvasesFromManifest("not,a,manifest"), /canvas_id/);
assert.throws(() => ManifestCore.parseCsvRows('"unterminated'), /unterminated/);

console.log("ALLO file manifest parsing and canvas deduplication tests passed");
