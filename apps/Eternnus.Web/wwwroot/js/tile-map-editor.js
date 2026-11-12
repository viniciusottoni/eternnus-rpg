import { api } from "./api.js";
import { $, esc, modal, formError, submitForm, toast } from "./ui.js";
import { helpButton } from "./help.js";
import { createBoard } from "./table-map.js";
import { drawTile } from "./tile-art.js";
import { blankTiles, resizeTiles, paintTiles, tileMapError } from "./tile-map-policy.js";

export async function openTileMapEditor(campaign, { item = null, source = null, folders = [], folderId = "", onSaved = () => {} } = {}) {
  const base = `/campaigns/${campaign.id}/assets`;
  const [catalog, saved] = await Promise.all([
    api(`${base}/tile-catalog`), item ? api(`${base}/tile-maps/${item.id}`) : Promise.resolve(null),
  ]);
  let rows = [...(saved?.rows || source?.rows || blankTiles())], selected = ",", tool = "brush", dirty = false, busy = false, disposed = false;
  const undo = [], redo = [], tiles = catalog.items;
  modal(saved ? "Editar mapa de tiles" : source ? "Criar a partir de cenário" : "Criar mapa de tiles", `
    <form id="tm-form" class="tile-editor">
      <p class="form-help">Pinte seu cenário e salve no acervo. Só o Mestre edita; o grupo vê quando você mostrar na mesa.${helpButton("campanhas.mapas.tiles", "Criar mapas com tiles")}</p>
      <div class="tm-fields">
        <label>Nome<input name="name" maxlength="120" required value="${esc(saved?.name || (source ? source.name.slice(0,112) + " — cópia" : ""))}"></label>
        <label>Pasta<select name="folderId"><option value="">Mapas e cenários</option>${folders.map(f=>`<option value="${esc(f.id)}" ${f.id===(saved?.folderId||folderId)?"selected":""}>${esc(f.name)}</option>`).join("")}</select></label>
        <label>Metros por casa<input name="scaleMeters" type="number" min="0.01" max="1000" step="0.01" value="${saved?.scaleMeters || source?.scaleMeters || 1.5}" required></label>
      </div>
      <details class="tm-size"><summary>Tamanho e terreno inicial</summary><div class="tm-fields">
        <label>Colunas<input name="columns" type="number" min="8" max="64" value="${rows[0].length}"></label>
        <label>Linhas<input name="rows" type="number" min="8" max="64" value="${rows.length}"></label>
        <label>Terreno<select name="ground">${tiles.filter(t=>t.group==="Terrenos"&&t.walkable).map(t=>`<option value="${esc(t.code)}" ${t.code===","?"selected":""}>${esc(t.name)}</option>`).join("")}</select></label>
        <button type="button" data-tm="resize">Redimensionar</button><button type="button" data-tm="blank">Recomeçar vazio</button>
      </div><p class="form-help">8–64 casas por lado. Redimensionar preserva o canto superior esquerdo e corta o excedente. Desfazer recupera a edição anterior. Reserve seis entradas para o grupo.</p></details>
      <div class="tm-toolbar" role="group" aria-label="Ferramentas de desenho">
        <label>Ferramenta<select name="tool"><option value="brush">Pincel</option><option value="rectangle">Retângulo preenchido</option><option value="fill">Preencher área ligada</option><option value="pick">Capturar tile</option></select></label>
        <button type="button" data-tm="undo" disabled>Desfazer</button><button type="button" data-tm="redo" disabled>Refazer</button>
        <label class="check"><input name="grid" type="checkbox" checked> Mostrar grade</label>
      </div>
      <p id="tm-hint" class="form-help">Escolha um tile e arraste no mapa. Pelo teclado, use setas e Enter. Para percorrer, use Arrastar mapa; pinça e ± ajustam o zoom.</p>
      <div class="tm-layout"><aside class="tm-palette" aria-label="Catálogo de tiles">
        <label>Grupo<select name="group"><option value="">Todos os tiles</option>${[...new Set(tiles.map(t=>t.group))].map(g=>`<option>${esc(g)}</option>`).join("")}</select></label>
        <div class="tm-tiles">${tiles.map((t,i)=>`<button type="button" class="tm-tile" data-tile="${i}" aria-pressed="${t.code===selected}" aria-label="${esc(t.name)}: ${t.walkable?"passagem livre":t.blocksSight?"bloqueia passagem e visão":"bloqueia passagem"}"><canvas width="64" height="64" aria-hidden="true"></canvas><span>${esc(t.name)}</span></button>`).join("")}</div>
      </aside><section class="tm-stage" aria-label="Desenho do mapa"><div class="tm-camera"></div><div class="board tm-board" aria-describedby="tm-hint"></div></section></div>
      <p id="tm-status" role="status"></p>
      ${saved ? '<label class="check"><input name="resetPreparation" type="checkbox"> Ao mudar o terreno, recriar névoa, paredes, luzes e marcas e remover os marcadores preparados/salvos das cenas que usam este mapa.</label><p class="form-help">A opção acima só é necessária quando o terreno já tem preparação. Textos e fichas de personagens são mantidos; os marcadores precisam ser posicionados novamente. Salvar cópia preserva o mapa original. Para editar um mapa em uso, troque-o na mesa primeiro.</p>' : ''}
      ${formError()}<div class="form-actions"><button type="button" class="subtle" data-tm="close">Cancelar</button>${saved?'<button type="button" data-tm="copy">Salvar cópia</button>':''}<button type="submit" class="primary">Salvar mapa</button></div>
    </form>`);
  const dialog = $("#modal"), form = $("#tm-form"); dialog.classList.add("wide", "tile-map-dialog");
  const input = name=>form.elements.namedItem(name);
  const button = action=>form.querySelector(`[data-tm="${action}"]`);
  const board = createBoard(form.querySelector(".tm-board"), {
    camera:form.querySelector(".tm-camera"),
    onPaint: (cells,end)=>{
      if(busy) return;
      if(tool==="pick") {const cell=cells[0];if(cell) select(rows[cell.y][cell.x]);return;}
      change(paintTiles(rows,tool==="rectangle"&&cells.length?[cells[0],end||cells.at(-1)]:cells,selected,tool));
    },
  });
  function draw() {
    if(disposed)return;
    board.update({map:{kind:"tileset",key:saved?.key||"draft",name:input("name").value,rows},tokens:[],participants:[],session:{},me:{isMaster:true}}, {mode:"paint",grid:input("grid").checked,paint:[]});
    const tile=tiles.find(t=>t.code===selected), count=rows.join("").split("S").length-1;
    $("#tm-status").textContent=`${dirty?"Alterações não salvas · ":""}${rows[0].length} × ${rows.length} casas · ${count}/6 entradas mínimas · ${tile.name}: ${tile.walkable?"passagem livre":tile.blocksSight?"bloqueia passagem e visão":"bloqueia passagem"}.`;
    button("undo").disabled=busy||!undo.length;button("redo").disabled=busy||!redo.length;
  }
  function change(next) {
    if(next.join("\n")===rows.join("\n")) return;
    undo.push(rows);if(undo.length>30)undo.shift();redo.length=0;rows=next;dirty=true;syncSize();draw();
  }
  function syncSize() {input("columns").value=rows[0].length;input("rows").value=rows.length;}
  function select(code) {
    selected=code;if(tool==="pick")tool="brush";input("tool").value=tool;
    for(const b of form.querySelectorAll("[data-tile]"))b.setAttribute("aria-pressed",String(tiles[Number(b.dataset.tile)].code===code));
    board.interact();draw();
  }
  for(const b of form.querySelectorAll("[data-tile]")) {
    const tile=tiles[Number(b.dataset.tile)];drawTile(b.querySelector("canvas").getContext("2d"),[tile.code],0,0,64,tile.surface===",",false);
    b.onclick=()=>{if(!busy)select(tile.code);};
  }
  form.addEventListener("change", e=>{
    if(e.target.name==="group")for(const b of form.querySelectorAll("[data-tile]"))b.hidden=!!e.target.value&&tiles[Number(b.dataset.tile)].group!==e.target.value;
    if(e.target.name==="tool") {tool=e.target.value;board.interact();}
    if(["name","folderId","scaleMeters"].includes(e.target.name))dirty=true;
    draw();
  });
  function close() {if(!busy&&(!dirty||confirm("Descartar as alterações não salvas deste mapa?")))dialog.close();}
  const cancel=e=>{if(dirty||busy){e.preventDefault();close();}};
  const closeButton=$("#close-modal"),guard=e=>{e.preventDefault();e.stopImmediatePropagation();close();};
  dialog.addEventListener("cancel",cancel);closeButton.addEventListener("click",guard,true);
  const beforeUnload=e=>{if(dirty){e.preventDefault();e.returnValue="";}};window.addEventListener("beforeunload",beforeUnload);
  form.addEventListener("click",e=>{
    const action=e.target.closest("[data-tm]")?.dataset.tm;if(!action||busy)return;
    if(action==="close")return close();
    if(action==="copy")return save(true);
    if(action==="undo"&&undo.length){redo.push(rows);rows=undo.pop();dirty=true;syncSize();draw();}
    if(action==="redo"&&redo.length){undo.push(rows);rows=redo.pop();dirty=true;syncSize();draw();}
    if(action==="resize"||action==="blank") {
      const w=Number(input("columns").value),h=Number(input("rows").value);
      if(!Number.isInteger(w)||!Number.isInteger(h)||w<8||w>64||h<8||h>64){toast("Use de 8 a 64 casas por lado.");return;}
      change(action==="resize"?resizeTiles(rows,w,h,input("ground").value):blankTiles(w,h,input("ground").value));
    }
  });
  async function save(copy=false) {
    if(busy||!form.reportValidity())return;
    await submitForm(form,async data=>{
      const error=tileMapError(rows,tiles);if(error)throw new Error(error);
      busy=true;draw();
      try {
        const id=copy?null:saved?.id;
        await api(`${base}/tile-maps${id?"/"+id:""}`,id?"PUT":"POST",{
          name:data.name,folderId:data.folderId||null,scaleMeters:Number(data.scaleMeters),rows,
          revision:id?saved.revision:0,resetPreparation:!copy&&input("resetPreparation")?.checked===true,
        });
        dirty=false;dialog.close();toast(copy?"Cópia salva no acervo.":"Mapa salvo no acervo.");await onSaved();
      } finally {busy=false;if(form.isConnected)draw();}
    });
  }
  form.onsubmit=e=>{e.preventDefault();save();};
  dialog.addEventListener("close",()=>{disposed=true;board.destroy();dialog.classList.remove("tile-map-dialog");dialog.removeEventListener("cancel",cancel);closeButton.removeEventListener("click",guard,true);window.removeEventListener("beforeunload",beforeUnload);},{once:true});
  draw();board.interact();input("name").focus();
}
