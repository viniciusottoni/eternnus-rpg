import { api } from "./api.js";
import { pdfFieldBox, sheetPdfPath } from "./character-policy.js";

// Rebuild each rendered page in a new PDF: original JavaScript, forms, links and attachments are not copied.
export async function filledPdf(sheet, { signal } = {}) {
  const { PDFDocument } = await import("/vendor/pdf-lib/pdf-lib.esm.min.js");
  const output = await PDFDocument.create();
  const version = sheet.version;
  const values = { ...sheet.values, ...sheet.computed };
  let source = null;
  try {
    if (version.pdfUrl) {
      const data = await api(sheetPdfPath(version.pdfUrl), "GET", undefined, { signal, responseType: "bytes" });
      const pdfjs = await import("/vendor/pdfjs/pdf.min.js");
      pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.js";
      source = await pdfjs.getDocument({ data, isEvalSupported: false, enableScripting: false, disableAutoFetch: true, standardFontDataUrl: "/vendor/pdfjs/standard_fonts/" }).promise;
    }
    const pages = version.pages || [];
    if (!pages.length || pages.length > 50) throw new Error("Quantidade de páginas não suportada.");
    for (const [index, page] of pages.entries()) {
      signal?.throwIfAborted();
      const scale = Math.min(2, 4096 / Math.max(page.width, page.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(page.width * scale); canvas.height = Math.ceil(page.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Não foi possível preparar o PDF neste navegador.");
      ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (source) {
        if (index >= source.numPages) throw new Error("O PDF não corresponde às páginas do modelo.");
        const pdfPage = await source.getPage(index + 1);
        const viewport = pdfPage.getViewport({ scale: 1 });
        const ratio = Math.min(canvas.width / viewport.width, canvas.height / viewport.height);
        await pdfPage.render({ canvasContext: ctx, viewport: pdfPage.getViewport({ scale: ratio }), intent: "print", annotationMode: 0 }).promise;
      }
      if (!source) {
        ctx.font = `${20 * scale}px Georgia`; ctx.fillStyle = "#725c35";
        ctx.fillText(sheet.template?.name || "Ficha de personagem", 30 * scale, 20 * scale);
      }
      for (const field of version.fields.filter(f => f.page === index)) {
        const box = pdfFieldBox(field, canvas.width, canvas.height);
        const size = Math.max(6, Math.min(48, Number(field.fontSize) || 10)) * scale;
        ctx.save(); ctx.beginPath(); ctx.rect(box.x, box.y, box.w, box.h); ctx.clip();
        ctx.fillStyle = "#111"; ctx.font = `${size}px Arial`; ctx.textBaseline = "top";
        ctx.textAlign = "left";
        let valueTop = box.y + 2;
        if (!source) {
          ctx.font = `${Math.max(6, size / scale * 0.7) * scale}px Arial`;
          ctx.fillStyle = "#725c35"; ctx.textAlign = "left";
          ctx.fillText(field.label || field.name, box.x + 2, valueTop, Math.max(1, box.w - 4));
          ctx.textAlign = "left";
          valueTop += size * 0.85;
          ctx.font = `${size}px Arial`; ctx.fillStyle = "#111";
        }
        const text = field.type === "checkbox" ? (String(values[field.name]) === "true" ? "✓" : "") : String(values[field.name] ?? "");
        const x = box.x + 2;
        const words = text.replace(/\r/g, "").split(/(\n|\s+)/);
        let line = "", row = 0;
        const flush = () => { ctx.fillText(line.trim(), x, valueTop + row++ * size * 1.2); line = ""; };
        for (const word of words) {
          if (word === "\n") { flush(); continue; }
          if (line && ctx.measureText(line + word).width > box.w - 4) flush();
          line += word;
        }
        if (line) flush();
        ctx.restore();
      }
      const image = await output.embedJpg(canvas.toDataURL("image/jpeg", 0.94));
      output.addPage([page.width, page.height]).drawImage(image, { x: 0, y: 0, width: page.width, height: page.height });
      canvas.width = 0; canvas.height = 0;
    }
    return new Blob([await output.save()], { type: "application/pdf" });
  } finally { await source?.destroy(); }
}
