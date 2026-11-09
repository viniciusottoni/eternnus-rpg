# Névoa, iluminação e visão na mesa — design

Data: 2026-11-08. Estado: aprovado pelo dono em 2026-11-08, com névoa ativa por padrão.

Convenção deste documento: **[usuário]** marca o que o dono do produto decidiu na conversa; **[decisão do design]** marca escolhas feitas na redação, que o dono pode contestar; o restante é consequência das regras do projeto (`AGENTS.md`, `docs/ARQUITETURA.md`, `docs/SEGURANCA_OPERACAO.md`).

## 1. Intenção

Hoje o tabuleiro tático mostra o mapa inteiro a todos. O mestre quer conduzir exploração: salas escuras que vão sendo descobertas, tochas e braseiros que clareiam ao redor, personagens que carregam luz, e personagens com habilidades que enxergam ou percebem o que os outros não percebem. Quer preparar isso antes (no editor de mapas e cenários) e ajustar ao vivo, durante a sessão.

Sucesso: o mestre prepara uma masmorra com paredes, portas e focos de luz; na sessão os jogadores veem só o que a luz e a própria visão alcançam; o mestre clareia casas à mão quando a narrativa pede; um personagem com visão no escuro ou um sentido especial vê o que o resto do grupo não vê; e nenhum jogador consegue descobrir pelo navegador onde está uma criatura que ele não enxerga.

## 2. Objetivos, não-objetivos e anti-objetivos

Objetivos

1. Marcar, por casa, o que **bloqueia movimento** e o que **bloqueia luz**, de forma independente **[usuário]**. Portas que o mestre abre e fecha **[decisão do design]**.
2. **Névoa**: casas escuras que o mestre clareia (e escurece de novo) casa a casa ou arrastando **[usuário]**.
3. **Focos de luz** fixos no mapa, com raio em casas, que iluminam radialmente e param em casas que bloqueiam luz **[usuário]**.
4. **Luz de marcadores**: jogadores pelo valor da ficha, sobrescrevível pelo mestre **[usuário]**; criaturas com raio opcional definido direto no marcador **[usuário]**.
5. Tudo isso pode vir **pré-definido** no mapa ou ser **ajustado com a sessão rodando** **[usuário]**.
6. **Luz é compartilhada**: o que uma luz ilumina é visto por todos os jogadores **[usuário]**.
7. **Visão pessoal**: alguns personagens enxergam áreas que outros não enxergam (ex.: visão no escuro) **[usuário]**.
8. **Elementos ocultos** (criaturas, portas secretas, armadilhas) revelados **manualmente** pelo mestre, jogador a jogador, **e automaticamente** por percepção ou sentido especial da ficha **[usuário]**. O alcance da detecção automática depende da habilidade: perto ou em qualquer ponto visível **[usuário]**.
9. O mestre alterna entre **sua visão completa** e **"ver como [jogador]"** **[usuário]**.

Não-objetivos

- Névoa em mapas cartográficos (sem grade, como o Vale Dourado). Só tilesets oficiais e mapas enviados com grade **[decisão do design]**.
- Paredes finas na borda entre casas; a unidade é sempre a casa inteira **[decisão do design]**.
- Níveis de luz com efeito de regra (luz plena × penumbra). Pode haver borda suave visual, sem regra **[decisão do design]**.
- Linha de visão em mapa iluminado (dia aberto em que cada um vê só o que está à frente). Nesta entrega, "ambiente iluminado" é tratado como névoa desligada **[decisão do design]**.
- Jogador abrindo portas ou mexendo em luz de mapa. Ele altera a própria luz apenas pela ficha **[decisão do design]**.
- Rolagem automática de testes de percepção. Testes ativos continuam com o rolador atual, e o mestre revela à mão **[decisão do design]**.

Anti-objetivos (fracasso mesmo que "funcione")

- Posição de criatura não vista, porta secreta não revelada ou área nunca vista chegando ao navegador do jogador: no payload, em eventos, em `rows` ou em mensagens de erro. Esconder por CSS/canvas não conta.
- Ferramenta de pintura que esconde formulário, feedback ou barra de turno no celular, ou que depende só de mouse.
- Estado autoritativo em memória; escrita da mesa fora do `SessionService`.

## 3. Vocabulário

- **Casa**: célula da grade, como já usado em movimento.
- **Bloqueia movimento / bloqueia luz**: duas marcas independentes por casa. Parede = as duas; janela, grade, rio, mesa = só movimento; cortina mágica, fumaça = só luz.
- **Porta**: casa com estado aberta/fechada. Fechada bloqueia movimento e luz; aberta não bloqueia nada.
- **Foco de luz**: fonte fixa no mapa, com posição e raio em casas.
- **Luz de marcador**: raio de luz que acompanha o marcador.
- **Visão pessoal**: raio próprio de um personagem que só o dono enxerga. Atravessa a escuridão e para em casas que bloqueiam luz.
- **Revelada**: casa clareada à mão pelo mestre. É visível a todos, mesmo sem luz.
- **Visível agora**, para um jogador: casa revelada, iluminada por qualquer luz ou dentro da visão pessoal do seu personagem.
- **Explorada**, para um jogador: casa que já esteve visível agora para ele em algum momento da sessão.
- **Elemento oculto**: criatura marcada como oculta ou marca de casa oculta (porta secreta, armadilha, pista).

## 4. Regras de visibilidade

Valem quando a **névoa está ativa** no mapa. **A névoa vem ativa por padrão em todo mapa com grade, inclusive mapas e sessões existentes** **[usuário]**: o jogador vê apenas o que luz, visão própria e revelação do mestre permitem. O mestre pode desligá-la por mapa (preparação) ou na sessão; desligada, a mesa funciona exatamente como hoje.

1. **Alcance da luz e da visão**: a casa-alvo está no raio quando a distância euclidiana entre os centros das casas é ≤ raio. Isso produz um círculo, como pedido ("radial"), e não o quadrado da regra de movimento **[decisão do design]**.
2. **Bloqueio**: a casa-alvo é atingida se a linha entre a casa da fonte e a casa-alvo não atravessa outra casa que bloqueia luz. A própria casa que bloqueia é atingida, para a face da parede aparecer. O algoritmo fica com o construtor (ex.: *shadowcasting* simétrico), desde que seja simétrico, determinístico e testado. A passagem diagonal entre dois blocos que se tocam pelo canto é bloqueada **[decisão do design]**.
3. **Luz compartilhada**: casas atingidas por foco de luz ou luz de marcador ficam visíveis agora para todos os jogadores.
4. **Visão pessoal**: as casas atingidas pela visão do personagem ficam visíveis agora só para o dono desse personagem.
5. **Revelada à mão**: é visível agora para todos até o mestre escurecer de novo.
6. **Explorada sem estar visível**: o jogador vê o fundo do mapa atenuado, mas não vê marcadores de criaturas nem elementos ocultos dessa casa **[decisão do design]**. Nunca vista: preto.
7. **Marcadores de personagens de jogadores e criaturas aliadas** (`Side = ally`) são sempre visíveis a todos os jogadores, salvo aliada marcada como oculta. O grupo sabe onde estão os companheiros **[decisão do design]**.
8. **Marcadores de criaturas inimigas e neutras** aparecem a um jogador somente em casas visíveis agora para ele, e somente se a criatura não estiver oculta ou já tiver sido revelada para ele.
9. **Criatura oculta não emite luz** enquanto oculta para todos. Assim, a luz não denuncia a criatura **[decisão do design]**.
10. **O mestre** vê tudo, com a névoa como véu translúcido e paredes, portas e ocultos sinalizados. No modo "ver como [jogador]", vê exatamente o que aquele jogador receberia.

## 5. Preparação no editor de mapas e cenários

A preparação vale para os dois tipos de mapa com grade.

- **Mapas enviados** (`asset:{guid}`, aba "Mapas e cenários"): hoje todas as casas são transitáveis (`docs/CAMPANHA_ACERVOS.md`). Ganham uma tela de preparação sobre a imagem com grade.
- **Cenários oficiais** (tilesets de `Domain/BattleMaps.cs`): a grade oficial continua imutável e testada. A campanha guarda uma **camada própria** por chave de cenário, sem alterar o oficial **[decisão do design]**. Sem camada própria, os valores padrão vêm da legenda:

| Legenda | Movimento | Luz | Extra |
| --- | --- | --- | --- |
| `#` parede, `o` pilar | bloqueia | bloqueia | — |
| `T` tocha | bloqueia | bloqueia | foco de luz padrão |
| `b` braseiro | bloqueia | não bloqueia | foco de luz padrão |
| `t` árvore, `~` água, `h` mobília, `A` altar | bloqueia | não bloqueia | — |
| `+` porta | porta, aberta por padrão | porta | — |
| demais | livre | livre | — |

Os raios padrão da tocha e do braseiro ficam com o construtor. Sugestão: 4 e 3 casas.

Ferramentas da preparação (para o mestre; o jogador nunca acessa):

- Ligar/desligar a **névoa** do mapa.
- Pincéis: *bloqueia movimento*, *bloqueia luz*, *parede* (as duas), *porta*, *borracha*. Clique, arraste ou teclado (setas + Enter, como o tabuleiro já faz).
- **Foco de luz**: colocar, mover, mudar o raio e remover.
- **Névoa inicial**: revelar ou escurecer casas que já começam visíveis.
- **Marcas ocultas**: porta secreta, armadilha ou pista, com rótulo curto e detecção opcional (seção 7).

Na mesa, o mestre usa os mesmos pincéis, a mesma lógica e o mesmo desenho do tabuleiro, sem uma segunda implementação **[decisão do design]**.

## 6. Durante a sessão

> **Revisão de 2026-11-08 [usuário]:** os ajustes não ficam numa cópia da sessão. A camada de cada mapa pertence à campanha e continua de uma sessão para outra (paredes, portas, luzes, névoa revelada, explorações e marcas). "Salvar como padrão do mapa" foi substituído por **"Recomeçar exploração"**. A configuração da mesa tem três níveis: **sistema** (padrão definido pelo admin), **campanha** (aba "Configuração da mesa") e **sessão**. Ao ajustar durante a sessão, a mesa pergunta se a mudança vale só para a sessão atual ou para a campanha toda. O parágrafo abaixo descreve a proposta original, que foi substituída.

~~**[decisão do design]** Ao mostrar um mapa numa sessão, a camada preparada é **copiada** para a sessão. Alterações ao vivo (paredes, portas, luzes, névoa, ocultos) mudam só a cópia. Um comando explícito "Salvar como padrão do mapa" grava a cópia de volta na camada do mapa. Ao trocar de mapa e voltar ao anterior na mesma sessão, a cópia da sessão é retomada, com paredes, portas, luzes, névoa revelada, explorações e marcas ocultas, incluindo quem já as percebeu.~~ **Marcadores de criaturas mantêm o comportamento atual**: a troca de tileset remove criaturas e as revelações ligadas a elas, e os aventureiros voltam aos pontos de entrada **[decisão do design]**.

Controles do mestre na mesa:

- Pincéis e ferramentas da seção 5, incluindo abrir e fechar porta com um toque.
- **Luz do marcador**: raio em casas. Para personagem, nasce do valor da ficha. Sobrescrever fica valendo até "voltar ao valor da ficha"; mudanças na ficha não desfazem a sobrescrita **[usuário + decisão do design]**.
- **Visão pessoal do marcador**: mesma lógica da luz.
- **Criatura oculta**: alternar oculta/visível, revelar ou esconder para jogadores específicos e definir a detecção automática.
- **Seletor de visualização**: "Visão do mestre" e "Ver como: [jogador presente]".

## 7. Fichas, percepção e sentidos

O modelo de ficha já liga campos à mesa por papéis (`SheetFieldRoles` em `Domain/Platform.cs`) e espelha o valor nas colunas de `Character`. Entram quatro papéis novos:

| Papel | Tipo | Uso |
| --- | --- | --- |
| `light` | número, em metros | raio da luz que o personagem carrega |
| `vision` | número, em metros | visão pessoal (ex.: visão no escuro) |
| `perception` | número | percepção passiva para a detecção automática |
| `senses` | texto | lista de sentidos especiais, um por linha, no formato `nome` ou `nome: alcance em metros` |

Metros seguem a convenção já usada em `movement`. A conversão para casas usa a escala do mapa (`floor(metros / escala)`) **[decisão do design]**. Focos e luzes de criaturas são definidos direto em casas. Fichas sem esses papéis valem 0 / vazio. O mestre pode sobrescrever qualquer um dos quatro no marcador.

**Detecção automática** de um elemento oculto, por jogador:

- O mestre define no elemento uma **dificuldade de percepção** (opcional), um **sentido exigido** (opcional) e uma **distância máxima** (opcional, em casas).
- Pela percepção, o elemento é revelado ao jogador quando está numa casa visível agora para ele. Pelo sentido, vale a exceção abaixo. Uma destas condições precisa valer:
  - a percepção alcança a dificuldade e a distância máxima, se houver, é respeitada; ou
  - o personagem tem o sentido exigido e o elemento está dentro do alcance desse sentido, se houver alcance.
- **Exceção para sentidos** **[decisão do design]**: a detecção por sentido **não** exige que a casa esteja visível agora. Basta o elemento estar dentro do alcance do sentido, sem casa que bloqueie luz no caminho (mesma linha da seção 4); sem alcance definido, vale a área visível agora. Sentidos detectam elementos, mas não revelam terreno. Um elemento detectado numa casa escura é desenhado para aquele jogador como "percebido": ícone ou silhueta sobre a escuridão, sem revelar a casa. Exemplo: "sentir magia: 9".
- A correspondência do nome do sentido ignora maiúsculas, acentos e espaços nas bordas.
- Revelado, continua visível para aquele jogador até o mestre esconder de novo **[decisão do design]**. A revelação gera evento visível só ao mestre e ao jogador, por exemplo: "Ana percebeu: Porta secreta".
- Elemento sem dificuldade nem sentido exigido só é revelado à mão.

## 8. Servidor, segurança e dados

Regras inegociáveis do projeto que se aplicam aqui:

- **O servidor calcula a visibilidade.** Uma função pura em `Domain`, no estilo `TableRules`, recebe a grade, as marcas, as fontes e o estado e devolve, por jogador, as casas visíveis agora e as exploradas. `StateAsync` usa essa função para montar o payload de cada usuário. O cliente só desenha as máscaras recebidas e nunca decide o que esconder **[decisão do design]**.
- **Payload de jogador**: marcadores de criaturas só nas casas visíveis agora e reveladas para ele (regra 8). Marcas ocultas só quando reveladas. Paredes, portas e luzes só em casas exploradas ou visíveis. `rows` de cenário oficial com as casas nunca vistas substituídas por um caractere de "desconhecido". Focos de luz em casa nunca vista não são enviados.
- **Eventos**: `move` e `token` de criatura carregam coordenadas e o rótulo. Com névoa ativa, ficam só para o mestre quando a criatura não estiver visível a todos os jogadores **[decisão do design]**. A forma exata (eventos separados por destinatário ou redação no momento da leitura) fica com o construtor, mas nenhum caminho pode expor coordenada ou rótulo oculto. O mesmo vale para mensagens de erro: mover um personagem para uma casa ocupada por criatura invisível deve retornar o mesmo erro de "ponto indisponível" sem dizer quem está lá.
- **Escritas**: toda escrita ao vivo passa pelo `SessionService` com a mesma sequência: bloqueio, papel, evento, `Revision++` e `SessionSignals.Pulse` após o commit. As escritas da preparação fora da sessão seguem o padrão de `CampaignAssetsService`, com `Revision` e 409 para versão obsoleta. Novas rotas são `POST`/`PUT`/`DELETE` com antiforgery e `js/api.js`. `GET …/live` continua somente leitura.
- **Detecção automática** roda dentro da mesma transação de qualquer escrita que mude a visibilidade (movimento, luz, porta, parede, névoa, valores da ficha relevantes). As revelações resultantes são persistidas ali.
- **"Ver como"**: somente o mestre, validado no servidor. Proposta: parâmetro do mestre na leitura ao vivo ou rota de leitura própria; o construtor escolhe.
- **Movimento** passa a usar a grade combinada (oficial + camada + cópia da sessão) para "bloqueia movimento" e portas fechadas, inclusive para o mestre arrastando marcadores, conforme pedido "não podem de forma alguma ser movido" **[usuário]**.
- **Movimento do jogador com névoa ativa** **[usuário]**: o destino precisa ser uma casa que o jogador já explorou ou vê agora. Além disso, precisa existir um **caminho livre** da origem ao destino com comprimento dentro do deslocamento do turno: sem casas que bloqueiam movimento, sem portas fechadas e sem casas ocupadas no meio do caminho. Os passos usam a métrica atual (diagonal = 1), e o passo diagonal não corta canto entre dois bloqueios **[decisão do design]**. O caminho só pode passar por casas exploradas ou visíveis para o jogador **[decisão do design]**. O mestre continua movendo livremente, exceto para casas que bloqueiam movimento. Com névoa desligada, a regra atual não muda.
- **Mensagens de erro de movimento** não revelam terreno nem ocupante. Destino em casa nunca vista, casa bloqueada não visível ou casa ocupada por criatura que o jogador não vê retornam a mesma mensagem genérica: "Esse ponto não está disponível." **[decisão do design]**.
- **Persistência**: PostgreSQL com migração versionada, sem apagar dados. Proposta de forma: camada por mapa da campanha (chave `asset:` ou chave oficial) e cópia por sessão + chave de mapa. A exploração é guardada **por sessão + mapa + jogador desde a etapa 1**. Na etapa 1, todos os jogadores exploram o mesmo, porque só há luz compartilhada e revelação manual. A etapa 2 não exige conversão de dados **[decisão do design]**. Bitsets compactos ou linhas de texto, dentro do limite atual de 4.096 casas. Os campos e o formato exatos ficam com o construtor.
- **Limites** **[decisão do design]**: até 100 focos de luz e 100 marcas ocultas por mapa; raio de 0 a 30 casas; rótulos de até 40 caracteres; sentidos com até 10 itens de 40 caracteres.

## 9. Frontend

- Reutilizar `table-map.js` (camada estática em cache + camada animada). A névoa entra como camada própria desenhada a partir das máscaras do servidor. Chamas e brilho já respeitam `prefers-reduced-motion` e pausam em aba oculta; a névoa segue a mesma regra.
- Editor e mesa compartilham um módulo de pintura carregado sob demanda.
- Acessibilidade: ferramentas com rótulo, estado selecionado anunciado, foco visível e operação por teclado (setas + Enter + Esc, já usados no tabuleiro).
- Celular: alvos de 44 px; a paleta de ferramentas não cobre o mapa nem a barra de turno; pintura por toque e arraste.
- Estados: carregando, erro, sem grade (mapa cartográfico: ferramenta indisponível com motivo), névoa desligada, conflito de revisão.
- PWA: novos arquivos públicos exigem atualizar a versão do cache e a lista permitida do service worker.

## 10. Etapas de entrega

Cada etapa pode ser usada sozinha.

1. **Paredes, portas, névoa e luz compartilhada**: marcas por casa, portas, preparação nos dois tipos de mapa, cópia na sessão, revelar/escurecer à mão, focos de luz, luz de marcador (papel `light` + sobrescrita, raio de criatura), máscaras calculadas no servidor, filtragem de payload e eventos, e movimento com caminho livre respeitando as marcas.
1b. **Imagem mascarada por jogador** para mapas enviados pela campanha (seção 13). Até essa parte ficar pronta, a névoa fica indisponível nesses mapas, com o motivo exibido. Assim, a brecha nunca fica aberta em produção **[decisão do design]**.
2. **Visão pessoal e "ver como"**: papel `vision`, exploração por jogador e seletor de visualização do mestre.
3. **Elementos ocultos**: criaturas ocultas, marcas ocultas, revelação manual por jogador, papéis `perception` e `senses` e detecção automática.

## 11. Testes esperados

- Domínio: alcance circular; bloqueio por parede; regra diagonal; porta aberta/fechada; simetria; combinação luz + visão + revelação; conversão metros → casas; correspondência de sentidos; detecção por dificuldade, sentido, alcance e distância máxima.
- Serviço: jogador nunca recebe criatura fora da visão, oculta não revelada ou marca oculta; eventos de criatura invisível não chegam ao jogador; erro de casa ocupada não revela ocupante; "ver como" negado a jogador; sobrescrita do mestre resiste a mudança de ficha; corrida entre mestre alterando névoa e jogador movendo; névoa desligada mantém comportamento atual.
- Movimento: caminho bloqueado por parede ou porta fechada; caminho mais longo que o deslocamento; destino nunca visto; corte de canto diagonal; mensagem genérica idêntica nos três casos de recusa.
- Imagem: o jogador nunca recebe pixel de casa não explorada (comparar pixels da resposta com a máscara); o mestre recebe a imagem completa; falha na geração não entrega a imagem completa; acesso negado fora da sessão ativa.
- Integração Node no PostgreSQL, no padrão de `tests/*.mjs`, e verificação visual da mesa em desktop e celular.

## 12. Deixado ao construtor

Algoritmo de linha de visão (respeitando a seção 4), formato de armazenamento, forma do "ver como" no contrato, raios padrão de `T`/`b`, desenho da borda suave da luz, ícones das marcas ocultas, organização das rotas novas e divisão em arquivos, sempre atualizando `docs/API.md`, `docs/ARQUITETURA.md`, `docs/GUIA_VISUAL.md`, `docs/CAMPANHA_ACERVOS.md` e um ADR em `docs/DECISOES.md` (próximo número após ADR-043).

## 13. Imagem dos mapas sob névoa

Qualquer jogador tem as ferramentas de desenvolvedor do navegador. Por isso, esconder a imagem no canvas não protege nada.

**Mapas gerais** (cenários oficiais e mapas cartográficos oficiais): ficam como estão **[usuário]**. O desenho já é público no site. O servidor só filtra paredes, portas, luzes, criaturas e marcas ocultas, além de redigir `rows` (seção 8).

**Mapas específicos da campanha** (imagens enviadas, `asset:{guid}`), com névoa ativa **[usuário]**:

- **Nenhum pixel de casa nunca explorada por um jogador sai do servidor para esse jogador.** O mestre continua recebendo a imagem completa.
- O servidor gera a versão do jogador a partir dos bytes normalizados, com as casas não exploradas em preto. A atenuação das casas exploradas mas não visíveis agora é feita no cliente, sobre pixels que o jogador já pode ver.
- As faixas parciais nas bordas, fora da grade, também vão em preto para jogadores **[decisão do design]**.
- **Formato** fica com o construtor: imagem inteira mascarada por jogador ou blocos da imagem servidos só quando explorados. A exigência é a do primeiro item.
- A exploração só cresce. Assim, a versão do jogador muda só quando ele explora algo novo. A chave de cache deve incluir sessão, mapa, jogador e versão da exploração. Cache em memória ou em disco privado é só otimização: a fonte da verdade continua no banco.
- O endpoint mantém as regras atuais: membro somente com o mapa selecionado em sessão ativa, `no-store`, `nosniff`, 404 sem acesso. O processamento usa a política restritiva de `AvatarProcessor` e um limite de gerações simultâneas, como as normalizações. Falha na geração nunca cai para a imagem completa: a resposta é erro, e a mesa mostra o estado de erro com nova tentativa.
- **Limite honesto**: bytes já entregues não podem ser recolhidos. Se o mestre escurecer de novo uma casa que um jogador já explorou, a casa volta à névoa na tela, mas o jogador pode ter guardado a imagem. A interface do mestre avisa isso ao escurecer casas já exploradas.
- O custo de CPU e de armazenamento é por jogador e por avanço de exploração. Não há carga medida; a documentação não deve prometer capacidade.
