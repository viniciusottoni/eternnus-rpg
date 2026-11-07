export const FREE_TEMPLATE = "00000000-0000-4000-8000-000000000101";
export function editableValues(fields, values) {
  const result = Object.create(null);
  for (const field of fields || []) {
    if (field.type === "computed") continue;
    const value = Object.hasOwn(values || {}, field.name) ? values[field.name] : field.default;
    result[field.name] = value == null ? "" : String(value);
  }
  return result;
}
export function ownActions(sheet) {
  return (sheet.actions || []).filter(a => a.source !== "template" && !String(a.id).startsWith("t:"));
}
export function pdfFieldBox(field, width, height) {
  return { x: field.x * width, y: field.y * height, w: field.w * width, h: field.h * height };
}
export function downloadName(name) {
  return (String(name || "Ficha").replace(/[\\/<>:"|?*\u0000-\u001f]/g, "").trim().slice(0, 80) || "Ficha") + ".pdf";
}

export function sheetPdfPath(url) {
  if (!/^\/api\/sheet-templates\/[0-9a-f-]{36}\/versions\/[0-9a-f-]{36}\/pdf(?:\?r=\d{1,10})?$/i.test(String(url)))
    throw new Error("Endereço de PDF inválido.");
  return url.slice(4);
}
