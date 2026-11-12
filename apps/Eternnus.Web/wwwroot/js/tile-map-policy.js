// Regras puras do rascunho; o servidor valida novamente ao salvar.
export function blankTiles(width = 28, height = 20, ground = ",") {
  const rows = Array.from({ length: height }, () => ground.repeat(width));
  for (let y = height - 3; y < height - 1; y++) rows[y] = rows[y].slice(0, 1) + "SSS" + rows[y].slice(4);
  return rows;
}
export function resizeTiles(rows, width, height, ground) {
  return Array.from({ length: height }, (_, y) => ((rows[y] || "") + ground.repeat(width)).slice(0, width));
}
export function paintTiles(rows, cells, code, tool = "brush") {
  if (!cells.length) return rows;
  const width = rows[0].length, height = rows.length, copy = rows.map(r => [...r]);
  const inside = ({ x, y }) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < width && y < height;
  const points = cells.filter(inside);
  if (!points.length) return rows;
  if (tool === "fill") {
    const from = copy[points[0].y][points[0].x];
    if (from === code) return rows;
    const queue = [points[0]];
    while (queue.length) {
      const p = queue.pop();
      if (!inside(p) || copy[p.y][p.x] !== from) continue;
      copy[p.y][p.x] = code;
      queue.push({x:p.x-1,y:p.y},{x:p.x+1,y:p.y},{x:p.x,y:p.y-1},{x:p.x,y:p.y+1});
    }
  } else if (tool === "rectangle") {
    const a = points[0], b = points.at(-1);
    for (let y=Math.min(a.y,b.y);y<=Math.max(a.y,b.y);y++)
      for (let x=Math.min(a.x,b.x);x<=Math.max(a.x,b.x);x++) copy[y][x]=code;
  } else for (const {x,y} of points) copy[y][x]=code;
  return copy.map(r=>r.join(""));
}
export function tileMapError(rows, catalog) {
  if (!Array.isArray(rows) || rows.length < 8 || rows.length > 64 || rows.some(r=>typeof r!=="string" || r.length<8 || r.length>64 || r.length!==rows[0].length)) return "Use de 8 a 64 casas por lado.";
  const codes = new Set(catalog.map(t=>t.code));
  if (rows.some(r=>[...r].some(c=>!codes.has(c)))) return "O mapa contém tiles fora do catálogo.";
  if (rows.join("").split("S").length-1 < 6) return "Marque pelo menos seis entradas livres para o grupo.";
  return "";
}
