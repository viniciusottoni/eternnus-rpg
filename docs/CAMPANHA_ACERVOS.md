# Bibliotecas e mapas da campanha

Mapas com grade (enviados e oficiais) têm o botão "☼ Névoa e luz" para preparar paredes, portas, focos, névoa inicial e marcas ocultas. A camada pertence à campanha, continua entre sessões e é removida com o mapa. Com névoa ativa, o jogador recebe a imagem mascarada às casas exploradas. Ver [NEVOA_ILUMINACAO.md](NEVOA_ILUMINACAO.md).

Existem três escopos. A biblioteca geral usa `/api/library?systemId=none`; a biblioteca padrão de cada sistema usa `/api/library?systemId={guid}`. Ambas ficam disponíveis fora da campanha para contas verificadas. A aba Bibliotecas da campanha oferece os dois atalhos e o acervo específico, composto exclusivamente por nome e texto de apoio. Esse acervo não aceita arquivos. Somente o mestre cria, edita, publica, recolhe e exclui textos. Jogadores vinculados recebem apenas publicados; rascunhos não aparecem no payload. Listas são paginadas em 20, com teto de 500 textos por campanha e revisão obrigatória em edição.

Mapas são enviados na aba Mapas, exclusiva do mestre, antes ou durante a sessão. Pastas/subpastas chegam a oito níveis e 100 pastas por campanha. Na aba, o Atlas do Eternnus vem primeiro; abaixo dele, o bloco “Mapas da campanha” reúne **+ Nova pasta** e **+ Enviar mapa** (na pasta aberta), o explorador e, na barra da pasta aberta, **✎ Renomear** e **Excluir pasta**. Mapas podem ser renomeados, movidos, configurados e excluídos. Excluir pasta exige que esteja vazia. O mestre escolhe pixels por quadrado (8–1.024) e metros por quadrado (0,01–1.000; duas casas decimais), preservados na imagem normalizada. No envio, o mestre escolhe **Apenas imagem** (`HasGrid = false`: cena sem grade, sem marcadores nem névoa) ou **Usar grade**, com prévia e ajuste visual de tamanho e alinhamento (`GridOffsetX/Y`, 0 até o lado − 1; números exatos na interface Completa). A grade começa no deslocamento escolhido (padrão: canto superior esquerdo) e usa os quadrados completos; faixas parciais nas bordas são descartadas do tabuleiro. A grade admite até 100 casas por lado e 4.096 casas no total. Todas as casas são transitáveis: paredes desenhadas na imagem não criam obstáculos automaticamente. A primeira linha oferece pontos de entrada. Marcadores, ocupação, turno e movimento passam pelas mesmas regras dos tilesets oficiais. O deslocamento usa a escala selecionada em metros por quadrado, conservando o mínimo legado de uma casa; oficiais usam 1,5 m.

Há até 50 mapas e 250 MiB de imagens normalizadas por campanha. Cada original aceita até 10 MiB, PNG/JPEG reais, 64–4.096 pixels por lado e oito milhões de pixels. ClamAV é reaproveitado de DocumentFiles; falha de verificação não publica. Decoder e reconstrução JPEG usam a política restritiva de AvatarProcessor: coders limitados, sem delegates, paths ou disco, até duas normalizações simultâneas. A imagem inteira mantém a proporção; metadados/perfis são retirados. Bytes pertencem diretamente à campanha no banco, sem arquivo público nem original preservado. Há temporários privados do parser multipart sujeitos à limpeza do framework; arquivos não entram no service worker. Azure de moderação de avatares não participa de mapas.

Mostrar na mesa passa pelo comando existente `POST /api/sessions/{id}/map`, chave `asset:{guid}`, `mapKind=tileset`; mantém bloqueio da sessão, evento, revisão e sinal após commit. Ocultar substitui o mapa pelo cenário cartográfico oficial `valley`. Apenas mestre e membros podem acessar a campanha. O endpoint de bytes libera mapa ao jogador somente enquanto estiver selecionado em uma sessão ativa; retirar visibilidade encerra novas leituras. Bytes já entregues ao navegador não podem ser revogados. Editar ou excluir mapa em uso recebe 409: o mestre oculta, configura e mostra novamente. Gestão bloqueia sessão antes da campanha, na mesma ordem do encerramento de one-shots; reconfere a sessão ativa para rejeitar abertura concorrente sem inverter os bloqueios. Encerramento remove acesso do jogador; excluir campanha remove textos, pastas e bytes em cascata.

## Contratos

Todas as rotas abaixo começam em `/api/campaigns/{campaignId}/assets`, exigem Verified, principal autenticado e autorização pelo vínculo. Escritas reutilizam antiforgery comum e js/api.js. Campos não relacionados ao contrato não conferem autoridade.

| Método/caminho | Entrada e resultado |
| --- | --- |
| GET `/library?page=1` | Mestre vê todos; jogador vê publicados. `{items,total,page,pageSize,systemId}`; item `{id,campaignId,title,text,published,revision,updatedAt}`. |
| POST `/library` | Mestre; `{title,text,published}`. Retorna item criado. |
| PUT `/library/{id}` | Mestre; `{title,text,published,revision}`. Retorna item, incrementa revisão; 409 obsoleto. |
| DELETE `/library/{id}` | Mestre; 204. |
| GET `/maps?folderId=&page=1` | Mestre; `{folders,items,total,page,pageSize,maxBytes}`. Pastas limitadas a 100; mapas paginados na pasta. |
| POST `/folders` | Mestre; `{name,parentId:guid|null}`. Retorna pasta. |
| PUT `/folders/{id}` | Mestre; `{name}` (1–100 caracteres, texto limpo). Renomeia sob o bloqueio da campanha sem mudar pai nem conteúdo. Retorna pasta; 400 nome inválido, 403 jogador, 404 fora da campanha. |
| DELETE `/folders/{id}` | Mestre; 204, 409 se houver mapa/subpasta. |
| POST `/maps` | Mestre; multipart único `file`, `name`, `folderId` opcional, `gridPixels`, `scaleMeters` decimal com ponto. Requisição até 10 MiB + 64 KiB; arquivo até 10 MiB. Limitador upload. Retorna mapa sem bytes. |
| PUT `/maps/{id}` | Mestre; `{name,folderId,gridPixels,scaleMeters,revision}`. Atualiza metadados e organização sem reenviar a imagem. |
| DELETE `/maps/{id}` | Mestre; 204; 409 se mapa selecionado em sessão ativa. |
| GET `/maps/{id}/image` | Mestre ou membro enquanto selecionado em sessão ativa; JPEG privado `no-store` e `nosniff`; 404 sem acesso. |

Mapa projetado: `{id,name,folderId,gridPixels,scaleMeters,pixelWidth,pixelHeight,width,height,revision,imageUrl,key,kind:"tileset",description,rows}`. `width/height` são dimensões em casas, `pixelWidth/pixelHeight` são pixels da imagem normalizada; `rows` contém `S` nas entradas e `.` nas demais casas. Servidor e canvas usam a mesma grade gerada. O estado live mantém esses campos para renderizar imagem de fundo, grade, alcance e marcadores com a escala correta. Resolver, listar e servir mapas sempre restringe por CampaignId. Pastas de outra campanha são recusadas. Listar pastas, editar ou solicitar bytes nunca aceita papel enviado pelo navegador.

Erros usuais: 400 campos/parser/dimensões; 403 membro tentando gestão; 404 inexistente ou sem vínculo; 409 revisão/limites/estado; 413 tamanho; 415 formato; 422 scanner recusou; 429 limite de uploads/normalizações; 503 scanner indisponível. A interface apresenta carregamento, vazio, erro, rascunho/publicado e formulários com labels e foco; upload não é repetido automaticamente.

## Validação

`CampaignAssetsTests` cobre rascunho/publicação, autoria autorizada, revisão, ausência de vínculo, hierarquia, pasta não vazia, bytes antes/durante/depois da sessão, cascata e rejeição de imagens falsas/excessivas (seis testes SQLite aprovados). `node tests/campaign-assets.mjs` passou 73 verificações no PostgreSQL: inclui upload PNG real normalizado para JPEG, autorização de bytes, grade/escala live, corrida entre seleção e exclusão e encerramento de one-shot com árvore de pastas e bytes eliminados. Essa integração usa a exceção explícita de scanner no desenvolvimento; saúde/assinaturas do ClamAV de produção continuam externas. Não se declara carga medida nem moderação semântica de mapas.
