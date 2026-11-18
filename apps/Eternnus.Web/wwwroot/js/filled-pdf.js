import { api } from "./api.js";
import { pdfFieldBox, sheetPdfPath } from "./character-policy.js";
import { isListField, lineFieldNames, fitLine, noteSections, wrapWords, pdfText } from "./item-notes-policy.js";

/** Nome para o anexo: campo com papel "name", senão o nome da ficha ou o primeiro valor (como o nome do arquivo). */
function characterTitle(sheet) {
  const field = (sheet.version?.fields || []).find((f) => f.role === "name");
  const value = field ? sheet.values?.[field.name] : "";
  return String(value || sheet.name || Object.values(sheet.values || {})[0] || "").trim();
}

/**
 * Descrições por item (ADR-098) em páginas anexas, só texto com as fontes padrão: sem links, formulários nem scripts.
 * Mesmo tamanho da primeira página da ficha; pagina quando o espaço acaba.
 */
async function appendItemNotes(output, { StandardFonts, rgb }, sections, name, [width, height]) {
  const regular = await output.embedFont(StandardFonts.Helvetica);
  const bold = await output.embedFont(StandardFonts.HelveticaBold);
  const charset = new Set(regular.getCharacterSet());
  const safe = (text) => pdfText(text, (cp) => charset.has(cp));
  const margin = Math.min(40, width / 8, height / 8);
  const ink = rgb(0.07, 0.07, 0.07), gold = rgb(0.447, 0.361, 0.208);
  let page = null, y = 0;
  const newPage = () => { page = output.addPage([width, height]); y = height - margin; };
  const lines = (text, font, size, indent = 0) =>
    wrapWords(safe(text), Math.max(size, width - 2 * margin - indent), (t) => font.widthOfTextAtSize(t, size));
  // Desenha as linhas; `keep` reserva altura extra na mesma página (título junto da primeira linha do conteúdo).
  const draw = (rows, font, size, { indent = 0, color = ink, after = 0, keep = 0 } = {}) => {
    const step = size * 1.3;
    rows.forEach((row, index) => {
      if (y - step - (index === 0 ? keep : 0) < margin) newPage();
      y -= step;
      if (row) page.drawText(row, { x: margin + indent, y: y + size * 0.25, size, font, color });
    });
    y -= after;
  };
  newPage();
  draw(lines("Descrições dos itens", bold, 16), bold, 16, { color: gold, after: name ? 0 : 8 });
  if (name) draw(lines(name, regular, 11), regular, 11, { after: 8 });
  for (const section of sections) {
    draw(lines(section.label, bold, 12), bold, 12, { color: gold, after: 3, keep: 10 * 1.3 * 2 });
    for (const { item, text } of section.items) {
      draw(lines(item, bold, 10), bold, 10, { keep: 10 * 1.3 });
      draw(lines(text, regular, 10, 10), regular, 10, { indent: 10, after: 6 });
    }
    y -= 6;
  }
}

// Rebuild each rendered page in a new PDF: original JavaScript, forms, links and attachments are not copied.
export async function filledPdf(sheet, { signal } = {}) {
  const pdfLib = await import("/vendor/pdf-lib/pdf-lib.esm.min.js");
  const { PDFDocument } = pdfLib;
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
    // Listas e colunas de lista (ADR-098): um texto por linha, como na tela.
    const lineNames = lineFieldNames(version.fields, version.pages);
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
        if (lineNames.has(field.name) || (field.type === "text" && isListField(field))) {
          // Sem quebra: cada linha é um item e o que não couber termina em "…".
          const width = Math.max(1, box.w - 4), measure = (t) => ctx.measureText(t).width;
          text.replace(/\r/g, "").split("\n").forEach((raw, row) => {
            const fitted = fitLine(raw.trim(), width, measure);
            if (fitted) ctx.fillText(fitted, x, valueTop + row * size * 1.2);
          });
        } else {
          const words = text.replace(/\r/g, "").split(/(\n|\s+)/);
          let line = "", row = 0;
          const flush = () => { ctx.fillText(line.trim(), x, valueTop + row++ * size * 1.2); line = ""; };
          for (const word of words) {
            if (word === "\n") { flush(); continue; }
            if (line && ctx.measureText(line + word).width > box.w - 4) flush();
            line += word;
          }
          if (line) flush();
        }
        ctx.restore();
      }
      const image = await output.embedJpg(canvas.toDataURL("image/jpeg", 0.94));
      output.addPage([page.width, page.height]).drawImage(image, { x: 0, y: 0, width: page.width, height: page.height });
      canvas.width = 0; canvas.height = 0;
    }
    // Descrições por item (ADR-098) depois das páginas da ficha; sem descrições, o PDF não muda.
    const sections = noteSections(version.fields, sheet.values, sheet.notes);
    if (sections.length) {
      signal?.throwIfAborted();
      await appendItemNotes(output, pdfLib, sections, characterTitle(sheet), [pages[0].width, pages[0].height]);
    }
    return new Blob([await output.save()], { type: "application/pdf" });
  } finally { await source?.destroy(); }
}
