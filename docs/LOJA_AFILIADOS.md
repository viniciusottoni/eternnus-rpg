# Loja do Aventureiro — afiliados e recomendações contextuais (ADR-104, ADR-108)

Fonte de verdade da loja de afiliados, da vitrine discreta e do recomendador. A loja é um recurso complementar: nunca aparece
na mesa ao vivo, nos editores de mapas/cenas, em login/cadastro, nas telas administrativas nem em fluxos críticos, e nenhuma
chamada comercial atrasa a abertura (3.000 ms), campanhas ou sessões. Não há carrinho, pagamento nem checkout: a compra
acontece sempre no marketplace de origem.

## 1. Modelo de dados

Todas as tabelas são aditivas (migrações `AffiliateStore` e `SmartStoreRotation`). Nenhuma tabela existente perde dados.

| Entidade | Papel |
| --- | --- |
| `StoreProduct` | Produto. Loja de origem (`amazon`, `shopee`, `mercadolivre`), URL afiliada original (`AffiliateUrl`), URL de destino validada (`TargetUrl`, a que o usuário abre), URL canônica e identificador externo quando conhecidos, título, descrição, imagem (https em CDN da loja), marca/editora, categoria, preço e preço anterior em centavos, moeda, data da última verificação de preço, disponibilidade (`unknown`, `in_stock`, `out_of_stock`), status (`draft`, `active`, `paused`, `archived`), prioridade administrativa 0–100, contador de cliques, criação, primeira publicação (`PublishedAt`: gravada na primeira ativação; edição, pausa e reativação não a reiniciam), atualização, exclusão lógica (`DeletedAt`) e `Revision` (concorrência otimista). |
| `StoreProductSystem` | Vínculo N:N com `RpgSystem` (FK `Restrict`: um sistema com produtos não pode ser excluído). Produto sem vínculo é **genérico** (serve a qualquer sistema). |
| `StoreProductTag` | Tags/palavras-chave do produto (minúsculas, até 40 caracteres, até 20 por produto). |
| `StoreCategory` | Taxonomia administrável (nome, slug, palavras-chave, ordem, arquivamento). Doze categorias iniciais semeadas; nenhum produto é semeado. |
| `StoreSettings` | Linha única: habilitação global, quantidade por faixa de largura, páginas elegíveis, diversidade, rotação, validade do preço, intervalo de atualização de metadados, exigência de imagem na vitrine, grupos de sinônimos e os parâmetros da rotação inteligente (§4.6). |
| `StoreInteraction` | Clique registrado por POST explícito: produto, usuário, superfície (`showcase`, `store`, `detail`), data. Nunca guarda texto de conversa. Retenção de 365 dias. |
| `StoreUserPreferences` | Preferências do usuário: mostrar vitrine, usar sistemas das campanhas, consentimento para análise de mensagens (data), sistema de interesse escolhido, aprender com os próprios cliques (`LearnFromClicks`, ligado por padrão), marco de exclusão de interesses e data do último cálculo. |
| `StoreUserInterest` | Interesses inferidos (termo do vocabulário do catálogo + peso). Existe só com consentimento; é apagado ao revogar ou ao pedir exclusão. |
| `StoreExposure` | Exibição confirmada na vitrine (ADR-108): usuário, produto, ciclo, fila (`popular`, `new`, `related`, `explore`, `ranked`), data e `ClickedAt` (clique atribuído). Única por (usuário, ciclo, produto). Retenção de 180 dias. |
| `StoreUserProductStat` | Resumo por usuário e produto: exibições, último ciclo, primeira e última exibição. Evita varrer exposições a cada navegação; some com a retenção (o produto volta a contar como nunca visto). |
| `StoreRotationState` | Progresso do ciclo por usuário: número da navegação exibida, exibições servidas por fila (metas cumulativas) e último avanço. Persistido: vale após reinício e entre instâncias. |

Preços ficam em centavos (`int`), evitando arredondamento e permitindo ordenação em qualquer provedor.

## 2. Cadastro e manutenção (Painel admin › Loja)

1. O administrador cola a **URL de afiliado** e usa **Buscar dados** (`POST /api/admin/store/preview-link`).
2. O servidor valida a URL (https, porta padrão, sem usuário/senha, até 2.000 caracteres, host na lista permitida), identifica a loja e extrai o identificador externo do próprio endereço (ASIN da Amazon, `MLB…` do Mercado Livre, `i.{loja}.{item}` da Shopee).
3. Quando a leitura de página pública estiver habilitada para aquela loja, o servidor lê somente metadados públicos de pré-visualização (Open Graph e JSON-LD `Product`), sem cookies, sem JavaScript, sem contornar bloqueios, seguindo redirecionamentos apenas para hosts permitidos.
4. O formulário volta preenchido com o que foi encontrado e com avisos do que não foi. Tudo é editável; nada é publicado sem revisão. O link afiliado digitado é preservado byte a byte (incluindo parâmetros de indicação) e é o destino aberto pelo usuário.
5. Preço exige confirmação explícita (“Conferi este preço agora na loja”), que grava a data da verificação. Sem confirmação, o preço anterior e a data são mantidos; preço novo sem confirmação é recusado.
6. Status: rascunho → ativo → pausado/arquivado; excluir é lógico. Só `active` aparece ao público. Ativar exige título e URL válida.

### Lojas e hosts permitidos

| Loja | Links aceitos | Imagens aceitas |
| --- | --- | --- |
| Amazon | `amazon.com.br`, `amazon.com`, `amzn.to`, `amzn.com`, `a.co` | `m.media-amazon.com`, `images-na.ssl-images-amazon.com`, `images-amazon.com` |
| Shopee | `shopee.com.br`, `s.shopee.com.br`, `shp.ee` | `susercontent.com`, `shopee.com.br` (inclui `cf.shopee.com.br`) |
| Mercado Livre | `mercadolivre.com.br`, `mercadolivre.com`, `mercadolibre.com`, `meli.la` | `mlstatic.com` |

Subdomínios dos hosts listados são aceitos (`produto.mercadolivre.com.br`, `http2.mlstatic.com`).

## 3. Limitações das integrações

- **Nenhuma API oficial está integrada.** A Product Advertising API da Amazon, a API de afiliados da Shopee e a API autenticada do Mercado Livre exigem credenciais do programa de cada conta, que não existem neste repositório. A loja funciona integralmente com cadastro manual.
- **Amazon:** a leitura de página fica desligada por padrão. As regras do programa de associados restringem a exibição de preço obtido fora da API oficial; o administrador informa o preço manualmente e a validade padrão de 24 h o esconde depois disso (“Consultar preço na loja”).
- **Shopee e Mercado Livre:** leitura de metadados públicos ligada por padrão (`Store:PageReader:Marketplaces`). Páginas renderizadas por JavaScript, bloqueios ou captchas fazem a leitura falhar silenciosamente: o formulário segue manual.
- **Atualização automática de preço:** não ocorre sem integração autorizada. O intervalo de atualização configurado fica registrado para quando houver uma; até lá a validade do preço impede exibir valor desatualizado.
- **Imagens:** carregadas do CDN da loja (exigência comum dos programas), com `referrerpolicy="no-referrer"` e `loading="lazy"`. O navegador do usuário contata o CDN da loja ao exibir a imagem.
- **Receita, comissão e conversões:** desconhecidas. Nenhum painel as apresenta.

## 4. Recomendador (determinístico e explicável)

Implementado em `Domain/StoreRanking.cs` (regras puras e pesos) e `Application/StoreRecommendationService.cs` (leitura dos dados).

### 4.1 Contexto

1. Visualizando uma campanha (`campaignId` de uma campanha da qual o usuário é mestre ou integrante): o sistema dela é o **principal**.
2. Páginas gerais: o sistema de interesse escolhido pelo usuário na loja; sem ele, o sistema da campanha ativa (não arquivada) com atividade mais recente.
3. Demais campanhas são **secundárias**, com peso pela recência; campanhas arquivadas ou one-shots expiradas pesam 0,3.
4. Sessões ao vivo nunca exibem a vitrine; a campanha da sessão só entra como contexto quando o usuário abre a página da campanha.
5. Com “Usar sistemas das minhas campanhas” desligado, nenhuma campanha é lida; vale só o sistema de interesse escolhido, se houver.

### 4.2 Primeira etapa — grupos (ordem imutável)

| Grupo | Produtos |
| --- | --- |
| 0 | Vinculados ao sistema principal |
| 1 | Vinculados a sistemas secundários |
| 2 | Genéricos (sem sistema) |
| 3 | De outros sistemas, mas com termos de interesse do usuário |
| 4 | Demais ativos (preenchimento por pontuação geral) |

Popularidade, cliques e prioridade comercial nunca movem um produto de grupo. Diversidade e rotação só reorganizam itens **dentro** do mesmo grupo.

O banco ordena os candidatos pelos grupos 0–2 (os grupos 3 e 4 dependem dos termos e ficam juntos no SQL); os primeiros 192 (`StoreRecommendationService.Window`, oito páginas da loja) passam pelo ranking completo em memória. A vitrine e a página da loja sem busca nem ordenação explícita usam exatamente esse ranking, então “Ver mais na loja” começa pela mesma ordem. Depois da 8ª página, vale a ordem SQL.

### 4.3 Segunda etapa — pontuação dentro do grupo

`StoreRanking.Weights` concentra os pesos: termos de interesse (0,35), afinidade de categoria por cliques próprios (0,15), peso do sistema secundário (0,15, só no grupo 1), integridade dos metadados — imagem, descrição, preço atual (0,10), atualização da oferta (0,05), prioridade administrativa (0,10), novidade do cadastro (0,05) e popularidade interna (0,05).

Diversidade: no máximo `maxPerMarketplace` itens da mesma loja na vitrine quando houver alternativa no mesmo grupo; com `categoryDiversity`, a vitrine evita repetir categoria quando há candidato do mesmo grupo de outra categoria com pontuação próxima.

Rotação limitada (página da loja e ranking clássico): itens do mesmo grupo cuja pontuação difere menos de 0,08 formam faixas; a ordem dentro da faixa é embaralhada com semente estável por usuário e janela de `rotationHours` (padrão 6 h) — ou pela sessão de catálogo (`seed`) quando informada. A vitrine usa a rotação inteligente de §4.6.

### 4.4 Interesses por palavras (com consentimento)

Fontes, sempre só do próprio usuário e dos últimos 180 dias (até 300 itens por fonte), posteriores ao último pedido de exclusão:

- Guilda: tópicos e respostas de autoria do usuário, não excluídos e não retidos pela moderação, em tópicos não excluídos/retidos.
- Mesas: eventos `message` escritos pelo usuário, públicos à mesa (`MasterOnly = false`, sem destinatário, não cópia privada).

Excluídos: rolagens, eventos automáticos, alterações de ficha, notas do mestre, mensagens privadas/direcionadas, conteúdo apagado ou moderado e tudo escrito por outras pessoas.

Processamento (`Domain/StoreKeywords.cs`): caixa e acentos normalizados; pontuação removida; stopwords do português e termos genéricos isolados (“mesa”, “jogo”, “personagem”…) ignorados; singular/plural simples (`dragões`→`dragao`, `metálicos`→`metalico`); sinônimos administráveis; expressões compostas de até três palavras. **Só termos que existem no vocabulário do catálogo** (tags, palavras-chave de categorias e sinônimos) são contados, e uma lista de temas sensíveis nunca é registrada. Cada termo conta uma vez por mensagem; o peso decai com meia-vida de 30 dias; termos vistos em um único dia valem metade. Ficam os 40 termos mais fortes, normalizados para 0–1.

O cálculo roda no servidor: ao ativar o consentimento e, depois, a cada 12 h por um serviço em segundo plano. `GET` nunca grava.

### 4.5 Fontes de interesse

| Fonte | Origem | Controle |
| --- | --- | --- |
| Contextual | Sistemas das campanhas de que o usuário é mestre ou integrante | “Usar os sistemas das minhas campanhas” |
| Declarada | Sistema de interesse escolhido na Personalização | O próprio campo |
| Por conteúdo | Termos das próprias mensagens (§4.4) | Consentimento opt-in; revogar apaga |
| Comportamental (ADR-108) | Sistemas e categorias dos produtos que o próprio usuário clicou (180 dias) | “Aprender com os produtos que eu abro” (usuário) e “Aprender com os cliques” (Admin) |

Aprendizado por cliques (`StoreRotation.LearnSystems`): cada produto conta uma vez (o clique mais recente), com meia-vida de 30 dias; a afinidade de um sistema é `1 − e^(−0,5·Σ pesos)`. Um clique isolado (≈ 0,39) é interesse fraco: só desempata a fila de exploração. Dois produtos distintos recentes (≈ 0,63) passam do limiar 0,5 e o sistema entra no perfil como secundário (peso 0,8 × afinidade); o sistema principal da campanha nunca é substituído. Repetir cliques no mesmo produto não soma. Cliques nunca viram termos de interesse. Desligar o aprendizado tira o sinal na hora; os cliques continuam só nas métricas agregadas. A Personalização mostra os sistemas aprendidos.

### 4.6 Round Robin inteligente da vitrine (ADR-108)

Regras puras em `Domain/StoreRotation.cs`; leitura em `StoreRecommendationService.RotateAsync`; confirmação em `StoreAnalyticsService.RecordImpressionsAsync`.

**Quatro filas**, cada uma lida do banco já ordenada e limitada a 48 candidatos (nunca o catálogo inteiro):

| Fila | Conteúdo | Ordem |
| --- | --- | --- |
| A — Populares do perfil (`popular`) | Perfil = sistema principal, secundários (campanhas, sistema escolhido, sistemas aprendidos) e genéricos | Grupo de relevância; faixa de popularidade (70% pessoas distintas que clicaram em 30 dias + 30% volume histórico em log); nunca visto, visto há mais tempo, menos exibido; pontuação |
| B — Novidades do perfil (`new`) | Perfil, publicados nos últimos 90 dias (`PublishedAt`) | Grupo; semana de publicação; nunca visto primeiro; mais recente |
| C — Descoberta relacionada (`related`) | Perfil | Com cobertura: nunca visto, categorias que o usuário menos viu, grupo, visto há mais tempo, menos exibido |
| D — Exploração fora do perfil (`explore`) | Produtos de sistemas fora do perfil | Com cobertura: fila circular — nunca visto, visto há mais tempo, menos exibido; no mesmo patamar, sistemas com afinidade fraca aprendida e termos de interesse; ordem estável por usuário |

Sem perfil (sem campanhas, sistema escolhido ou cliques), o catálogo inteiro é relevante: A, B e C percorrem tudo e D fica vazia.

**Plano por exibição.** O 1º cartão — o único visível no celular — segue um round robin ponderado suave pelo número da navegação exibida (`StoreRotation.Lead`). Com 40/30/20/10: populares, novidades, descoberta, populares, novidades, exploração, populares, descoberta, novidades, populares (período = 100 navegações). Os demais cartões cobrem a maior defasagem entre a meta e o que o usuário de fato viu (`ServedPopular/New/Related/Explore`), então as proporções são metas acumuladas sobre exibições reais, não sorteios sem memória. No desktop isso dá, por exemplo, [A, B, C], [B, A, D], [C, A, B]: maioria relevante e no máximo um cartão de exploração por exibição enquanto houver alternativa relevante.

**Seleção** (`StoreRotation.Select`): cada cartão tenta a fila planejada e redistribui pelas demais (por proporção) com candidatos fora do resfriamento, respeitando no máximo `maxPerMarketplace` por loja e evitando repetir categoria entre itens do mesmo grupo (8 candidatos examinados). Sobrando vagas, a exploração pode passar do limite (melhor que repetir); por fim, catálogo pequeno repete os vistos há mais tempo em vez de esconder a vitrine.

**Antirrepetição e resfriamento.** Um produto visto não volta nas próximas `repeatWindow` (10) navegações exibidas se houver alternativa. Com `fatigueImpressions` (6) exibições sem clique daquele usuário, o resfriamento dobra; depois ele volta. Catálogo pequeno reduz o intervalo na prática (repetição só quando não há alternativa).

**Ciclo e exibição real.** O ciclo é por usuário (não por página) e só avança quando a exibição é confirmada: o navegador observa cada cartão (`IntersectionObserver`) e confirma os que ficaram ≥ 50% visíveis por ~1 s com a aba visível. A confirmação (`POST /api/store/impressions`) leva o token protegido da exibição (Data Protection, 2 h: usuário, ciclo, produtos e filas escolhidos pelo servidor) e só os produtos visíveis. O servidor grava uma linha por (usuário, ciclo, produto), atualiza o resumo e as metas, e avança o ciclo uma única vez por ciclo (comparação com o ciclo do token), sob bloqueio da linha de estado. Requisição cancelada, cartão escondido pela largura, outra aba no mesmo ciclo, reenvio ou resize não contam de novo. Sem estado autoritativo em memória: reinício e múltiplas instâncias continuam do banco. Com “Renovar em mudança de tela” desligado, o ciclo avança no máximo uma vez por `rotationHours`.

**Cobertura progressiva.** C e D percorrem o catálogo do menos visto ao mais visto: produtos nunca vistos primeiro, depois os vistos há mais ciclos. Como a exploração nunca é zero e cada exibição consome um inédito enquanto houver, todo produto ativo e elegível acaba exibido com navegações suficientes, inclusive os fora da antiga janela de 192 candidatos. Esgotado o catálogo, a fila recomeça pelos vistos há mais tempo; produtos novos entram como nunca vistos sem reiniciar nada; pausados, arquivados, excluídos e indisponíveis saem na hora (o filtro público vale na leitura e na confirmação).

**Exploração × aproveitamento.** A–C aproveitam o que já se sabe (contexto, popularidade, novidade); C e D experimentam o pouco exibido. A proporção de exploração é configurável, nunca menor que 5% e não é reduzida pelo aprendizado.

**Página da loja.** Continua com o ranking contextual de §4.2–4.3 (que passa a usar sistemas aprendidos, popularidade recente e data de publicação). A página abre uma sessão de catálogo (`seed`) que fixa a ordem dos empates enquanto o usuário pagina: nada some nem repete entre páginas. Busca, filtros e ordenações explícitas continuam prevalecendo; a exploração da vitrine nunca entra nelas.

**Rotação inteligente desligada:** a vitrine volta ao ranking clássico (§4.2–4.3, rotação por janela de horas); as exibições continuam medidas com a fila `ranked`.

### 4.7 Cenários reproduzíveis

`tests/Eternnus.Tests/StoreRotationTests.cs`:

1. **Muitas ofertas de Tormenta20** (`Relevant_products_predominate_and_exploration_gets_a_controlled_share`): 40 produtos de T20 e 30 de Chamado de Cthulhu, 20 navegações no desktop. Fora do perfil só nos cartões de exploração (≤ 20%, ≥ 1), nenhum produto repetido em 10 navegações e exibições por fila em 40/30/20/10 (±1,5).
2. **Várias campanhas de sistemas diferentes** (`Several_campaign_systems_all_get_turns_while_the_open_campaign_leads`): T20, D&D 5e e Cthulhu no perfil e Pathfinder fora dele. Em 12 navegações os quatro aparecem, T20 pelo menos tanto quanto D&D, e dentro da campanha de D&D o primeiro cartão é de D&D.
3. **Sem histórico e catálogo grande** (`Coverage_reaches_products_beyond_the_old_192_candidate_window`): 231 produtos, 77 navegações exibem todos exatamente uma vez, inclusive os que ficavam fora da janela de 192.

Celular: `Mobile_first_card_alternates_popular_new_discovery_and_exploration` confirma a sequência do 1º cartão e que só ele conta.

## 5. Privacidade e consentimento (LGPD)

- Análise de mensagens é **opt-in** com texto claro das fontes; padrão desligado.
- Uso do sistema das campanhas é ligado por padrão e pode ser desligado; sem ele a loja mostra produtos gerais.
- Revogar o consentimento apaga os interesses na hora e interrompe a análise. “Apagar interesses” remove os dados derivados e só considera conteúdo posterior se o consentimento continuar ativo.
- O próprio usuário vê seus termos inferidos em Loja › Personalização. O painel administrativo nunca vê termos, textos ou interesses individuais; métricas são agregadas.
- Nada é enviado aos marketplaces além do clique do próprio usuário no link (navegação direta, em nova aba, `rel="sponsored noopener noreferrer"`).
- Cliques ficam 365 dias; exibições e o resumo por produto, 180 dias; preferências, interesses, exibições e estado de rotação são apagados com a conta (FK em cascata).
- O histórico de exibição é de cada usuário e só serve à seleção dele: não há rota para lê-lo, o token de exibição só vale para quem o recebeu e o painel vê apenas agregados.
- Nada do perfil vai ao navegador além da vitrine: no `sessionStorage` fica só o booleano “desligada”; o registro de cartões já confirmados vive em memória da página.

## 6. Fallback

- Sem campanhas, sem consentimento ou sem mensagens: grupos 2 e 4 (genéricos e demais ativos, por pontuação de metadados/prioridade).
- Sem produtos do sistema principal: genéricos completam a seleção.
- Loja desabilitada, página não elegível, preferência de ocultar ou nenhum produto elegível: `show = false` e a faixa não ocupa espaço.
- Falha da API na vitrine: a faixa é removida em silêncio (nada de toast); a página continua.

## 7. Eventos e métricas

`POST /api/store/interactions` registra cliques (deduplicados por usuário, produto e superfície em 30 min). Um clique da vitrine é atribuído à exibição mais recente do produto para aquele usuário nas últimas 24 h que ainda não tinha clique (no máximo um por exibição). `POST /api/store/impressions` registra exibições reais (§4.6).

Administradores não contam (ADR-123): o clique de um Admin responde 204 e abre o link, mas não grava interação, não incrementa `Clicks`, não atribui clique à exibição e não alimenta o aprendizado por cliques. As exibições do Admin continuam gravadas para a rotação dele funcionar, mas o painel de métricas exclui cliques e exibições de quem tem papel Admin (papel atual, lido do banco), inclusive registros anteriores. O contador `Clicks` acumulado antes desta regra não é recalculado.

Indicadores: produtos por status; cliques por produto, loja, superfície (vitrine × loja × detalhe), categoria e sistema; exibições totais, CTR (`cliques atribuídos ÷ exibições × 100`) total, por fila e por produto, com **CTR suavizado** (soma 50 exibições à taxa geral) e marca de amostra pequena (< 30 exibições); cobertura do catálogo ativo no período, produtos ativos nunca exibidos, menos exibidos e exibições por loja, sistema e categoria. Popularidade é “mais clicados”, nunca “mais vendidos”: receita, comissão e conversão não são conhecidas.

## 8. Vitrine nas páginas

- Faixa abaixo da barra superior e antes do título, com “✦ Selecionados para sua aventura”, “Ver mais na loja” (`#store`), indicação de link de afiliado e botão para ocultar.
- Colunas pela largura do contêiner (container queries), não da janela: ≥ 860 px até 3, ≥ 520 px até 2, abaixo 1 — limitadas por `showcaseWide/Medium/Narrow`.
- Altura de cerca de 100 px no desktop (cabeçalho de uma linha + itens de 62 px), reservada enquanto carrega para não deslocar o conteúdo; se não houver produtos, se a loja estiver desligada ou se o usuário ocultar, a faixa some e só o booleano “desligada” fica 10 min no `sessionStorage`.
- Renovação (ADR-108): cada mudança real de rota elegível (hash diferente, inclusive voltar a uma página) pede uma seleção nova; renderizar de novo a mesma rota reaproveita a exibição atual. Antes da consulta, a confirmação pendente da tela anterior é enviada (espera de até 1,5 s) para o ciclo já ter avançado. Sem cache de seleção entre navegações e sem consulta periódica na mesma página.
- Páginas elegíveis (configuráveis): `home` (Início), `campaigns` (Minhas campanhas), `campaign` (visão geral, diário e grupo de uma campanha), `guild`, `characters`, `library`, `progress`.
- Nunca: mesa, sessão anterior, ficha aberta, preparação/editores, mundo e notas da campanha, configurações, one-shot, suporte, admin, conta, login, cadastro e convite.

## 9. Contrato HTTP

Todos os endpoints exigem `Verified`; escritas passam pelo antiforgery comum (`js/api.js`). Administração exige a política `Admin` e grava auditoria (sem a URL afiliada no registro).

### Público autenticado (`/api/store`)

| Método e rota | Corpo/consulta | Resposta |
| --- | --- | --- |
| `GET /products` | `q`, `system` (repetível; GUID ou `generic`), `category` (repetível), `marketplace` (repetível), `minPrice`, `maxPrice` (reais), `available`, `onSale`, `sort` (`relevance`, `price_asc`, `price_desc`, `newest`, `popular`), `page`, `campaignId`, `seed` (sessão de catálogo) | `{ items: Card[], total, page, pageSize: 24, sort, personalized, context: { systemName } }` |
| `GET /products/{id}` | — | `Card` com `description` completa e `tags` (somente `active`; senão 404) |
| `GET /suggestions` | `q` (2–100) | `{ items: [{ id, title }] }` (até 8) |
| `GET /categories` | — | `{ categories: [{ id, name, slug, count }], systems: [{ id, name, count }], marketplaces: [{ key, name, count }], genericCount, popularity, priceStaleHours }` |
| `GET /recommendations` | `page` (chave da página), `campaignId` | `{ show, reason, layout: { wide, medium, narrow }, items: Card[] (≤ 3), context: { systemName }, view: { token, cycle, strategies: string[] } \| null }` |
| `POST /impressions` | `{ view, productIds }` (1–3) | 204; 400 com token inválido/expirado/alheio ou produto fora da exibição |
| `GET /preferences` | — | `Preferences` |
| `PUT /preferences` | `{ showShowcase, useCampaignSystems, analyzeMessages, interestSystemId }` | `Preferences` |
| `DELETE /interests` | — | 204 |
| `POST /interactions` | `{ productId, surface }` | 204 |

`Card`: `{ id, marketplace, marketplaceName, title, description, imageUrl, url, brand, category: { id, name } | null, systems: [{ id, name }], generic, priceCents, previousPriceCents, currency, priceCheckedAt, priceStatus ("current" | "stale" | "none"), onSale, availability, tags }`. `priceCents` e `previousPriceCents` são `null` quando o preço está vencido ou ausente; `previousPriceCents` só existe quando é maior que o preço atual verificado; `availability` só é `in_stock`/`out_of_stock` com verificação dentro da validade (senão `unknown`).

`Preferences`: `{ showShowcase, useCampaignSystems, analyzeMessages, messagesConsentAt, interestSystemId, interests: { count, computedAt, terms: string[] (até 10) }, learnFromClicks, learnedSystems: string[] }`. `PUT` aceita `learnFromClicks` (ausente = ligado).

### Administração (`/api/admin/store`)

| Método e rota | Corpo/consulta | Resposta |
| --- | --- | --- |
| `GET /products` | `q`, `status`, `marketplace`, `category`, `system`, `page` | `{ items: [{ id, title, imageUrl, marketplace, marketplaceName, systems, category, priceCents, currency, priceCheckedAt, status, updatedAt, clicks }], total, page, pageSize: 25, counts: { draft, active, paused, archived } }` |
| `GET /products/{id}` | — | `AdminProduct` |
| `POST /products` | `ProductInput` | `AdminProduct` (201) |
| `PUT /products/{id}` | `ProductInput` com `revision` | `AdminProduct` |
| `POST /products/{id}/status` | `{ status, revision }` | `AdminProduct` |
| `DELETE /products/{id}` | — | 204 (exclusão lógica) |
| `POST /preview-link` | `{ url }` | `{ marketplace, marketplaceName, affiliateUrl, targetUrl, externalId, canonicalUrl, title, description, imageUrl, brand, priceCents, previousPriceCents, currency, availability, fetched, notes: string[], duplicateOf: { id, title } \| null }` |
| `GET /categories` | — | `[{ id, name, slug, keywords, order, archived, products }]` |
| `POST /categories` | `{ name, keywords, order }` | categoria |
| `PUT /categories/{id}` | `{ name, keywords, order, archived }` | categoria |
| `DELETE /categories/{id}` | — | 204; 409 se houver produtos |
| `GET /settings` | — | `Settings` + `pageOptions: [{ key, label }]`, `pageReader: string[]` |
| `PUT /settings` | `Settings` com `revision` | `Settings` |
| `GET /metrics` | `days` (7–365, padrão 30) | `{ days, products: { total, active, draft, paused, archived }, clicks: { total, showcase, store, detail }, byProduct, byMarketplace: [{ key, name, clicks, impressions }], byCategory, bySystem, impressionsTracked: true, impressions: { total, attributedClicks, ctr, minSample }, byStrategy: [{ key, rate }], coverage: { active, shown, neverShown, percent }, mostShown: [{ id, name, rate }], leastShown: [{ id, name, impressions }], impressionsByCategory, impressionsBySystem }`; `rate = { impressions, clicks, ctr, smoothedCtr, reliable }` |

`ProductInput`: `{ affiliateUrl, title, description, imageUrl, brand, categoryId, systemIds, tags, priceCents, previousPriceCents, currency ("BRL" | "USD"), confirmPrice, availability, status, priority, externalId, canonicalUrl, revision }`.

`AdminProduct`: `ProductInput` + `{ id, marketplace, marketplaceName, targetUrl, priceCheckedAt, createdAt, updatedAt, clicks }`.

`Settings`: `{ enabled, showcaseWide (1–3), showcaseMedium (1–2), showcaseNarrow (1), pages: string[], maxPerMarketplace (1–3), categoryDiversity, rotationHours (1–168), priceStaleHours (1–720), metadataRefreshHours (6–720), requireImage, synonyms (texto: um grupo por linha, termos separados por vírgula), revision, smartRotation (true), rotateOnNavigation (true), repeatWindow (1–50, 10), sharePopular (0–100, 40), shareNew (0–100, 30), shareRelated (0–100, 20), shareExplore (5–50, 10), fatigueImpressions (0–50, 6), learnFromClicks (true), catalogCoverage (true) }`. As quatro proporções somam 100.

Limites de requisição: cliques em `store` (30/min por usuário), exibições em `store-impressions` (60/min por usuário), pré-visualização de link em `store-preview` (20 a cada 5 min).

## 10. Manutenção e evolução

- **Pesos e grupos:** `StoreRanking.Weights` e `StoreRanking.Group` (testes em `tests/Eternnus.Tests/StoreTests.cs`). Mudar a ordem dos grupos exige novo ADR.
- **Rotação inteligente:** constantes em `StoreRotation` (limiar e meia-vida do aprendizado, janela de novidade, faixas de desempate, exploração mínima) e parâmetros administráveis em `StoreSettings`. Testes em `tests/Eternnus.Tests/StoreRotationTests.cs`.
- **Limitações:** custo por navegação de cerca de uma dúzia de consultas pequenas e indexadas (não medido sob carga); exibições crescem com o uso (retenção de 180 dias); confirmação depende de JavaScript e `IntersectionObserver` (sem eles a vitrine aparece, mas o ciclo não avança).
- **Vocabulário de interesses:** tags dos produtos ativos, palavras-chave das categorias e sinônimos. Para que um tema passe a contar, cadastre-o como tag/palavra-chave; a lista de temas sensíveis (`StoreKeywords`) só cresce.
- **Nova integração oficial:** implementar a leitura autorizada em `StoreAffiliateService` (credenciais em configuração privada, nunca no navegador), gravar `PriceCheckedAt` a cada atualização e usar `MetadataRefreshHours` como intervalo. Até lá, nenhum preço é atualizado sozinho.
- **Nova loja:** acrescentar hosts de link e de imagem em `StoreMarketplaces` e em `js/store-policy.js` (as duas listas precisam coincidir) e cobrir com testes.
- **Validação:** `dotnet test --filter StoreTests` (inclui `StoreRotationTests`), `node --test tests/store-policy.test.mjs` e `node tests/store-ui.mjs` (PostgreSQL do harness + Chrome headless).
