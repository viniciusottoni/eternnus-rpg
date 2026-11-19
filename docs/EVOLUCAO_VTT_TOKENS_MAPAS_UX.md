# Evolução VTT: tokens, ensaio, mapas, convidados e câmera (ADR-110 a ADR-115)

Documento da evolução P0–P2 iniciada em 19/11/2026 na branch `feature/setup`. Ele registra a auditoria inicial, a arquitetura escolhida, os contratos, a compatibilidade, a segurança, os testes executados e as pendências comprovadas.

Princípio: o mestre começa a montar e usar a mesa imediatamente e acrescenta complexidade só quando quer. A identidade visual do Eternnus é mantida. A evolução reaproveita a preparação, a composição, a névoa e a mesa existentes, sem sistemas paralelos.

## 1. Auditoria inicial (Etapa 0)

Estados: **V** = já implementado e validado · **P** = implementado parcialmente · **UX** = implementado, mas com experiência inadequada · **N** = inexistente.

| Funcionalidade | Estado antes | Implementação existente | Lacuna verificada | Migração | Risco de regressão | Testes existentes | Abordagem |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P0.1 Token sem jogador | P | `SceneToken` aceita marcador do mestre sem ficha (`Label`, `Side`); personagens exigem `CampaignCharacter` | Não havia identidade reutilizável de "futuro personagem" nem vínculo posterior que preservasse posição e aparência | Sim (`PartySlots`) | Médio: `ScenePrep.ValidateTokens`, `ScenePlacement.Plan`, captura de arranjo | `SceneEditorTests`, `SessionServiceTests` | Entidade `PartySlot` + `SceneToken.SlotId`; vínculo explícito reescreve as cenas numa transação |
| P0.1 Token de ensaio | N | — | — | Não | Baixo | — | Só no cliente e na prévia; rejeitado ao salvar |
| P0.2 Ensaio | P | "Ver como jogador" com prévia autoritativa (`PrepPreview.cs`, ADR-088) | Observador só podia ser personagem real; sem perfis de teste; sem mover tokens sem alterar a preparação | Não | Médio: `PrepPreview` | `PrepPreviewTests` | Observadores sintéticos `rehearsal:{i}` só em memória; sandbox no editor; "Aplicar à preparação" com diferença |
| P0.3 Manipulação | UX | Alças (ADR-092), arrastar, seleção múltipla, copiar/colar, desfazer, menu de contexto | Faltavam trocar imagem, tamanhos predefinidos, vínculo no menu, dimensões ao vivo, Esc cancelando arraste | Não | Médio: `table-map.js` | `scene-editor.mjs`, `table-vtt-ui.mjs` | Completar o menu e o feedback; sem modal para ajustes pequenos |
| P1.1 Acervo rápido | P | Painel "Acervo" só no contexto Composição; favoritos/recentes no gerenciador (ADR-084) | Sem categorias de personagens/NPCs/reservados nem uso no contexto Personagens | Não | Baixo | `prep-explorer-policy.test.mjs` | Mesmo painel, categorias e busca; mesmas preferências |
| P1.2 Grade | P | Assistente de alinhamento (ADR-085, `grid-adjust.js`) | Sem prévia de impacto em tokens/paredes/luzes/entradas/sessão; precisão por lupa e presets | Não | Médio: posições ao mudar a grade | `grid-align-policy.test.mjs`, `CampaignAssetsTests` | Completar o assistente e uma consulta de impacto somente leitura |
| P1.3 Criação de cena | V/UX | Tela inicial com quatro escolhas (ADR-090) | Área em branco sem tamanho escolhível; conceitos mapa/cena/sessão sem explicação no ponto de escolha | Não | Baixo | `scene-editor.mjs` | Ajustes pontuais |
| P1.4 Upload | P | `image-drop.js` (arrastar, colar, várias imagens) | Faltava destaque da área de soltura, prévia/progresso e confirmação consistentes nos dois editores | Não | Baixo | `campaign-assets.mjs` | Módulo compartilhado único |
| P2.1 Vários mapas | P | Composição da cena (ADR-090) aceita imagens da campanha sobre o mapa | Sem instância de mapa com referência ao recurso, encaixe na grade, nem importação explícita de regras | Não (JSON) | Médio: validação da composição | `SceneCompositionTests` | `mapKey` em elementos de imagem; grade global; importação explícita |
| P2.2 Convidados | N | — | — | Sim (`GuestInvites`, `GuestSeats`, `Campaign.GuestsEnabled`, `SessionToken.GuestSeatId`) | Alto: segurança | — | Capacidade com hash, cookie HttpOnly próprio, visão de espectador |
| P2.3 Câmera e exibição | N | Long-poll com `Revision` + `SessionSignals.Pulse` | — | Sim (`GameSession.Camera`) | Médio: `StateAsync` | `SessionServiceTests` | Enquadramento leve sem evento; exibição externa como espectador |

Já existiam e foram apenas integrados: desfazer/refazer, copiar/colar, seleção múltipla, distribuição na área de entrada, prévia autoritativa do jogador, tela inicial da cena, composição de imagens e detecção automática da grade.

## 2. Arquitetura final

Monólito modular mantido (Domain, Application, Features, Infrastructure; ES Modules no cliente).

| Camada | Novo ou alterado |
| --- | --- |
| Domain | `PartySlots.cs` (`PartySlot`, `PartySlotArchetypes`, `GuestInvite`, `GuestSeat`, `GuestModes`, `VttModel`), `CameraFrames.cs`; `SceneToken.SlotId`, `SessionToken.GuestSeatId`, `GameSession.Camera`, `Campaign.GuestsEnabled`; `ScenePrep.ValidateTokens` (reservados e ensaio); `ScenePlacement.Plan`/`KeepSlots`; `MapComposition` (`mapKey`) |
| Application | `PartySlotService` (reservados, vínculo), `PrepPreview` (observadores sintéticos), `GuestService` (convites, lugares, cookie), `SessionSpectator` (estado de espectador, ações de convidado, controle), `SessionCamera`; `SessionService.StateAsync` (`camera`, `guests`); `CampaignAssetsService`/`CampaignMapComposition` (impacto da grade) |
| Features | `PartySlotEndpoints`, `GuestEndpoints` (câmera, exibição, convidados), `CampaignAssetsEndpoints` (`grid-impact`, `sources/import`) |
| Infrastructure | migração `VttTokensGuestsCamera`; política de limite `guest`; DI |
| Cliente | `party-slots.js`, `rehearsal-policy.js`, `map-instance-policy.js`, `camera-policy.js`, `guest-policy.js`, `spectator-view.js`, `table-display.js`, `guest-table.js`, `table-guests.js`; `scene-editor.js`, `table-map.js`, `table.js`, `image-drop.js`, `grid-adjust.js`, `scene-composition.js`, `app.js` |

Decisões: ADR-110 (reservados), ADR-111 (ensaio), ADR-112 (manipulação, acervo, grade, envio), ADR-113 (vários mapas), ADR-114 (convidados), ADR-115 (câmera e exibição) em [DECISOES.md](DECISOES.md). Contratos em [API.md](API.md) (seções "Evolução VTT" e "Grade e composição").

## 3. Modelo de dados

```
Campaign 1─* PartySlot ──(CharacterId?)──> Character      Scene.Prepared[*].SlotId ──> PartySlot
Campaign 1─* GuestInvite 1─* GuestSeat *─1 GameSession     SessionToken.GuestSeatId ──> GuestSeat
GameSession.Camera = {x,y,w,h,seq}   Campaign.GuestsEnabled   Scene.Composition.elements[*].mapKey ──> CampaignMap
```

Migração `20261119033017_VttTokensGuestsCamera`: cria `PartySlots`, `GuestInvites`, `GuestSeats`; adiciona `SessionTokens.GuestSeatId`, `Sessions.Camera`, `Campaigns.GuestsEnabled` (falso). Somente aditiva: nenhum dado existente é alterado ou removido. Índices: `IX_PartySlots_OneCharacter` (único filtrado), `IX_GuestInvites_TokenHash` e `IX_GuestSeats_SecretHash` (únicos). Exclusão: reservados, convites e lugares seguem a campanha/sessão (cascata); personagem excluído anula o vínculo do reservado; lugar removido anula o controle do token.

## 4. Fluxos

**Mestre (preparação):** Nova cena → imagem, mapa, modelo ou área em branco → canvas. Painel Personagens → "+ Personagem reservado" ou arquétipo (1 ação cada) → arrastar ou "Colocar no cursor". Três tokens provisórios: 3 criações + 3 colocações, sem formulário. "Ensaiar cena" (1) → "Visão de" um reservado (2) → mover, trocar perfis, acrescentar tokens de ensaio → "Aplicar alterações à preparação…" ou "Sair do ensaio"/Esc. Vincular: menu do reservado → "Vincular a personagem…" (1) → escolher personagem (2) → confirmar, resolvendo conflitos se houver (3). Vários mapas: Acervo rápido › Mapas ou "Inserir mapa da campanha" → encaixe automático → opcional "Trazer paredes, portas e luzes".

**Mestre (mesa):** "Mostrar esta região aos participantes" (menu da casa, trilho da Completa ou Busca de ações); "Abrir exibição externa" (nova aba, sem ferramentas). Convidados: ligar, criar convite (observador/participante, duração, usos), copiar o link uma vez, revogar; dar ou retirar controle de um token do mestre pelo menu do token.

**Jogador:** "Seguir o mestre" (desligado por padrão, lembrado na sessão); mexer na vista pausa e mostra "Voltar a seguir"; "Restaurar enquadramento".

**Convidado:** abre `#/convidado/{segredo}` sem conta → nome → entra; o endereço vira `#/convidado`. Observador só assiste; participante move o token liberado (arrastar ou tocar e tocar), rola dados e conversa. Acesso encerrado mostra tela própria.

## 5. Compatibilidade

- Cenas antigas (sem `slotId`, sem `mapKey`) carregam e salvam sem conversão; mapa único continua sendo o caso comum.
- Campos novos são opcionais (`slotId`, `rehearsal`, `profiles`, `viewerToken`, `mapKey`, `camera`, `guests`); contratos existentes mantidos.
- Mudança deliberada: alterar a grade de um mapa (`PUT …/maps/{id}`) remove tokens preparados fora da grade nova em todas as cenas que usam o mapa, como o editor de mapas já fazia; a prévia `grid-impact` e a confirmação antecedem a gravação.
- A mesa ao vivo não muda ao vincular reservados nem ao ensaiar; só "Aplicar preparação à cena atual" (existente) leva a preparação à partida.

## 6. Segurança

- Rotas de conta usam `Verified` e conferem o mestre no serviço. Rotas `/api/guest/*` têm autenticação própria (cookie HttpOnly, hash comparado em tempo constante) e reconferem tudo no banco a cada chamada; nenhuma contorna `Verified`.
- Segredos de convite e de lugar: 32 bytes aleatórios; o banco guarda só SHA-256; o segredo do convite aparece só na criação e sai do endereço logo após o resgate; o service worker não cacheia nada de convidado.
- Resgate e ações de convidado limitados por IP (`guest`, 20/min); usos consumidos por atualização condicional.
- Espectadores (convidados e exibição externa) nunca recebem objetivo, notas, eventos do mestre ou endereçados, fichas privadas, ocultos, e-mails, ids de conta ou avatares; a névoa é aplicada no servidor.
- Ensaio: só o mestre, somente leitura, observadores sintéticos só em memória.
- Correção encontrada no caminho: eventos de criatura oculta (surgir, mover, desfazer) agora são do mestre também com névoa desligada.

## 7. Critérios de aceite

| Critério | Situação | Evidência |
| --- | --- | --- |
| Mestre sozinho cria cena e posiciona três tokens provisórios; persistem ao reabrir | Atendido | `party-slots-ui.mjs`, `party-slots.mjs`, `PartySlotTests` |
| Token de ensaio descartado sem efeito permanente | Atendido | ensaio não altera a revisão da cena; salvar token de ensaio → 400 |
| Reservado vinculado depois sem perder posição e aparência; sem duplicar personagem; permissões reais | Atendido | `PartySlotTests`, `party-slots.mjs` |
| Campanha sem jogadores e sem fichas ensaia vendo por um token provisório; paredes e névoa pelas regras reais | Atendido | `PrepPreviewTests` |
| Sair do ensaio não altera a sessão; reabrir usa a preparação atual | Atendido | sandbox refeita a cada entrada; revisão inalterada |
| Iniciante alinha a grade sem entender offsets | Parcial (técnico atendido; validação humana pendente) | `map-instances-ui.mjs` |
| Encontrar imagem e arrastar token sem sair do editor | Atendido | Acervo rápido |
| Cena com dois mapas, transformados, salvos e reabertos; mesa mostra a composição; cenas antigas carregam | Atendido | `map-instances-ui.mjs`, `SceneCompositionTests` |
| Névoa e permissões não vazam entre regiões | Atendido pela grade/camada única (ADR-113) | `TableFogTests` |
| Convidado entra, não recebe dados privados; convite expirado/revogado para de funcionar; controle temporário; sem escalada | Atendido | `GuestTests`, `guests.mjs` |
| Exibição externa sem ferramentas privadas; seguir o mestre sem recarregar e parar; reconexão | Atendido | `CameraTests`, `table-display.mjs` |
| Metas de tempo humanas | Pendente de medição humana | — |

## 8. Limitações e pendências comprovadas

- Metas de tempo (60 s/60 s/30 s) não medidas com pessoas.
- Várias grades com regras próprias por região não foram implementadas, por decisão (ADR-113).
- Movimento do convidado sem limite de distância; respeita turno, pausa, grade, bloqueios e paredes.
- Eventos de convidado usam a conta do mestre em `TableEvent.UserId` (com `data.guest`); imagens temporárias e músicas não chegam ao convidado; o controle de música do site pode tocar na exibição externa.
- Sem selo de convidado sobre o token (aparece na lista do grupo do mestre).
- `#/mesa/{id}/exibicao` aberto deslogado volta à visão geral após o login (rota fora de `safeReturnRoute`).
- Progresso de envio por arquivo, não por bytes; importação por link no editor de cenas usa `prompt()`.
- No celular, o botão "Salvar preparação" do topo do editor fica parcialmente cortado (já ocorria) e o cartão do ensaio cobre a parte de cima do mapa.
- `Saved` não guarda reservados; restaurar versão antiga pode trazer reservado excluído (o editor descarta ids desconhecidos).
- `tests/table-vtt-ui.mjs` e `tests/free-movement.mjs` já falhavam na base `b3f9c78`.
- Concorrência de resgate e vínculo verificada só em SQLite; carga não medida.
- Resultados dos testes: [TESTES.md](TESTES.md).
