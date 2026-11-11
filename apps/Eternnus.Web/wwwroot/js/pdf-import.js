// Leitura local de um PDF preenchido: o arquivo não sai do navegador; scripts, XFA e eval ficam desligados.
import { IMPORT_LIMITS, importFileProblem } from "./pdf-import-policy.js";

function widgetValue(a) {
  if (a.fieldType === "Btn") {
    if (a.pushButton) return undefined;
    if (a.radioButton) return a.fieldValue != null && a.fieldValue === a.buttonValue;
    if (a.checkBox) return a.fieldValue != null && a.fieldValue !== "Off" && (a.exportValue == null || a.fieldValue === a.exportValue);
    return undefined;
  }
  if (a.fieldType === "Tx" || a.fieldType === "Ch") {
    const value = Array.isArray(a.fieldValue) ? a.fieldValue.join(", ") : a.fieldValue;
    return typeof value === "string" ? value : value == null ? "" : String(value);
  }
  return undefined;
}

/** Lê os campos de formulário (AcroForm) com posição normalizada por página. */
export async function readPdfWidgets(file, { signal } = {}) {
  const problem = importFileProblem(file);
  if (problem) throw new Error(problem);
  const data = new Uint8Array(await file.arrayBuffer());
  signal?.throwIfAborted();
  const pdfjs = await import("/vendor/pdfjs/pdf.min.js");
  pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.js";
  let doc;
  try {
    doc = await pdfjs.getDocument({ data, isEvalSupported: false, enableScripting: false, enableXfa: false, disableAutoFetch: true, standardFontDataUrl: "/vendor/pdfjs/standard_fonts/" }).promise;
  } catch {
    throw new Error("Não foi possível ler este PDF. Confira se o arquivo não está corrompido ou protegido por senha.");
  }
  try {
    if (doc.numPages > IMPORT_LIMITS.pages) throw new Error("O PDF tem páginas demais para importar.");
    const widgets = [];
    for (let index = 0; index < doc.numPages && widgets.length < IMPORT_LIMITS.widgets; index++) {
      signal?.throwIfAborted();
      const page = await doc.getPage(index + 1);
      const viewport = page.getViewport({ scale: 1 });
      for (const a of await page.getAnnotations({ intent: "display" })) {
        if (a.subtype !== "Widget") continue;
        const value = widgetValue(a);
        if (value === undefined) continue;
        const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(a.rect);
        widgets.push({
          page: index,
          name: String(a.fieldName || ""),
          value,
          rect: { x: Math.min(x1, x2) / viewport.width, y: Math.min(y1, y2) / viewport.height, w: Math.abs(x2 - x1) / viewport.width, h: Math.abs(y2 - y1) / viewport.height },
        });
      }
    }
    return widgets;
  } finally { await doc.destroy(); }
}
