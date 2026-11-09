# Plataforma — Ondas A e B

A evolução de progressão, conquistas, apresentação compartilhada e atlas oficial está em [PROGRESSAO_CENARIOS.md](PROGRESSAO_CENARIOS.md). As novas tarifas de XP não modificam lançamentos históricos nem quotas de conta.

Este documento complementa ARQUITETURA.md, API.md e GUIA_VISUAL.md com o escopo integrado da plataforma. Os contratos são do monólito, no mesmo host e banco PostgreSQL.

## Módulos e acesso

| Módulo | Conta verificada | Embaixador | Admin |
| --- | --- | --- | --- |
| Campanhas, personagens e mesa | Recursos próprios ou de campanhas participantes | Mesmas regras de recurso | Gestão global pelo painel específico |
| Biblioteca | Listar, visualizar e baixar materiais publicados | Publicar, editar e substituir materiais com auditoria | Também reverter e restaurar |
| Fichas-modelo | Usar versões publicadas em suas fichas | Criar modelos, editor visual, publicar versões | Também republicar versões anteriores |
| Guilda | Ler, responder, editar os próprios posts, marcar útil e denunciar | Também moderar tópicos/posts/denúncias | Também administrar categorias |
| Suporte | Apenas seus próprios chamados | Apenas seus próprios chamados | Fila administrativa, atribuição, prioridade/status e notas internas |
| Nível/conquistas | Sua jornada, ranking e cartão público sem e-mail | Mesmas leituras | Ajustar XP com motivo e auditoria |
| Painel administrativo | Sem acesso | Sem acesso | Visão geral, usuários, papéis, suspensões, campanhas, sistemas, fichas-modelo, tickets e auditoria |

Papéis são lidos do banco nas políticas Verified/Staff/Admin e nos casos de uso. Botões, nível e dados enviados pelo navegador não concedem permissão. Suspensão invalida sessões. Alterações de equipe têm registro em AuditEntry na mesma unidade de gravação. A proteção do último administrador é reaplicada no servidor.

## Onda A

A fundação acrescenta sistemas de RPG, papéis globais, auditoria, tickets/mensagens, arquivos privados e biblioteca versionada, modelos/versões/campos/ações de ficha, Guilda e progressão. O editor usa renderSheet em pdf-sheet.js, compartilhado com a ficha do jogador; fórmulas ficam em formula.js e Domain/Formulas (sem eval, com limites de comprimento, complexidade, profundidade e dados).

O editor de modelos permite mover/redimensionar por mouse ou teclado, guias/grade, desfazer/refazer, Ctrl+S, fórmulas com nomes conhecidos, teste de preenchimento, lista de problemas e comparação ao publicar. O upload de PDF aceita arquivo, páginas e revisão no mesmo multipart; o limite conta os três componentes. Modelos publicados são imutáveis: corrigir significa criar e publicar outra versão.

Biblioteca e PDFs são armazenados no banco, fora de wwwroot, com tamanho/assinatura/tipo/nome/hash e antivírus. A equipe publica diretamente com auditoria. O leitor usa pdf.js sem eval/scripting/XFA; baixar arquivo e registrar o download são operações distintas (GET para bytes e POST para registro). Nenhum arquivo privado entra no cache da PWA.

Guilda possui categorias, tópicos, posts com revisão, cartão de autor, marcações de útil, denúncias e moderação auditada. Níveis podem liberar a criação de certos tópicos; não ampliam quotas de campanhas ou mesas livres. XP tem chaves de origem idempotentes e limites por atividade/dia; nomes, regras e progresso são apresentados em português. Os limites diários usam UTC.

## Onda B

A ficha nasce de um modelo publicado (o escolhido na campanha, o padrão do sistema ou o Sistema livre). A versão fica fixada na ficha. Dados antigos são lidos como Sistema livre sem escrever durante GET e convertidos na primeira escrita válida. O frontend permite preencher sobre o PDF e também em formulário acessível com campos maiores.

Campos calculados são recomputados no servidor; valores enviados para eles não têm autoridade. Os papéis nome, nível, vida, vida máxima, armadura e movimento sincronizam as colunas utilizadas pela mesa. Ações do modelo são imutáveis e aparecem junto às ações pessoais; o jogador edita somente as próprias. Fórmulas pessoais aceitam até 300 caracteres e usam os nomes numéricos do modelo.

O mestre escolhe um modelo publicado, ativo e do sistema da campanha em Configurações. A escrita bloqueia a campanha, exige proprietário e revisão. Alterar a escolha afeta novas fichas; as existentes mantêm seu modelo/versão. Trocar o sistema limpa a escolha anterior. Cada versão pode ser migrada após prévia: campos são casados pelo nome, remoções/ajustes e avisos são apresentados, revisão e versão alvo são conferidas novamente no POST. Histórico por campo e registros de sessão são preservados.

O PDF preenchido usa os últimos valores salvos. A exportação renderiza fundo e valores em páginas novas com pdf-lib; não copia scripts, anexos, links ou formulários ativos. O resultado é um documento visual estático; a ficha editável permanece na plataforma. Páginas rasterizadas preservam a apresentação e caracteres do sistema, mas o texto do arquivo exportado não é pesquisável e o tamanho pode ser maior que o PDF original. Até 50 páginas, processamento sequencial e imagem limitada a 4.096 px por lado.

## Rotas de interface

| Rota | Finalidade |
| --- | --- |
| `#admin` e abas `users`, `campaigns`, `systems`, `templates`, `tickets`, `audit` | Gestão administrativa; `#admin/templates[/{id}[/versions/{versionId}]]` abre o editor de fichas-modelo no painel |
| `#support` | Chamados próprios e conversa (fora do menu do admin, que atende pela aba Tickets do painel) |
| `#library` | Acervo e visualizador |
| `#templates` e detalhe/versão | Gestão e editor de modelos para embaixadores; para admin redireciona a `#admin/templates` |
| `#guild` | Categorias, tópicos, perfil e moderação |
| `#progress` | Jornada, conquistas e ranking |
| `#character/new` | Criar com modelo publicado |
| `#character/new/{campaignId}` | Criar com o modelo da campanha |
| `#character/{characterId}` | Preencher, histórico, migração e PDF |
| `#character/{characterId}/{campaignId}` | Edição com retorno à mesa |

Novos módulos são carregados sob demanda e reutilizam shell, api.js, ui.js e loading universal. Recursos contínuos da mesa/editor/PDF são descartados ao sair. A navegação móvel usa Mais para destinos adicionais, preserva área segura e não cobre os últimos controles.

## Operação e limites

A migração PlatformFoundation é aplicada depois de LiveSessions e CampaignWorkspace acrescenta esta evolução. Preservar banco, backups, e-mails locais e chaves; nunca recriar um volume para migrar. O primeiro admin usa segredo privado Platform:InitialAdmin:Password e autenticador obrigatório; ver [CONTAS_MESAS_LIVRES.md](CONTAS_MESAS_LIVRES.md). A lista operacional Platform:BootstrapAdmins continua compatível e também exige MFA no acesso. O runtime não depende de Node/Python.

Documentos exigem clamd privado com assinaturas atualizadas e StreamMaxLength compatível com 25 MiB. UploadLimits contém a lista restrita de rotas acima dos 64 KiB; IIS/proxy devem ter limites coerentes. Uploads:AllowUnscanned funciona somente em Development, exclusivamente para fixtures isolados; não é mecanismo de produção nem libera o avatar. Avatar continua exigindo antivírus e moderação externa e falha fechado sem eles.

Registro de atividade de conta usa POST /api/auth/activity com CSRF e intervalo mínimo de atualização de cinco minutos; GET /auth/me permanece somente leitura. Cache PWA v11 contém somente shell/arquivos públicos explícitos. Sessões ativas não são recarregadas nem atualizadas por skipWaiting.

SMTP, SSO real, antivírus real, moderação externa, instalação em aparelhos e desempenho em carga exigem validação no ambiente de destino. Testes locais não medem capacidade nem garantem detecção completa de ameaças.
