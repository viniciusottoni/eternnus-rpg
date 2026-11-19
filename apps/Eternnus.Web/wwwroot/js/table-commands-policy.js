// Ações da mesa para a Busca de ações (ADR-100, N4). Puro: recebe o contexto e devolve comandos no formato de
// command-palette-policy.js com `action`/`arg` do despacho `command()` de table.js. Testado em tests/table-commands-policy.test.mjs.
// O servidor continua decidindo permissão e estado; `disabled` só explica por que a ação não serve agora.

/**
 * ctx = { isMaster, tiles, fogOn, complete, selected: { id, characterId, masterCharacterId } | null, undoId, ended, paused, following }
 * Devolve [{ id, label, group, keywords, masterOnly, basic, disabled, action, arg }].
 */
export function tableCommands(ctx = {}) {
  const grid = ctx.tiles ? null : "Exige um mapa com grade.";
  const ended = ctx.ended ? "A sessão foi encerrada." : null;
  const sel = ctx.selected || null;
  const creature = sel && !sel.characterId;
  const list = [
    // Mestre — mapa e elementos (Básica).
    { id: "select", label: "Selecionar e mover", group: "Mapa", keywords: ["mover", "arrastar"], masterOnly: true, action: "t-tool-select", disabled: grid },
    { id: "place", label: "Adicionar personagem ou criatura", group: "Mapa", keywords: ["marcador", "npc", "inimigo", "token"], masterOnly: true, action: "t-tool-place", disabled: grid },
    { id: "gather", label: "Colocar o grupo na entrada", group: "Mapa", keywords: ["reunir", "jogadores", "posicionar"], masterOnly: true, action: "t-gather", disabled: grid },
    { id: "viewAs", label: "Ver como jogador", group: "Mapa", keywords: ["visao", "jogador"], masterOnly: true, action: "t-view-as", disabled: grid },
    { id: "upload", label: "Enviar mapa ou UVTT", group: "Mapa", keywords: ["imagem", "importar", "vtt"], masterOnly: true, action: "t-map-upload" },
    { id: "scenes", label: "Abrir as cenas", group: "Mapa", keywords: ["cena", "apresentar", "trocar"], masterOnly: true, action: "t-scenes" },
    { id: "reveal", label: "Revelar área", group: "Névoa", keywords: ["nevoa", "mostrar"], masterOnly: true, action: "t-fog-group", arg: "reveal", disabled: grid || (ctx.fogOn ? null : "A névoa está desligada neste mapa.") },
    // Mestre — Completa.
    { id: "walls", label: "Paredes e portas", group: "Névoa", keywords: ["parede", "porta", "bloqueio"], masterOnly: true, basic: false, action: "t-fog-group", arg: "walls", disabled: grid },
    { id: "lightTools", label: "Focos de luz", group: "Névoa", keywords: ["luz", "tocha", "lanterna", "iluminar"], masterOnly: true, basic: false, action: "t-fog-group", arg: "light", disabled: grid },
    { id: "explore", label: "Exploração e marcas ocultas", group: "Névoa", keywords: ["armadilha", "porta secreta", "pista", "marca"], masterOnly: true, basic: false, action: "t-fog-group", arg: "explore", disabled: grid },
    { id: "tokenSenses", label: "Luz e visão do marcador selecionado", group: "Elementos", keywords: ["visao no escuro", "tocha", "sentidos"], masterOnly: true, basic: false, action: "t-token-settings", disabled: sel ? null : "Selecione um marcador no mapa." },
    { id: "tokenEdit", label: "Editar marcador selecionado", group: "Elementos", keywords: ["nome", "lado", "ficha"], masterOnly: true, action: "t-token-edit", disabled: creature ? null : "Selecione uma criatura no mapa." },
    { id: "tokenRemove", label: "Remover marcador selecionado", group: "Elementos", keywords: ["apagar", "excluir", "delete", "token"], masterOnly: true, action: "t-tool-remove", disabled: creature ? null : "Selecione uma criatura no mapa." },
    { id: "tableSettings", label: "Configuração da mesa", group: "Sessão", keywords: ["nevoa", "tochas", "regras"], masterOnly: true, basic: false, action: "t-table-settings" },
    // Participantes (ADR-114/115): câmera compartilhada, exibição externa e convidados — interface Completa.
    { id: "showRegion", label: "Mostrar esta região aos participantes", group: "Mapa", keywords: ["camera", "enquadrar", "seguir", "foco"], masterOnly: true, basic: false, action: "t-show-region", disabled: grid },
    { id: "externalDisplay", label: "Abrir exibição externa", group: "Sessão", keywords: ["tv", "projetor", "segunda tela", "telao"], masterOnly: true, basic: false, action: "t-external-display" },
    { id: "guests", label: "Convidados da mesa", group: "Sessão", keywords: ["convite", "link", "sem conta", "visitante"], masterOnly: true, basic: false, action: "t-guests" },
    // Mestre — condução.
    { id: "order", label: "Ordem de turnos", group: "Turnos", keywords: ["iniciativa", "combate"], masterOnly: true, action: "t-order" },
    { id: "setTurn", label: "Dar a vez", group: "Turnos", keywords: ["turno", "jogador"], masterOnly: true, action: "t-set-turn" },
    { id: "request", label: "Pedir teste", group: "Dados", keywords: ["rolagem", "pericia", "salvaguarda"], masterOnly: true, action: "t-request" },
    { id: "pause", label: ctx.paused ? "Retomar partida" : "Pausar partida", group: "Sessão", keywords: ["intervalo"], masterOnly: true, action: "t-pause" },
    // Todos.
    { id: "roll", label: "Montar rolagem", group: "Dados", keywords: ["dados", "rolar", "d20"], action: "t-roll-builder" },
    { id: "undo", label: "Desfazer a última alteração", group: "Sessão", keywords: ["voltar", "ctrl z"], action: "t-undo", arg: ctx.undoId != null ? String(ctx.undoId) : "", disabled: ctx.undoId != null ? null : "Nada para desfazer agora." },
    { id: "grid", label: "Mostrar ou ocultar a grade", group: "Mapa", keywords: ["quadriculado"], action: "t-tool-grid", disabled: grid },
    { id: "rulers", label: "Mostrar ou ocultar as réguas", group: "Mapa", keywords: ["regua", "medida", "metros", "distancia", "dimensao", "escala"], action: "t-rulers", disabled: grid },
    { id: "focusBoard", label: "Usar o mapa pelo teclado", group: "Mapa", keywords: ["acessibilidade", "setas"], action: "t-focus-board", disabled: grid },
  ];
  if (!ctx.isMaster) {
    list.push({ id: "mySheet", label: "Minha ficha", group: "Ficha", keywords: ["personagem", "vida"], action: "t-my-sheet" });
    list.push({ id: "move", label: "Mover meu personagem", group: "Mapa", keywords: ["andar", "deslocar"], action: "t-move", disabled: grid });
    // Câmera compartilhada (ADR-115): seguir o mestre é escolha de cada jogador; nunca move a câmera de quem não segue.
    list.push({ id: "follow", label: ctx.following ? "Parar de seguir o mestre" : "Seguir o mestre", group: "Mapa", keywords: ["camera", "acompanhar", "enquadramento"], action: "t-follow" });
    list.push({ id: "fitView", label: "Restaurar enquadramento", group: "Mapa", keywords: ["camera", "mapa inteiro", "zoom"], action: "t-camera-fit" });
  }
  return list.map((c) => ({ basic: true, masterOnly: false, arg: "", ...c, disabled: ended && c.id !== "focusBoard" ? ended : c.disabled ?? null }));
}
