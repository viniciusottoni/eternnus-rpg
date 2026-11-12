# Segurança, estabilidade e desempenho

Progressão e atlas: [PROGRESSAO_CENARIOS.md](PROGRESSAO_CENARIOS.md) registra as tarifas, reconhecimento histórico somente leitura, elegibilidade de sessão e limites preexistentes de concorrência do resumo de XP. Tetos de recompensa e janela entre entrada/encerramento não devem ser anunciados como prevenção completa de fraude. Mapas oficiais continuam validados pelo servidor; novas texturas e animações são apenas apresentação. Nenhum dado de XP, perfil ou mapa privado foi incluído no cache público v19.

Este documento descreve controles e limites, não uma certificação nem garantia contra toda invasão. Segurança é mantida por implementação, testes, configuração do ambiente, atualizações e monitoramento. Não declarar capacidade de usuários simultâneos sem medição no ambiente de destino.

## Fronteiras de confiança

O navegador, parâmetros, e-mails, perfis de provedores e identificadores recebidos são entradas não confiáveis. O servidor autentica a sessão, verifica a conta e autoriza o recurso. PostgreSQL, chaves de Data Protection, configurações privadas e o provedor SMTP fazem parte da operação protegida. O sistema de arquivos de e-mail local é exclusivamente de desenvolvimento.

## Controles por camada

| Camada/risco | Controle implementado | Limite a preservar |
| --- | --- | --- |
| Credenciais locais | ASP.NET Identity, hash de senha e validação padrão; senha mínima 10, máxima 128. | Não guardar senha em logs, analytics ou estado persistido do frontend. |
| Tentativas de login | Bloqueio de conta após cinco falhas, por 15 minutos; limites de requisição. | Limites por processo não substituem proteção distribuída ou na borda. |
| Sessão | Cookie HttpOnly; Secure e prefixo `__Host-` em produção; SameSite Lax; login comum de oito horas renováveis com teto de 24 h; persistência opcional de 14 dias fixos; administrador com MFA e oito horas fixas. | Não desabilitar HTTPS nem copiar cookie para localStorage. Polling e heartbeat não ultrapassam o teto absoluto. |
| Senha alterada | Security stamp validado em cada requisição autenticada. | Essa verificação tem custo de banco; não cachear sem estratégia de invalidação. |
| CSRF | Cookie/token antiforgery e `X-CSRF-TOKEN`, além de `X-Eternnus: 1` para escritas. | SameSite e HTTPS isoladamente não substituem validação antiforgery. |
| Acesso pendente | Política `Verified` em APIs de jogo e leitura do estado real do usuário. | Botões bloqueados são apenas apresentação. |
| Acesso por ID | Consulta por proprietário/participante antes de consultar/alterar recurso. | Não aceitar `OwnerId` como autoridade do corpo JSON. |
| OAuth | Middleware com correlação/state; Google com PKCE; e-mail verificado; chave estável do provedor. | Sem fusão implícita por e-mail e sem guardar access tokens. |
| XSS | Escape compartilhado de valores, `textContent` para feedback, CSP sem scripts inline. | Toda nova interpolação e URL precisa de revisão; CSP é defesa adicional. |
| SQL injection | Consultas EF Core e SQL de bloqueio interpolado por parâmetros. | Não construir SQL por concatenação de valores. |
| Clickjacking/conteúdo | `frame-ancestors 'none'`, `X-Frame-Options`, `nosniff`, Permissions Policy e referrer sem informação. | Não relaxar cabeçalhos para contornar um bug de frontend. |
| Corpo e consultas | Limite comum de 64 KiB no Kestrel (exceções restritas em UploadLimits: avatar de 2 MiB + 16 KiB e documentos de 25 MiB + 256 KiB), limites de campo, paginação de campanhas em 20 itens. | IIS/proxy também precisa de configuração coerente. |
| Corridas de campanhas | Transação, bloqueio de linha compartilhado e revisão de edição. | Testar no PostgreSQL, não somente em SQLite. |
| Erros | Respostas controladas e identificador de requisição nos logs internos. | Não devolver stack trace, SQL ou dados privados ao navegador. |

A implementação do token de formulário segue a proteção antiforgery do framework; cookies de autenticação são enviados automaticamente pelo navegador e exigem proteção adicional nas escritas. [Documentação ASP.NET Core](https://learn.microsoft.com/en-us/aspnet/core/security/anti-request-forgery?view=aspnetcore-10.0).

## Confirmação e recuperação

Links usam finalidades distintas de Identity, validade de uma hora e origem pública configurada. Recuperação responde genericamente para não confirmar diretamente a existência de uma conta. Reenvio/recuperação reservam um intervalo por usuário mediante atualização atômica do banco. O cadastro e a mensagem de confirmação são gravados juntos antes de emitir sessão.

O modo de desenvolvimento grava `.eml` em `App_Data/mail`, não em `wwwroot`. Esses arquivos contêm dados pessoais e links de uso restrito. Não anexar a issues, importar em screenshots, enviar ao repositório ou expor por endpoints. Em produção, o aplicativo rejeita configuração Pickup.

## Fila de e-mail

- Payload protegido por Data Protection enquanto aguarda envio; conteúdo removido da fila após sucesso.
- Lease de dois minutos, no máximo dez mensagens consultadas por rodada e processamento a cada dois segundos.
- No máximo oito tentativas, com intervalo crescente limitado a uma hora entre tentativas. Falhas de envio não bloqueiam a resposta de formulário.
- Entrega é pelo menos uma vez: se o processo cair após o SMTP aceitar e antes de marcar sucesso, poderá ocorrer mensagem duplicada. O Message-ID é estável por item.
- Monitorar itens com oito tentativas, fila envelhecida, falhas recorrentes e envio fora da taxa contratada. A interface de operação/reenvio manual ainda não faz parte desta etapa.

Não apagar as chaves para “corrigir” uma falha da fila: elas também protegem cookies e tokens. Proteger o diretório com permissões da identidade do processo e incluir as chaves no plano de recuperação. A documentação do framework ressalta que persistência e proteção de chaves precisam ser ajustadas para múltiplas máquinas. [Data Protection](https://learn.microsoft.com/en-us/aspnet/core/security/data-protection/configuration/overview?view=aspnetcore-10.0).

## Limitação de requisições

Os valores atuais são 30 requisições/minuto/IP para autenticação, seis/minuto/IP para e-mail e bucket global por usuário/IP de 120 tokens, repondo 60 por minuto. A consulta ao vivo da mesa (`GET …/live`) usa um balde separado de 180/minuto por usuário e no máximo quatro consultas simultâneas por usuário, para que a espera longa não consuma o limite das escritas. São limites em memória, por instância. Não são uma proteção completa contra DDoS. Um proxy deve preservar a identificação correta da origem somente por configuração de proxies confiáveis; não confiar livremente em cabeçalhos enviados pelo cliente.

## Preparação de desempenho

A instalação PWA não cria uma fronteira de confiança nova: o mesmo servidor continua autenticando e autorizando cada operação. Seu cache é uma lista permitida de recursos públicos, nunca cache de API/conta. Não armazenar no Cache Storage respostas com perfil, dados de campanha, mensagens, tokens de formulário ou links de confirmação/recuperação. O shell offline não concede acesso offline; ver `PWA.md`.

Consultas de campanhas usam projeção, `AsNoTracking`, paginação, ordenação estável e índices. As alterações mantêm a seção crítica curta e não enviam SMTP dentro da transação. O frontend reutiliza módulos, carrega o jogo sob demanda e usa WebP derivados das artes oficiais, preservando os originais. CSS, JavaScript e SVG podem receber compressão HTTP; JSON de autenticação/CSRF não é incluído nessa compressão. Assets têm cache curto, e código da interface exige revalidação para evitar servir uma versão antiga após publicação.

O Npgsql já oferece pooling de conexões; antes de ajustar limites, medir conexões ativas/espera e o limite real do banco. Não somar pools de várias instâncias sem considerar o total disponível. [Npgsql](https://www.npgsql.org/doc/basic-usage.html). Bloqueios de linha protegem a consistência, mas transações longas podem aumentar espera; monitorar locks e deadlocks. [PostgreSQL 17](https://www.postgresql.org/docs/17/explicit-locking.html).

## Mesa ao vivo

- Escritas da mesa bloqueiam a linha da sessão em transação curta; nenhuma chamada externa acontece dentro dela. Rolagens usam gerador criptográfico no servidor.
- Turno, papel, propriedade da ficha, alcance e casas livres são conferidos no banco a cada escrita. A interface apenas reflete o estado.
- Jogadores não recebem notas privadas nem o objetivo do mestre; lista e histórico completo de sessões continuam exclusivos do mestre. Fichas compartilhadas são legíveis pelos membros; fichas privadas e auditoria de alterações são exclusivas do dono/mestre autorizado. Membros não expõem e-mail.
- Cada aba com a mesa aberta mantém uma requisição pendente por até ~25 s e envia heartbeat a cada 20 s. Considerar esse número de conexões no limite do IIS/Kestrel, no pool do PostgreSQL (cada espera faz consultas curtas a cada 5 s) e no teste de carga.
- `SessionSignals` é memória do processo: em vários hosts, a propagação entre eles cai para até ~5 s. Não depende de afinidade de sessão.

## Validação de capacidade antes de abrir em escala

1. Usar ambiente de homologação e dados sintéticos; medir o mesmo perfil de hospedagem pretendido.
2. Definir jornadas: leitura de campanhas, busca, edição, entrada/saída, login, fila de e-mails e mesas ao vivo (mestre + jogadores com consulta ao vivo, heartbeat, chat, rolagens e movimentos). Evitar usar contas ou SMTP reais em carga.
3. Aumentar concorrência gradualmente. Registrar throughput, p50/p95/p99, erros por status, CPU, memória, conexões, espera por lock e latência do banco.
4. Distinguir `429` esperado de erro inesperado; não desligar controles em produção para obter um número maior.
5. Definir meta e margem com o responsável pelo produto após os resultados. Repetir após mudanças relevantes de esquema, autenticação ou infraestrutura.

Nenhum número de capacidade é declarado por este documento. Expansão para múltiplos hosts exige rate limiting compartilhado/na borda, key ring compartilhado com proteção compatível entre máquinas, configuração de proxy, orçamento de conexões e estratégia de migração coordenada. DPAPI local do Windows não basta para compartilhar chaves entre máquinas.

## Operação e restauração

Login persistente: a escolha explícita permite 14 dias fixos; login comum tem oito horas renováveis e teto de 24 horas; administrador tem MFA e oito horas fixas. O início fica protegido no ticket e não é reiniciado pelo security stamp, confirmação de e-mail ou tráfego automático. `logout-all` usa a identidade autenticada e CSRF para trocar o stamp, invalidando outros cookies e desafios MFA na próxima requisição. Não altera as permissões de conta pendente. A maior duração amplia a exposição de um dispositivo pessoal desbloqueado; usar Sair em dispositivos compartilhados.

Na primeira publicação desta política, cookies anteriores sem início protegido são recusados e exigem novo login. Não há migração de dados. As chaves continuam em `App_Data/keys` (ou diretório privado configurado), excluídas do pacote pelo `.csproj`; o upload FTPS não apaga arquivos remotos. Preservar ACL, diretório e nome de aplicação entre deploys. O cliente fecha recursos contínuos após detectar perda de autenticação, sem reenviar escritas. Operações HTTP já autorizadas podem terminar; a revogação é observada em nova requisição. O fluxo não persiste rascunhos de formulários.

Manter backup do PostgreSQL e das chaves, testar restauração, controlar acesso ao servidor e separar permissões de migração e de runtime quando a hospedagem permitir. A migração `SearchUnaccent` cria a extensão `unaccent` (busca sem acento, ADR-076): o usuário de migração precisa do privilégio `CREATE` no banco. Monitorar `/health`, falhas de login, fila, consumo de recursos e erros inesperados, sem capturar senha ou códigos de e-mail. Atualizar dependências com testes de regressão e análise de vulnerabilidades. Publicação, SMTP real e OAuth real dependem de validação na conta da hospedagem.


## Segurança de avatares

O envio combina validação de assinatura real/extensão/MIME, limite de bytes/dimensões/pixels, antivírus ClamAV no original, reconstrução JPEG sem metadados e análise de conteúdo do Azure AI Content Safety na imagem normalizada inteira. Todos os verificadores são obrigatórios; nenhum erro ou resultado incompleto autoriza publicação. Nomes originais de arquivo não são usados em paths ou persistidos. O avatar fica no banco e é servido somente para a própria sessão por API sem cache. O parsing multipart pode usar o diretório temporário do ASP.NET fora de wwwroot; mantê-lo privado, com orçamento de disco e limpeza após encerramento de requisições/processo.

O ClamAV procura ameaças conhecidas por assinaturas/heurísticas, incluindo vírus, trojans, spyware e outras classes de malware detectáveis pelo mecanismo. Não existe garantia de detectar todas as ameaças ou de classificar todo conteúdo corretamente. Manter engine, assinaturas via freshclam, dependências nativas e sistema atualizados; monitorar atualização das assinaturas, saúde dos serviços, latência, 422/503 e falsos positivos. O protocolo clamd TCP não tem autenticação/TLS: usar somente localhost/rede privada protegida, jamais porta pública. A análise de conteúdo pode gerar falsos positivos/negativos; ajustar política exige decisão explícita e revisão.

Apenas categorias com severidade zero passam. Conteúdo sexual, violência, ódio e automutilação com severidade >= 2 é recusado. A imagem normalizada é enviada à Microsoft, sem e-mail/nome do usuário no payload. Informar isso na interface e política de privacidade; avaliar região, retenção e termos do provedor antes de ativar produção. Timeout de rede é de 15 s em cada verificador e HTTP sem redirects. Cancelamento/limites locais não são uma medição de carga ou isolamento completo de falhas nativas.

Referências primárias: [protocolo ClamAV](https://docs.clamav.net/manual/Usage/ClamdProtocol.html), [moderação de imagens Azure](https://learn.microsoft.com/en-us/azure/ai-services/content-safety/quickstart-image) e [Magick.NET](https://github.com/dlemstra/Magick.NET).

## Plataforma e arquivos privados

Políticas Admin/Staff consultam o banco; toda operação também revalida o recurso e o ator no serviço. Alteração de papel, suspensão, moderação e publicação têm trilha de auditoria. A proteção do último administrador usa bloqueio transacional. Notas internas de suporte são exclusivas de administradores; dono de chamado vê somente a conversa pública. XP e nível são calculados no servidor, com fontes idempotentes e tetos, nunca aceitos do cliente como permissões.

LibraryService/SheetTemplateService compartilham DocumentFiles: assinatura/tipo real, nome seguro, teto de 25 MiB, SHA-256 e tentativa de ClamAV antes de persistir (detecção recusa com 422; scanner ausente/indisponível aceita e registra aviso — ADR-058). Arquivos e versões ficam no banco, sem paths de usuário, servidos somente por API autorizada com no-store, nosniff e sandbox. Não tratam assinatura ou antivírus como garantia de ausência de conteúdo ativo; manter os parsers e o host atualizados. PDFs originais baixados continuam documentos de terceiros.

O leitor/editor usa pdf.js local com eval/scripting desabilitados. O PDF preenchido é reconstruído a partir de páginas renderizadas, sem copiar objetos ativos, anexos, formulários ou links do original. Os campos e calculados usam o estado salvo; texto de usuário permanece texto. O modelo/versão fica fixado e migração é explícita com revisão. URLs de PDF aceitas pelo cliente são restritas às rotas privadas esperadas, com query de revisão limitada.

GET /auth/me e GET da mesa não gravam atividade. POST /auth/activity usa CSRF e atualização atômica com intervalo de cinco minutos. O POST serve apenas metadados de atividade e não amplia acesso ou confirma e-mail. As exceções de corpo grande são enumeradas em UploadLimits e testadas contra caminhos semelhantes inválidos. A autenticação, CSRF, autorização e validação continuam necessárias em cada upload.

As revisões locais não equivalem a auditoria independente ou teste de invasão. Sem credenciais externas, os adaptadores são verificados por serviços simulados e as funções reais permanecem bloqueadas quando indisponíveis.

## Evolução: limites, MFA e recursos da campanha

Campanhas/mapas/textos usam os contratos de CONTAS_MESAS_LIVRES.md e CAMPANHA_ACERVOS.md. Upload de mapa é exceção enumerada de 10 MiB + 64 KiB; parser, scanner e normalização continuam obrigatórios. Revisar limites IIS/proxy. Históricos de ficha permanecem privados mesmo quando a ficha é compartilhada. Admin exige autenticador e prova MFA no cookie, preservada na renovação do principal; bootstrap usa somente configuração privada.

Imagens temporárias não são uploads: somente identificador/título e sinalização passam pelo servidor. WebRTC usa bytes reconstruídos nos navegadores, com descarte na saída. Origin do WebSocket e autorização de recurso são reaplicados; conexões diretas podem exigir STUN/TURN privado para redes restritas. Ver IMAGENS_TEMPORARIAS.md. Nada disso integra Cache Storage. O cache público v12 inclui apenas os novos módulos estáticos.


## Névoa e visão

A visibilidade é decidida no servidor. Jogadores não recebem marcadores fora da visão, criaturas ocultas não reveladas, marcas não reveladas, paredes/terreno de casas nunca vistas nem pixels de mapas enviados fora da exploração; eventos de criaturas não visíveis são do mestre; erros de movimento não revelam terreno nem ocupante. "Ver como" e toda edição de névoa exigem o mestre no servidor. A imagem mascarada usa a política restritiva do ImageMagick, cache em memória limitado (96 MiB) e duas gerações simultâneas; falha responde erro sem cair para a imagem completa. Limites: bytes já entregues não são revogáveis; desenho de mapas oficiais é público; carga não medida.


## Condução da mesa e one-shots recuperáveis (ADR-046)

- **Configuração:** `OneShots:RecoveryMinutes` (inteiro, 1–120; padrão 10) define quanto tempo a one-shot espera o mestre voltar antes da limpeza. Não é segredo; pode ficar no `appsettings` de produção. Alterar exige reiniciar o processo.
- **Rolagens privadas:** visibilidade aplicada no servidor (`MasterOnly`/`VisibleToUserId`). A resposta HTTP de rolagem às cegas não traz o resultado ao autor, e logs não registram resultados.
- **Convite guardado:** `PendingInvite` só aceita o formato de 32 hex. Não confirma existência a contas não verificadas e não concede acesso; a entrada continua em `POST /api/campaigns/join`, com Verified e quotas.
- **Modelos privados:** não concedem papel de equipe; leitura restrita a mestre/membros e donos de fichas presas ao modelo. O editor da equipe recusa alterá-los.
- **Arquivamento:** bloqueia escritas de jogo e preparação, preserva dados e não libera quota.
- **Conversão:** bloqueios na ordem sessão → campanha → contas, evitando inversão com entrada e criação concorrentes. Coberto por `tests/table-play.mjs`.


## Catálogo de músicas e trilha da sessão

- Envio, renomeação e exclusão só para Admin (Verified, política Admin com MFA, CSRF, limitador `catalog` de 30 envios a cada 5 minutos), com auditoria `music.upload`, `music.rename` e `music.delete`. O mestre só busca título, formato e duração. `UploadLimits` acrescenta POST `/api/admin/music`: 20 MiB de arquivo e 20 MiB + 64 KiB por requisição; o restante continua em 64 KiB. O padrão de `requestFiltering` do IIS (~28,6 MB) comporta; revisar se o proxy tiver limite menor.
- Tipo decidido pela estrutura do arquivo (`AudioProbe`), não pela extensão; sem antivírus por decisão (ADR-051): envio restrito ao Admin com MFA, bytes servidos com `nosniff` e CSP sandbox. Validação estrutural não garante ausência de conteúdo malicioso para os decodificadores do navegador; manter navegadores e servidor atualizados.
- Bytes em diretório privado fora de wwwroot, nomes opacos, sem caminho em respostas ou logs. Entrega autenticada por requisição: jogador e mestre só recebem a faixa selecionada da sessão ativa em que estão; o Admin, a prévia do catálogo. `private, no-store`, `nosniff`, CSP `sandbox`, CORP `same-origin`. Nada entra no Cache Storage.
- Bytes já entregues não podem ser revogados. Comandos da trilha seguem o bloqueio da sessão, eventos `masterOnly` e versão que recusa comandos obsoletos; a exclusão no catálogo recusa faixas em uso sem ciclo de bloqueio.
- O diretório de áudio integra o plano de backup/restauração e o orçamento de disco (até 2 GiB no catálogo). Carga e consumo reais não foram medidos. Ver [TRILHA_SONORA.md](TRILHA_SONORA.md).

## Cadernos e acervo

Ver CAMPANHAS_CONTINUIDADE.md. Autorização por página, sem herdar poderes do mestre sobre notas pessoais. Filtrar também relacionados, filhos, referências inversas, anexos, versões, busca e exportação. Arquivos reutilizam assinatura/antivírus e são downloads privados. Atlas inteiro exige publicação explícita e mantém cópia independente. Cotas e bloqueio da campanha limitam gravações concorrentes. Nenhum conteúdo autenticado entra no cache público v32. Recuperação pessoal fora da campanha é textual; anexos exigem vínculo atual.


## Busca e importação em lote (ADR-061)

- Buscas usam o termo como parâmetro em ILIKE/LIKE com `\`, `%` e `_` escapados; 2 a 100 caracteres, sem caracteres de controle. Cada fonte aplica a visibilidade da sua tela; segredos de páginas, notas de NPC e objetivo inicial não entram na busca do jogador.
- Importação CSV: só mestre, rota com limite de corpo próprio (1 MiB + 64 KiB), limitador `upload`, antiforgery comum, um único arquivo `.csv`/`.txt`. Decodificação UTF-8 estrita com recuo para Windows-1252; recusa bytes nulos, caracteres de controle e controles bidirecionais. Leitor RFC 4180 sem avaliar conteúdo, até 1.000 linhas e 100 colunas. Prévia não grava; confirmação grava numa transação sob o bloqueio da campanha. Mensagens de erro citam linha e regra, nunca o conteúdo bruto do arquivo nem exceções.
- Fórmulas de planilha ficam como texto e a interface sempre escapa o conteúdo. Não há exportação para planilha; se for criada, neutralizar células iniciadas por `= + - @`.
- Retrato de NPC compartilhado: rota própria confere vínculo e compartilhamento; `private, no-store` e `nosniff`.
