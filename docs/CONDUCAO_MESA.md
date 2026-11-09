# Condução da mesa, preparação e continuidade

Este documento descreve a evolução que permite preparar, iniciar e conduzir partidas de qualquer sistema com poucos passos. Ele complementa [ARQUITETURA.md](ARQUITETURA.md), [API.md](API.md), [NEVOA_ILUMINACAO.md](NEVOA_ILUMINACAO.md) e a decisão ADR-046 em [DECISOES.md](DECISOES.md).

## Princípios aplicados

- Mostrar primeiro o necessário: na mesa, o jogador vê favoritas, **Rolar dados** e **Minha ficha**. "Encerrar a vez" só aparece quando a forma de jogo usa turnos e é a vez dele.
- Nada presumido: vida, nível, armadura e deslocamento só aparecem quando o modelo da ficha os define.
- Bloqueios explicados: comandos indisponíveis vêm com o motivo e o próximo passo ("Nesta mesa as ações acontecem por turnos. Aguarde o mestre conceder a sua vez.").
- Preparo × condução: ferramentas de névoa, paredes, luz, visão e configuração ficam atrás de **⋯ Mais ferramentas**; na barra do mestre ficam cenas, pedido de teste, rolagem, notas e turnos.

## Formas de condução

| Forma | Ações e rolagens | Movimento no mapa |
| --- | --- | --- |
| Livre (`free`) | Sem concessão de vez. Só a própria ficha e o próprio marcador. | Sem limite de distância nem de deslocamentos; paredes, ocupação e névoa continuam valendo. |
| Por turnos (`turns`) | Exigem a vez do personagem (ou do grupo dele). | Só na vez; sem limite de distância. |
| Tática (`tactical`) | Exigem a vez. | Na vez, com distância do papel Deslocamento, um deslocamento por turno e caminho livre com névoa. |

- `TableSettings.PlayMode` segue a cadeia existente: sistema sugere → campanha ajusta → sessão.
- Ao abrir a sessão, a forma é **fixada** em `GameSession.PlayMode`. Mudar a configuração da campanha fora da mesa não altera a partida em andamento.
- Na mesa, o mestre pode trocar a forma pela configuração da mesa. A troca é explícita, vale a partir dali e gera evento público.
- **Compatibilidade explícita:** sessões anteriores (coluna nula) e sistemas/campanhas sem configuração continuam táticos, com o comportamento de antes.
- Modo livre continua exigindo autorização: o servidor confere ficha e marcador próprios em cada escrita.

### Ordem de turnos

- `GameSession.TurnOrder` guarda a ordem como JSON. Cada entrada é um personagem (`c:{id}`), um marcador do mestre (`t:{id}`) ou um grupo (`g:{n}`, com integrantes).
- O mestre ordena manualmente ou pela iniciativa informada. Sem iniciativa, a entrada vai para o fim; empates preservam a ordem dada.
- Rolar iniciativa é opcional: não existe automação obrigatória.
- **Próxima vez** pula personagens ausentes, marcadores removidos e grupos sem ninguém presente.
- Com ordem configurada, **Encerrar a vez** passa automaticamente para a próxima entrada.
- Ordem vazia mantém a rotação anterior, pela entrada na mesa.
- Para jogadores, criaturas ocultas aparecem na ordem como "Mestre" e sem iniciativa.

## Ações vindas da ficha

- As ações são as do modelo (`t:{chave}`) e as do jogador. O campo opcional `group` dá o nome usado pelo sistema, como "Perícias" ou "Truques".
- Grupos sem ações não aparecem.
- **Ataque básico (1d20 + modificador de Força)** e **Defender** pertencem apenas à ficha clássica do Sistema livre (`Legacy` ou modelo livre). Em outros modelos, o servidor responde 404.
- Favoritas: o jogador escolhe até 8 ações e 8 rolagens em `Character.Shortcuts`. Isso é preferência de apresentação: não versiona a ficha, não altera regras nem permissões e só o dono grava.

## Ficha resumida e recursos

- `SheetField.Track = "resource"` marca contadores ajustáveis na mesa, como vida, estresse, sanidade, energia ou munição. O teto vem de `Max` ou de `MaxField`.
- `Track = "summary"` marca destaques.
- O papel Vida da ficha clássica é tratado como recurso com teto em Vida máxima.
- Os papéis Nível, Armadura e Deslocamento só viram destaque quando o modelo não marca nenhum.
- `POST /api/sessions/{id}/characters/{cid}/resource` ajusta um recurso (dono ou mestre), dentro do mínimo e do teto. Grava histórico por campo, versão da ficha e um evento desfazível.
- `AdjustHpAsync` (contrato anterior) usa o mesmo caminho. Se a ficha não tem vida, a resposta é 409.
- `Character.Conditions` (até 300 caracteres) guarda condições e uma nota curta. Fichas privadas alheias não as expõem no grupo.

## Modelos privados da campanha

- O mestre monta modelos simples sem PDF: seções e campos de texto, número, seleção, marcação e texto longo; recursos, destaques e ações com fórmula opcional.
- O construtor gera nomes técnicos, posiciona os campos em páginas A4 em branco e acrescenta "Nome" quando falta.
- Cada gravação publica uma nova versão pelo mesmo `ValidateForPublish` do catálogo. Fichas existentes ficam na versão delas; a atualização usa a migração com prévia já existente.
- `SheetTemplate.CampaignId` marca o modelo como privado. Ele não aparece no catálogo nem na gestão da equipe, e o editor da equipe não o altera.
- Leitura de modelo privado: mestre e membros da campanha, ou quem tem ficha presa a ele.
- Uma ficha feita com o modelo privado de outra campanha é recusada com o motivo, e a mesa oferece criar uma ficha com o modelo certo.
- O nome é único por campanha (índice filtrado). O catálogo mantém o nome único por sistema entre modelos públicos.
- `SheetTemplate.CampaignId` não tem chave estrangeira de propósito: excluir a campanha não pode apagar versões às quais fichas pessoais continuam presas.

## Rolagens

### Construtor e motor

O construtor visual monta um `DiceSpec`; o servidor valida e rola com `DiceRoller`. A fórmula continua disponível como opção avançada e usa o motor de fórmulas existente, inclusive com `@campos` da ficha.

| Mecanismo | Regra implementada |
| --- | --- |
| Soma | `count` (1–100) dados de `sides` (2–1000) faces + modificador (−1000 a 1000). |
| Manter/descartar | `kh`, `kl`, `dh`, `dl` com 1..count. Não combina com explosão nem com sucessos. |
| Explosão | Face máxima rola mais um dado, até **100 dados extras por rolagem** (`capped` avisa). Exige ao menos 3 faces. |
| Sucessos | Conta dados (inclusive explodidos) com valor ≥ `successAt`. O modificador soma ao número de sucessos. |
| Percentual | Um d100. Sucesso com comparação explícita: `lte` (≤ alvo) ou `gte` (≥ alvo). O modificador soma ao valor rolado. |

Não há suporte automático a todas as mecânicas, como dados de cores diferentes, pools com complicações ou tabelas. Nesses casos, o resultado é registrado e o mestre resolve manualmente.

### Visibilidade

| Valor | Quem recebe | Como é garantido |
| --- | --- | --- |
Só o mestre escolhe (ADR-053). Nas rolagens do mestre: `table`, `blind` (só ele) ou `group` (ele e 1 a 20 jogadores marcados). Rolagens de jogador seguem `TableSettings.PlayerRollVisibility` (`table`, `master` ou `blind`, padrão `table`), configurada pelo mestre; o servidor ignora o que o cliente enviar. Pedidos de teste aceitam `table`, `master` ou `blind`.

| Valor | Quem recebe | Como é garantido |
| --- | --- | --- |
| `table` | Mesa inteira. | Evento público. |
| `master` | Quem rolou e o mestre. | `MasterOnly` + `VisibleToUserId` do autor. |
| `blind` | Somente o mestre. | `MasterOnly` sem destinatário. O autor recebe só um aviso sem resultado; a resposta HTTP traz `hidden: true`. |
| `group` | Mestre e jogadores escolhidos. | Original `MasterOnly`; uma cópia `MasterOnly` + `VisibleToUserId` por destinatário com `IsRecipientCopy`, que o mestre não recebe (sem duplicar no registro nem no histórico). |

O filtro de eventos do estado ao vivo e do histórico já aplica `MasterOnly`/`VisibleToUserId`/`IsRecipientCopy`; nenhum resultado privado vai para outros payloads.

**Autocompletar de fórmulas:** em qualquer campo de fórmula (construtor de rolagem, pedido de teste, ações da ficha, modelo simples e editor de modelos), digitar `@` lista os atributos numéricos e calculados da ficha (`js/formula-suggest.js`). O mestre não tem ficha nas próprias rolagens; nos pedidos de teste recebe os atributos das fichas na mesa.

### Pedidos de teste

- O mestre escolhe personagens presentes (1–20), os dados ou a fórmula, a visibilidade e, se quiser, um critério (alvo + `gte`/`lte`).
- Cada jogador recebe um cartão com **Rolar**. A rolagem acontece no servidor, com a fórmula do pedido e a ficha do personagem.
- Sob o bloqueio da sessão, a segunda resposta do mesmo personagem recebe 409. Isso foi testado com respostas simultâneas no PostgreSQL.
- Cancelar impede novas respostas.
- Sem critério, o servidor nunca declara sucesso ou falha.
- No máximo 5 pedidos abertos por sessão.
- O mestre acompanha respostas e pendências. O jogador vê só os pedidos que o envolvem e não vê o próprio resultado quando a visibilidade é `blind`.

## Desfazer

- Disponível para movimento e ajuste de recurso. Eventos elegíveis trazem `undoable: true`.
- `POST /api/sessions/{id}/undo { eventId }` revalida:
  - permissão: mestre, ou autor do evento para o próprio marcador ou ficha;
  - pausa;
  - estado atual: o marcador ainda está no destino e a origem está livre, ou o recurso ainda tem o valor "depois".
- Se outra mudança aconteceu depois, a resposta é 409: desfazer não sobrescreve a mudança mais recente.
- O evento original é preservado. A correção é um novo evento com `undoOf`, e um segundo desfazer do mesmo evento recebe 409.
- Rolagens e ações não são desfeitas: 400 com o motivo.

## Cenas e personagens do mestre

- **Cena** (`Scenes`): nome, tipo (mapa com grade, imagem/cartográfico ou apresentação textual), referência ao mapa por chave, texto para jogadores, notas privadas, visão simplificada, `Prepared` e `Saved`. A cena referencia os mapas por chave e não copia arquivos.
- **Apresentar:**
  1. salva marcadores e posições da cena atual em `Saved`;
  2. troca o mapa;
  3. recoloca os marcadores — retomar usa `Saved`, reiniciar usa `Prepared`.
  Posições inválidas ou ocupadas descartam criaturas; personagens voltam ao ponto de entrada.
- A exploração fica na camada do mapa (compartilhada) ou na camada própria da cena (`Scene.LayerMode = scene`). **Reiniciar** volta à preparação e recomeça a exploração; **Retomar** preserva.
- A preparação acontece no **editor de cenas** sem apresentar: arranjo privado, cenário por miniatura, visibilidade, texto e notas. "Guardar posições atuais como arranjo inicial" continua disponível na mesa (Completa). Regras completas, apresentação × preparação e "Aplicar à cena atual" em [CENAS_EDITOR.md](CENAS_EDITOR.md) (ADR-048). "Aplicar" pode também recolocar os marcadores no arranjo preparado (opção desmarcada por padrão), sem recomeçar a exploração. Reabrir a aba Cenas recarrega a lista, incluindo cenas criadas em outra tela.
- Jogadores recebem o nome e o texto **apresentados** (`GameSession.SceneName/SceneText`). Editar a preparação não muda a mesa até o mestre aplicar.
- **Visão simplificada** vale para o mapa da cena:
  - tudo visível: névoa desligada;
  - revelação manual: névoa ligada, e só as casas reveladas pelo mestre aparecem;
  - visão por personagem: névoa com luz e visão.
  As opções detalhadas e **Ver como jogador** continuam disponíveis.
- **Personagens do mestre** (`MasterCharacters`): nome, tipo (personagem ou criatura), resumo, notas privadas, lado e até 8 recursos. A **cópia para encontro** (`SourceId`) recebe recursos cheios e não altera o original. Marcadores guardam `MasterCharacterId`.
- **Ficha de NPC/criatura** (ADR-054): o mestre escolhe qualquer modelo aceito pela campanha (o dos jogadores ou outro). Valores validados pelo tipo de cada campo; trocar o modelo recomeça os valores. Na mesa, “Ficha do elemento” abre a ficha do marcador selecionado e o painel de personagens do mestre mostra os recursos e destaques de cada um. “Adicionar ao mapa” com ficha ou imagem cria a criatura ligada ao marcador. Só o mestre lê ou edita.
- **Imagem de NPC/criatura:** imagem do acervo da campanha (`asset:{id}`) ou link `https://`. O jogador recebe a imagem só de marcador visível e não apenas percebido; clicar no marcador abre a imagem maior. A imagem do acervo sai por `/tokens/{id}/portrait`, que repete a checagem de visibilidade. Link externo é carregado do site de terceiros (o site vê o IP de quem abre e pode trocar o conteúdo).
- Jogadores recebem nome, tipo e texto compartilhado da cena; descrição de preparo e notas privadas nunca entram no payload deles.

## Pausa, espera recuperável e encerramento

| Ação | Efeito |
| --- | --- |
| **Sair da tela** (mestre) | Navega para fora. Em one-shot, a presença do mestre deixa de ser renovada e a mesa entra em espera. Nada é apagado. |
| **Pausar** | `GameSession.PausedAt`. A sessão continua sendo a única ativa da campanha (índice filtrado intacto). Bloqueia ações, rolagens, movimento e respostas dos jogadores; a conversa continua. |
| **Encerrar** | Campanha: sessão termina e o histórico fica. One-shot: apaga a mesa (como antes), preservando fichas, XP e o recibo de participação. |
| **Excluir** | Campanha sem jogadores (regra existente). |

- Prazo de recuperação da one-shot: `OneShots:RecoveryMinutes`, de 1 a 120, padrão **10 min**, contado da última presença do mestre.
- Antes do prazo, jogadores veem "O mestre se desconectou. A mesa fica guardada até HH:MM". O mestre retoma ao reabrir a mesa.
- Depois do prazo, o `OneShotWorker` (a cada 10 s) remove a mesa com o mesmo bloqueio de antes.
- A pausa não suspende esse prazo nem o limite de 72 h da one-shot.

## Conversão e arquivamento

- **Converter one-shot** (`POST /api/campaigns/{id}/convert`, mestre):
  - Ordem de bloqueio: sessão ativa → campanha → contas, ordenadas.
  - Exige vaga na quota de 3 campanhas do mestre.
  - Jogadores sem vaga não são levados. As fichas continuam deles, e eles podem voltar pelo convite. A resposta informa quantos ficaram de fora.
  - Sessão, mapas, fichas e histórico são preservados.
  - O recibo vitalício da one-shot não é devolvido.
- **Arquivar** (`/archive`, mestre, só campanhas persistentes):
  - Exige que não haja sessão ativa; o bloqueio da campanha impede abertura concorrente.
  - Bloqueia novas sessões, entrada por convite, edição, escolha de modelo e escritas de preparação ou da mesa.
  - Histórico, resumos e diário continuam legíveis.
  - **A arquivada continua contando no limite de campanhas**, então arquivar não libera vaga e restaurar (`/restore`) nunca ultrapassa o limite.
- **Proposta separada, não implementada:** permitir que arquivadas não contem na quota, exigindo vaga do mestre e dos membros na restauração. Isso mudaria limites comerciais e depende de decisão do produto.

## Entrada, convite e início

- **Link de convite** `#invite/{código}`:
  1. Sem login: o destino é preservado, como já acontecia com rotas internas.
  2. Conta pendente: o código fica em `AppUser.PendingInvite` (`POST /api/invites/pending`, sem Verified e sem conceder acesso; só valida o formato, para não virar oráculo).
  3. Depois da confirmação, mesmo em outra aba ou outro dia, o início oferece "continuar o convite".
  4. A prévia (`GET /api/invites/{código}`, Verified) mostra campanha, mestre e forma de jogar, sem e-mails.
  5. Entrar limpa o código guardado.
- **Personagem:** a mesa lista primeiro as fichas compatíveis e oferece **Criar e entrar** com o modelo da campanha (nome basta). Fichas incompatíveis aparecem num bloco recolhido, com o motivo.
- **Início:** `GET /api/home` destaca mesas abertas (**Retomar mesa**/**Entrar na mesa**), a campanha recente, a agenda e as pendências reais: convite guardado, pedidos de teste aguardando e presença a confirmar. Biblioteca, Guilda e conquistas seguem na navegação, com menor destaque.
- **Criação de campanha:** nome, sistema e forma de jogar, com pré-seleção da sugestão do sistema e premissa recolhida. Depois de criar, a visão geral mostra **Primeiros passos**: link de convite, modelo sugerido, cena opcional e iniciar a primeira sessão.

## Continuidade

- **Resumo da sessão:** `GameSession.Recap`, publicado com `RecapPublishedAt`. Pode ser escrito depois do encerramento, e só o publicado aparece aos jogadores.
- **Objetivos e pistas:** reaproveitam o acervo da campanha (`CampaignLibraryEntry.Kind = objective|clue`). Os publicados são os que os jogadores conhecem; rascunhos ficam com o mestre. As entradas também aparecem na aba Bibliotecas.
- **Próxima partida:** `Campaign.NextSessionAt` em UTC, apresentada no fuso do navegador com o nome do fuso no formulário.
- **Presença:** `CampaignAttendance` (sim, talvez, não) vale enquanto `SessionAt` coincidir com a data marcada. Mudar a data pede nova confirmação.
- A visão compartilhada nunca inclui notas privadas, objetivo inicial do mestre ou o histórico completo.

## Celular

A mesa ganhou a navegação própria **Mapa | Ficha | Conversa** (mestre: **Mapa | Grupo | Conversa**) abaixo de 900 px. A troca só alterna CSS, então seleção, texto digitado e posição do mapa se mantêm. Novas mensagens aparecem como contador na aba Conversa, sem interromper. Os alvos principais têm ao menos 44 px, e a barra inferior continua com a área segura.

## Limitações conhecidas

- O motor implementa os mecanismos da tabela acima. Outras regras de sistema são resolvidas pelo mestre.
- O desfazer cobre movimento e recursos de ficha. Ajustes de recurso de personagens do mestre não são desfeitos (aparecem só no histórico do mestre).
- A visão manual é por mapa (cena) ou por configuração da mesa. Luzes continuam desenhadas para o mestre, mas não revelam casas aos jogadores.
- Trocar o mapa de uma cena descarta o arranjo preparado e o estado salvo dela, porque as posições pertencem à grade anterior. Com a cena em apresentação, o novo cenário só vale com "Reiniciar cena".
- Não houve medição de carga nem teste em aparelho físico.
