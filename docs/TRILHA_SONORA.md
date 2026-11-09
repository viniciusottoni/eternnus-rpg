# Catálogo de músicas e trilha sonora da sessão

As músicas vêm de um catálogo global do servidor, gerenciado pela administração. O mestre só busca por nome e reproduz a faixa para toda a mesa; não envia arquivos. O servidor guarda o estado autoritativo da trilha na sessão, e cada navegador alinha seu próprio áudio a esse estado. Decisão em [DECISOES.md](DECISOES.md) (ADR-049); contratos HTTP em [API.md](API.md).

## Catálogo do servidor

- **Busca (mestre e contas verificadas):** `GET /api/music` devolve somente título, formato e duração. Não há bytes nem URL de áudio nessa resposta: a faixa só é ouvida pela sessão em que está tocando.
- **Gestão (Admin):** envio, busca, prévia, renomear e excluir no Painel admin → aba Músicas. As rotas exigem `Verified` e a política Admin (papel conferido no banco e MFA, como no restante do painel). Envio, renomeação e exclusão gravam auditoria (`music.upload`, `music.rename`, `music.delete`).
- **Direitos:** a interface pede que a administração envie apenas músicas com autorização de uso (composição própria, licença adquirida ou domínio público). Não há download de músicas de terceiros nem faixas externas incluídas. Catálogo vazio: a mesa informa que as faixas são disponibilizadas pela administração.
- **Formatos:** MP3 (MPEG Layer III), M4A (MP4 com faixa de som AAC `mp4a` e nenhuma de vídeo) e OGG (um único fluxo Vorbis ou Opus). MP3 é o recomendado: OGG pode não tocar em alguns aparelhos Apple.
- **Limites:** 20 MiB por arquivo; requisição multipart até 20 MiB + 64 KiB (exceção enumerada em `UploadLimits` para POST `/api/admin/music`); 200 faixas e 2 GiB no catálogo (`MusicLimits.MaxCatalogBytes`). Limitador `catalog`: 30 envios a cada 5 minutos por usuário. Listas paginadas em 20, ordenadas por título, página limitada a 1–100.000; busca por título até 100 caracteres.
- **Validação:** `Domain/AudioProbe.cs` percorre o arquivo inteiro. Quadros, páginas ou caixas precisam cobrir os bytes, o que recusa imagens, executáveis, extensão trocada e conteúdo arbitrário acrescentado (`415`). Não há antivírus no áudio (ADR-051): só Admin com MFA envia e a hospedagem compartilhada não oferece clamd. O áudio não passa pelos decodificadores de imagem nem é recodificado. Arquivo idêntico (mesmo SHA-256) já presente responde `409`. A duração vem da estrutura (soma de quadros MP3, última página OGG, `mvhd` do M4A) e fica nula quando o arquivo não a informa.
- **Quota sob concorrência:** no PostgreSQL, os envios são serializados por `pg_advisory_xact_lock`; contagem, espaço e duplicidade são reconferidos dentro da transação.
- **Título:** opcional no envio; sem ele, usa o nome do arquivo sem extensão e com `_` trocado por espaço. Caracteres de controle e de formatação são removidos, espaços colapsados, até 120 caracteres. O nome original nunca forma caminho.

## Armazenamento, backup e limpeza

- **Bytes:** disco privado em `Music:Directory` (padrão `App_Data/music`). A inicialização cria o diretório e recusa um caminho dentro de `wwwroot`. Cada arquivo recebe um nome opaco (`{guid}.audio`), gravado primeiro como `.partial` e movido sem sobrescrever; leitores nunca veem arquivo parcial.
- **Metadados:** tabela `MusicTracks` no PostgreSQL, sem vínculo com campanha (título, tipo real, tamanho, duração, SHA-256, chave de armazenamento, autor, revisão; índices em título, SHA-256 e chave única). A chave interna e o caminho físico não aparecem em respostas.
- **Consistência:** o arquivo é gravado antes do commit; se a transação falhar (quota, duplicidade, erro), ele é apagado. A exclusão remove o registro, faz commit e depois apaga o arquivo.
- **Limpeza:** `MusicStorageSweeper` roda dois minutos após iniciar e depois a cada seis horas. Remove arquivos sem registro e `.partial` com mais de uma hora (por exemplo, após falha entre gravação e commit). Excluir uma campanha não afeta o catálogo.
- **Backup:** fazer o backup do PostgreSQL e do diretório de áudio no mesmo momento, junto com as chaves de Data Protection, e restaurar ambos do mesmo ponto. Arquivo sem registro é órfão e será removido; registro sem arquivo responde `404` ao tocar.

## Estado autoritativo da sessão

`GameSession` guarda `MusicTrackId`, `MusicPlaying`, `MusicPositionMs` (posição de referência), `MusicReferenceAt` (instante UTC do servidor), `MusicLoop` e `MusicVersion`. A migração `SessionSoundtrack` é aditiva; a FK da faixa usa `SetNull` como rede de segurança.

Comandos (`POST /api/sessions/{id}/music`, somente mestre) passam por `SessionService` (`Application/SessionSoundtrack.cs`): transação → bloqueio da sessão → mestre e sessão ativa → conferência da versão → alteração → evento `music` (`masterOnly`) → `Revision++` → commit → `SessionSignals.Pulse`.

| Ação | Efeito |
| --- | --- |
| `select` | Faixa do catálogo (bloqueada `FOR SHARE` na mesma transação); posição 0; toca conforme `autoplay` (padrão verdadeiro). Inexistente: `404` "Faixa não encontrada no catálogo". |
| `play` | Retoma da posição calculada; se a faixa terminou sem repetição, recomeça do zero. |
| `pause` | Congela a posição calculada no instante do comando. |
| `stop` | Remove a faixa da sessão; a faixa deixa de estar em uso. |
| `seek` | Nova posição (≥ 0, limitada à duração conhecida). |
| `loop` | Liga/desliga repetição sem salto: a referência é recalculada antes. |

`version` diferente de `MusicVersion` responde `409` (comando baseado em estado antigo, outra janela ou clique concorrente); dois comandos simultâneos com a mesma versão resultam em um `200` e um `409`. Encerrar a sessão limpa a trilha e incrementa a versão.

Exclusão no catálogo: bloqueia a faixa (`FOR UPDATE`) e então confere sessões ativas que a usam; se houver, `409` até o mestre parar ou trocar a música. A seleção bloqueia a sessão e depois a faixa (`FOR SHARE`), e a exclusão não bloqueia sessões: não há ciclo de bloqueio. Ou a seleção espera e a exclusão vence antes (seleção `404`), ou a exclusão espera o commit e encontra a faixa em uso (`409`).

Posição esperada (`SoundtrackState.At` no servidor, `expectedPosition` no cliente): tocando, `PositionMs + (agora − ReferenceAt)`; pausada, `PositionMs`. Com duração conhecida, a repetição usa o resto da divisão e, sem repetição, a faixa termina na duração.

## Distribuição e sincronização no navegador

- O bloco `music` chega pela consulta ao vivo existente (`GET …/live`); não há nova infraestrutura de tempo real nem estado autoritativo em memória. O comando devolve o novo estado para resposta imediata ao mestre.
- Estados com versão menor que a já aplicada são descartados. Eventos de carregamento de uma faixa anterior são ignorados (só vale o `src` atual). Respostas atrasadas de buscas anteriores no catálogo também são descartadas.
- Diferença de relógio: cada resposta gera uma amostra `serverTime − chegada local`; vale a maior das sete mais recentes, pois atrasos só a subestimam. `serverTime` é lido ao fim da montagem da resposta.
- Correção: desvio abaixo de 300 ms é ignorado; até 1,5 s ajusta a velocidade em até ±6% até chegar a 90 ms; acima disso, ou após um novo comando do mestre, salta para a posição esperada, com no mínimo 8 s entre saltos automáticos. Conferência a cada 2 s; intervalo maior que 6 s entre conferências indica suspensão do aparelho e força o realinhamento. Ao voltar de aba oculta, a mesa reconcilia na hora.
- Quem entra, recarrega ou reconecta calcula a posição atual pelo mesmo estado.
- Reprodução automática bloqueada: o selo e o painel mostram **Ativar áudio da sessão**; o clique toca dentro do gesto e alinha à posição atual. O bloqueio pode voltar após recarregar.
- Volume e silenciar são pessoais (`localStorage` `eternnus.session-audio`, com fallback seguro) e não alteram os demais. No iOS o volume do elemento não é ajustável: só silenciar fica disponível.
- Enquanto há faixa na sessão, a trilha global do site é pausada e oculta (`suspendMusic`); ao parar a trilha, encerrar ou sair da mesa, volta conforme a preferência anterior (`resumeMusic`). Os controles de mídia do sistema passam à trilha da sessão nesse intervalo.
- O descarte do roteador encerra temporizadores, listeners e buscas pendentes, e remove o elemento de áudio.

## Entrega dos bytes

| Rota | Quem |
| --- | --- |
| `GET /api/admin/music/{trackId}/audio` | Admin, para a prévia no painel. |
| `GET /api/sessions/{id}/music/{trackId}/audio` | Mestre ou participante presente na mesa (`LastSeenAt` preenchido), somente para a faixa selecionada da sessão em andamento. |

Fora dessas condições, `404` sem revelar se a faixa existe. Respostas com HTTP Range (`206`, `416`), ETag pelo SHA-256, MIME validado no envio, `Cache-Control: private, no-store`, `nosniff`, `Content-Security-Policy: sandbox; default-src 'none'` e `Cross-Origin-Resource-Policy: same-origin`. Não há URL pública permanente. O service worker não intercepta `/api` e nada disso entra no Cache Storage.

## Interface

- **Painel admin → aba Músicas** (Admin): aviso de direitos, uso da quota, busca, lista paginada com formato, duração e tamanho, prévia, renomear, excluir (bloqueado com motivo para faixas tocando em sessão) e modal de envio com validação local antes do servidor.
- **Mesa → aba ♪ Trilha:** faixa, estado, progresso, duração e repetição para todos. O mestre tem tocar/pausar, ±10 s, repetir, parar, controle de posição e busca por nome no catálogo, sem sair da sessão. Jogadores veem estado e controles pessoais.
- **Selo do topo da mesa:** faixa, estado anunciado, silenciar e **Ativar áudio da sessão** quando necessário; abre a aba ♪ Trilha.
- Estados: sem trilha, carregando, tocando, pausada, terminou, bloqueado, faixa indisponível, catálogo vazio, busca sem resultado, erro com nova tentativa e comandos indisponíveis com motivo.

## Limites

- Bytes já entregues ao navegador não podem ser revogados; parar ou excluir só impede novas leituras.
- Não há reprodução automática garantida nem sincronização perfeita: rede, economia de energia, decodificação e o próprio navegador causam pequenas diferenças entre dispositivos.
- `SessionSignals` é memória do processo; com vários hosts a propagação cai para até ~5 s, como no resto da mesa. Vários hosts também exigiriam armazenamento de áudio compartilhado.
- Áudio não passa por antivírus; um arquivo infectado enviado por Admin não seria detectado (ver ADR-051). Carga e consumo de disco reais não foram medidos.

## Validação

`MusicTests.cs`, `tests/soundtrack-policy.test.mjs`, `tests/soundtrack.mjs` (PostgreSQL) e `tests/soundtrack-ui.mjs` (dois navegadores). Resultados em [TESTES.md](TESTES.md).
