import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export async function readPdfText(bytes: Uint8Array) {
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  try {
    const document = await task.promise;
    const pages: string[] = [];
    for (let page = 1; page <= document.numPages; page++) {
      const content = await (await document.getPage(page)).getTextContent();
      pages.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
    }
    // PDF text runs may include their own spacing between glyph groups.
    // Content assertions should compare words, independent of that segmentation.
    return pages.join(" ").replace(/\s+/g, " ").trim();
  } finally { await task.destroy(); }
}
