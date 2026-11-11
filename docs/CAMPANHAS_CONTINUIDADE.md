# Campanhas: continuidade, mundo e cadernos

Entrega de 10/11/2026. Complementa API.md, ARQUITETURA.md e CAMPANHA_ACERVOS.md.

## Uso

Na criação ou edição da campanha, o mestre escolhe `new` (nova) ou `ongoing` (trazida em andamento). A origem não muda automaticamente com as partidas. O resumo **Onde paramos** e o arco atual são compartilhados com membros; segredos pertencem às páginas privadas. Data original é opcional. O número mínimo da próxima sessão não renumera partidas anteriores. O servidor abre a próxima usando o maior entre esse mínimo e o maior número conhecido + 1, incluindo registros anteriores. Ajustar o mínimo enquanto há sessão ativa retorna conflito.

Exemplo: informar 28 permite iniciar a sessão 28 sem cadastrar as 27 anteriores. Registrar o passado é opcional. Sessões anteriores têm número, título, resumo, data opcional, cenas opcionais (título e texto, até 30, ADR-059) e publicação; não são GameSession, não geram eventos fictícios, presença ou XP. O mesmo bloqueio da campanha protege numeração no registro anterior e abertura da mesa; o índice de uma sessão ativa permanece intacto.

As abas principais são fixas (ADR-059): Visão geral, Diário, Preparação, Grupo, Mundo e acervo, Minhas notas e Configurações. O Diário reúne numa página próxima partida, objetivos, pistas, sessões no Eternnus (mestre), resumos e Antes do Eternnus. Mundo e acervo tem submenu visível (Páginas, Atlas, Bibliotecas, Mapas); Configurações tem Campanha e Mesa. Os endereços antigos continuam válidos.

## Páginas e livros

Tipos: texto, lugar, facção, livro, capítulo, item, acontecimento, NPC, objetivo, pista e nota pessoal. Título obrigatório até 120 caracteres; conteúdo até 10.000; segredos até 4.000; coleção até 120; etiquetas até 300. Coleção é uma identificação textual simples; não há árvore de pastas de textos. Capítulos/páginas podem pertencer a uma página raiz, com ordem 0–10.000, sem ciclos ou níveis adicionais. Relações são identificadores de até vinte páginas acessíveis da própria campanha; leitura de relacionados, referências inversas e filhos refaz autorização, sem revelar nomes privados. Até 100 filhos/referências inversas são mostrados. Fixar ordena a página antes das demais. Objetivos/pistas têm estado aberto, resolvido ou abandonado.

Somente o mestre administra páginas do mundo. Cada pessoa cria e edita suas notas; nem o mestre altera notas alheias. Uma página de lore de NPC pode apontar ao NPC de preparação sem copiar a ficha; referências de preparação não são enviadas ao leitor compartilhado. Os textos antigos continuam preservados no acervo anterior, acessível pelo novo Mundo; não há migração automática nem sincronização entre uma página nova e um texto anterior.

## Privacidade

`self`: autor; `master`: autor e mestre; `selected`: autor e até vinte participantes escolhidos; `table`: membros atuais. Leitura compartilhada nunca concede edição. Segredos e versões são entregues apenas ao editor autorizado, mesmo para o mestre lendo uma nota pessoal compartilhada. Conteúdo privado não participa dos resultados de busca de outro usuário. Parent, filhos e referências são filtrados separadamente.

Notas continuam vinculadas ao autor depois da saída e da exclusão da campanha. `/api/notebook` e sua tela oferecem leitura e exportação do texto próprio nessas situações, sem conceder acesso aos materiais de outras pessoas. Anexos continuam exigindo acesso à campanha/página; a recuperação pessoal fora da campanha é textual nesta entrega. Páginas de lore ficam inacessíveis quando a campanha é removida; o vínculo usa SET NULL para preservar os cadernos.

Uma mudança de acesso impede novas leituras; bytes já entregues não podem ser revogados. Editar compartilhamento exige salvar explicitamente. Rascunhos privados têm salvamento automático após 1,2 s sem digitação, serializado com a gravação manual. Falha suspende o salvamento automático; texto permanece no editor e pode ser baixado como rascunho. Conteúdo não vai para localStorage. Fechar o editor antes de salvar pode perder alterações ainda não enviadas.

## Histórico e arquivos

Revisão obrigatória em edições, lixeira e restauração. Até cinquenta versões anteriores por página, somente para editores. A interface permite recuperar o texto de uma versão no editor antes de salvar. Lixeira conserva a página e permite restaurar; conta no teto de 1.000 páginas por campanha. Até 1.000 sessões anteriores por campanha. Consultas de páginas, caderno, sessões anteriores e resumos são paginadas em vinte.

Importação TXT/Markdown carrega texto no editor para revisão (até 10.000 caracteres), sem renderizar HTML ou executar Markdown. Não substitui um campo de conteúdo já preenchido. Exportação de página compartilhada contém apenas título/conteúdo; baixar rascunho e exportação do caderno próprio incluem seus segredos.

Anexos: PDF, PNG, JPEG e WebP, assinatura e antivírus comuns de DocumentFiles, até 25 MiB por arquivo, dez por página e 250 MiB por campanha. Acesso segue a página no momento da leitura, inclusive após recolhimento ou lixeira. Downloads autenticados como anexo, private/no-store, nosniff e sandbox. Exclusão de anexo é definitiva, separada da lixeira da página. Bytes não aparecem nas listas ou versões. Importações externas específicas, pacote integral de exportação e recuperação de anexos fora da campanha ainda não são oferecidos.

## Atlas

Publicar requer confirmação de que a imagem inteira pode ser vista pelo grupo. AtlasPublication guarda cópia da imagem normalizada, sem grade, marcadores, névoa ou notas. Editar/excluir o mapa original não altera a cópia; o mestre pode atualizar a publicação ou recolhê-la. Acesso funciona entre sessões e exige vínculo atual. Até cinquenta mapas candidatos, vinte publicações por página. Não há pontos clicáveis de lugares no mapa nesta entrega.

## Operação e arquitetura

Domain/Workspace.cs define entidades. WorkspaceService e parciais Files/Atlas fazem autorização e transações. WorkspaceEndpoints expõe rotas Verified; CSRF comum cobre todas as escritas. Leituras são somente leitura. Mutação da mesa continua em SessionService com evento/revisão/Pulse; preparar páginas não altera a mesa.

Três migrações aditivas: CampaignContinuity, WorkspaceAttachmentsAtlas e WorkspaceReferences. Conferir backup e aplicar pelo processo existente; não apagar bancos. Valores existentes recebem origem nova e mínimo 1; nenhuma inferência histórica é feita. A migração de referências amplia o campo de snapshots para 100.000 caracteres para comportar o escape JSON; seu rollback reduz esse limite e exige avaliação antes de uso. Cache público v32 enumera só o módulo JS novo e recursos públicos, nunca os dados privados.

Não se promete importação automática de outras plataformas, coautoria simultânea, backup integral de campanha, recuperação automática de edições não enviadas ou carga medida. A numeração protege disputas dentro da aplicação; inserções diretas fora dos casos de uso não têm unicidade entre as duas tabelas de sessões.

A exclusão comum, administrativa e de one-shot remove páginas de lore e anexos dependentes na mesma transação; cadernos pessoais mantêm o autor. Seletores do editor buscam vinte opções por vez, preservando relações atuais, em vez de carregar todo o acervo. Referências privadas de NPC/mapa só podem ser associadas pelo mestre. A mesa oferece Meu caderno em outra aba para manter a sessão aberta.


## Capítulos, atos e arcos (ADR-060)

O mestre cria capítulos, atos ou arcos no Diário (até 200 por campanha), define a ordem e escolhe um ao iniciar cada sessão ou registrar uma sessão anterior. O tipo é só rótulo. Sessões sem capítulo são permitidas e aparecem como "Avulsa"; o capítulo de uma sessão pode mudar depois, inclusive encerrada. Excluir um capítulo mantém as sessões, que ficam avulsas. Novos capítulos ficam ocultos; o mestre marca “Visível para os jogadores” para revelar tipo, título, resumo e sessões publicadas daquele capítulo ao grupo (ADR-062). Para o jogador, sessões de capítulos ocultos aparecem sem capítulo. A premissa preserva parágrafos na Visão geral; o topo mostra um trecho e "mais" abre o texto completo.


## Tabela de sessões, busca e importação (ADR-061)

O Diário mostra uma única tabela de sessões, paginada em vinte, com as colunas Nº, Sessão, Capítulo, Origem (No Eternnus / Antes do Eternnus), Data e — para o mestre — Estado. Mestre e jogadores buscam por título, resumo e cenas e filtram por capítulo (ou avulsas) e origem; o jogador vê apenas o que foi publicado. Abrir uma sessão mostra o texto completo e, para o mestre, as ações. Capítulos aparecem em tabela paginada; o título leva às sessões do capítulo.

A importação em lote usa o modelo CSV baixado no site: uma linha por sessão anterior, capítulo opcional por nome (reutilizado se já existir; criado na ordem do arquivo), linhas com só o capítulo criam capítulos vazios. A prévia lista o que será criado e os erros por linha; nada é gravado antes da confirmação, e a confirmação grava tudo ou nada.

A Visão geral tem a busca na campanha, que leva ao local de cada resultado. Em Mundo e acervo, "NPCs conhecidos" lista os personagens que o mestre marcou como visíveis.
