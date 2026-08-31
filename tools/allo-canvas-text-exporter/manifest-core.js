(() => {
  "use strict";

  const parseCsvRows = (text) => {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (quoted) {
        if (character === '"' && text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else if (character === '"') quoted = false;
        else field += character;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === ",") {
        row.push(field);
        field = "";
      } else if (character === "\n") {
        row.push(field.replace(/\r$/, ""));
        rows.push(row);
        row = [];
        field = "";
      } else field += character;
    }
    if (quoted) throw new Error("The selected manifest has an unterminated quoted field.");
    if (field || row.length) {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
    }
    return rows;
  };

  const canvasesFromManifest = (text) => {
    const rows = parseCsvRows(text);
    const headerIndex = rows.findIndex((row) => row.includes("canvas_id"));
    if (headerIndex < 0) throw new Error("This CSV does not contain a canvas_id column.");
    const headers = rows[headerIndex];
    const column = (name) => headers.indexOf(name);
    const idIndex = column("canvas_id");
    const nameIndex = column("canvas_name");
    const projectIdIndex = column("project_id");
    const projectNameIndex = column("project_name");
    const canvases = new Map();
    for (const row of rows.slice(headerIndex + 1)) {
      const id = String(row[idIndex] || "").trim();
      if (!id) continue;
      const existing = canvases.get(id) || {};
      canvases.set(id, {
        ...existing,
        id,
        name: String(row[nameIndex] || existing.name || "").trim(),
        project_id: String(row[projectIdIndex] || existing.project_id || "").trim(),
        project_name: String(row[projectNameIndex] || existing.project_name || "").trim(),
        url: `https://allo.io/canvases?task=${encodeURIComponent(id)}`,
        catalog_source: "allo-file-manifest"
      });
    }
    return [...canvases.values()];
  };

  globalThis.AlloCanvasManifestCore = { canvasesFromManifest, parseCsvRows };
})();
