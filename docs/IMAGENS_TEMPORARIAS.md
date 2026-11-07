# Apresentação temporária de imagens

O mestre escolhe JPEG/PNG de até 5 MiB na mesa. O navegador decodifica, limita a 8.192 px por lado/32 milhões de pixels e reconstrói JPEG de até 2.560 px no maior lado. Bytes ficam nos navegadores e trafegam em canal WebRTC ordenado, em blocos de 16 KiB, com controle de buffer e teto de recebimento de 5 MiB. Não há endpoint de upload, arquivo temporário, banco, log ou cache de servidor contendo a imagem. Capturas feitas pelos jogadores não podem ser impedidas ou revogadas.

O banco persiste somente identificador/título da apresentação atual, através de SessionService: bloqueio da sessão, validação do mestre/presença, evento, revisão e sinal após commit. O roteador descarta WebSocket, peers, timers e URLs de objeto ao sair; retirar a imagem ou encerrar a sessão limpa a apresentação nos clientes. Se o mestre recarregar/fechar a aba, precisará selecionar novamente o arquivo. Participantes novos pedem transmissão à aba do mestre.

WebSocket transmite somente sinalização SDP/ICE, com cookie, política Verified, Origin exata, autorização de campanha/presença reaplicada em cada mensagem e remetente obtido do principal. O relay em memória contém conexões e locks de transporte, sem autoridade sobre a mesa. Até duas conexões por usuário, mensagens de até 32 KiB e 120/min por conexão. Sinais do jogador só vão ao mestre; somente mestre oferece imagens. Sinais usam o identificador persistido atual. GET do socket não escreve no banco.

## API

Todas as rotas usam `/api/sessions/{sessionId}/temporary-image`:

| Método/caminho | Contrato |
| --- | --- |
| POST raiz | Mestre presente; `{title}` com 1–120 caracteres. Retorna `{id,title}`. CSRF comum. |
| DELETE raiz | Mestre; retira apresentação, evento/revisão; 204. CSRF comum. |
| GET `/ice` | Membro autorizado; `{iceServers:[{urls:[],username?,credential?}]}`. Resposta no-store. |
| GET `/signal` | Upgrade WebSocket, cookie/Origin e presença exigidos. Envelopes `{kind,toPeer?,imageId?,payload?}`; kind ready/offer/answer/ice. Servidor determina from (usuário) e peerId (conexão). toPeer evita misturar negociações entre abas; to por usuário permanece compatível. |

`GET /live` inclui `session.temporaryImageId` e `session.temporaryImageTitle`. Encerrada a sessão, comandos retornam 409 e o relay recusa novas conexões. Sem vínculo retorna 404. Nenhum conteúdo dessa funcionalidade pertence ao cache da PWA.

## Operação

Conexões diretas funcionam quando a rede permite. Para redes com NAT/firewall restritivos, configurar `WebRtc:IceServers` com STUN/TURN da operação, idealmente credenciais TURN temporárias e região/quotas adequadas. TURN retransmite tráfego cifrado; avaliar o serviço escolhido e seus termos. Sem TURN não se promete conectividade entre quaisquer redes. Não há servidor público externo fixado no código.

O relay atual funciona em um processo. Distribuir a aplicação exige transporte compartilhado/afinidade explícita de WebSocket, além da infraestrutura de sessões já documentada; o banco continua autoritativo. HTTPS/WSS e configuração coerente do proxy são necessários em produção. Chaves de serviços ficam em configuração privada, nunca em assets. Configurações ICE entregues ao navegador devem usar credenciais próprias para clientes, com prazo/quotas adequados.
