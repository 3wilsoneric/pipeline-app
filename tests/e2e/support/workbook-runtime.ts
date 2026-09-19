import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { Page } from "@playwright/test";

// Run the actual browser-only importer/exporter in a browser, not a parser stub.
export async function workbookRuntime(page: Page) {
  const modules: Record<string, { code: string; imports: Record<string, string> }> = {};
  const visit = (file: string) => {
    if (modules[file]) return;
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    const imports: Record<string, string> = {};
    modules[file] = { code, imports };
    for (const [, name] of code.matchAll(/require\("([^"]+)"\)/g)) {
      if (name === "fflate") continue;
      const base = name.startsWith("@/") ? path.resolve(name.slice(2)) : path.resolve(path.dirname(file), name);
      const target = [base, `${base}.ts`, `${base}.tsx`].find((candidate) => fs.existsSync(candidate));
      if (!target) throw new Error(`Unexpected workbook test dependency: ${name}`);
      imports[name] = target; visit(target);
    }
  };
  const entry = path.resolve("lib/assessment/assessment-excel-backup.ts");
  const contract = path.resolve("lib/assessment/assessment-workbook-contract.ts");
  const tool = path.resolve("lib/assessment/assessment-tool-schema.ts");
  visit(entry); visit(contract); visit(tool);
  await page.addScriptTag({ path: path.resolve("node_modules/fflate/umd/index.js") });
  await page.addScriptTag({ content: `(() => { const modules=${JSON.stringify(modules)}, cache={}; function load(id) { if(id==='fflate') return window.fflate; if(cache[id]) return cache[id].exports; const mod=cache[id]={exports:{}}; new Function('module','exports','require',modules[id].code)(mod,mod.exports,(name)=>load(modules[id].imports[name]||name));return mod.exports; } window.workbookTest={...load(${JSON.stringify(entry)}),...load(${JSON.stringify(contract)}),...load(${JSON.stringify(tool)})}; })();` });
}

export function changeWorkbook(bytes: Uint8Array, cells: Array<{ sheet: number; cell: string; value: string; formula?: boolean }>) {
  const archive = unzipSync(bytes);
  for (const change of cells) {
    const file = `xl/worksheets/sheet${change.sheet}.xml`;
    const escaped = change.value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    const xml = strFromU8(archive[file]);
    const pattern = new RegExp(`<c(?=\\s)[^>]*\\br="${change.cell}"[^>]*(?:\\/>|>[\\s\\S]*?<\\/c>)`);
    if (!pattern.test(xml)) throw new Error(`Cell missing: ${file}!${change.cell}`);
    archive[file] = strToU8(xml.replace(pattern, `<c r="${change.cell}" t="inlineStr"><is><t>${escaped}</t></is>${change.formula ? '<f>1+1</f>' : ''}</c>`));
  }
  return Buffer.from(zipSync(archive));
}
