# Fichas compartilhadas e auditoria de sessão

Uma ficha pertence ao jogador. O dono e os mestres das campanhas às quais ela está vinculada podem editá-la; participantes podem ler a ficha compartilhada. `private=true` restringe leitura ao dono e ao mestre. A restrição é aplicada também às projeções da campanha e ao estado ao vivo: participantes sem leitura não recebem vida ou nível da ficha privada.

`POST /api/characters`, `PUT /api/characters/{id}` e `PUT /api/characters/{id}/sheet` aceitam `private` opcional. Ausente na criação significa compartilhada; ausente na edição preserva a escolha atual. Somente o dono escolhe a visibilidade; o mestre tentando mudá-la recebe 403. `GET /api/characters/{id}/sheet` inclui `private`, `canEdit` e `canChangeVisibility`. A leitura autorizada da sessão inclui os mesmos indicadores. O mestre pode abrir o editor completo pela mesa; a autorização continua no banco.

Escritas clássicas, por modelo, de ações, de visibilidade e migrações passam por `SessionService.WriteCharacterAsync`. Uma transação bloqueia em ordem as sessões ativas relacionadas à ficha, valida permissão e revisão, grava ficha, versão e histórico por campo, incrementa revisões das sessões e publica sinais somente após commit. O ajuste de vida segue o mesmo contrato transacional na sessão explícita. Revisão antiga responde 409, sem alteração parcial.

`CharacterVersion.ChangedById` identifica o ator e `SessionId` identifica a sessão ativa principal (primeiro GUID em ordem estável), quando existe. Todos os contextos ativos recebem evento privado e histórico por campo com o respectivo `SessionId`, inclusive quando uma ficha participa de mais de uma campanha. Sem sessão ativa, a auditoria continua identificando o ator com sessão nula. Snapshots preservam a ficha completa, incluindo alterações em ações sem mudança na quantidade de ações. Textos longos de histórico por campo têm o limite existente de 2.000 caracteres; o snapshot preserva o estado completo.

Eventos `sheet` são privados independentemente de a ficha ser compartilhada. `MasterOnly=true` e `VisibleToUserId=dono` permitem leitura somente ao mestre daquela sessão e ao dono. Eventos antigos de ficha também são ocultados aos demais jogadores. Notas privadas continuam exclusivas do mestre.

`GET /api/characters/{id}/field-history` e `/history` exigem dono ou mestre vinculado. O dono consulta todo o histórico; o mestre consulta registros de sessões das campanhas que mestra. Outros participantes recebem 404. A lista geral de sessões e o histórico completo da sessão permanecem exclusivos do mestre; o jogador consulta o histórico da própria ficha no editor.

One-shots: o início registra presença do mestre; join e heartbeat renovam a data no banco dentro da transação. Sair ou encerrar como mestre remove campanha e dependências, preservando a ficha pessoal. Acesso a mesa expirada ou sem presença do mestre pelo prazo definido em `OneShotLifecycleService` responde 410 até a limpeza em segundo plano concluir.

Entrada e vínculo manual conferem o sistema da versão do modelo da ficha. Fichas de outro sistema recebem 400 e não criam presença ou vínculo. O fallback livre permanece permitido quando a campanha não escolheu modelo e o sistema não possui modelo padrão ativo e publicado; a seleção da mesa apresenta somente fichas elegíveis.
