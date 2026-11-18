# Fichas compartilhadas e auditoria de sessão

Uma ficha pertence ao jogador. O dono e os mestres das campanhas às quais ela está vinculada podem editá-la; participantes podem ler a ficha compartilhada. `private=true` restringe leitura ao dono e ao mestre. A restrição é aplicada também às projeções da campanha e ao estado ao vivo: participantes sem leitura não recebem vida ou nível da ficha privada.

`POST /api/characters`, `PUT /api/characters/{id}` e `PUT /api/characters/{id}/sheet` aceitam `private` opcional. Ausente na criação significa compartilhada; ausente na edição preserva a escolha atual. Somente o dono escolhe a visibilidade; o mestre tentando mudá-la recebe 403. `GET /api/characters/{id}/sheet` inclui `private`, `canEdit` e `canChangeVisibility`. A leitura autorizada da sessão inclui os mesmos indicadores. O mestre pode abrir o editor completo pela mesa; a autorização continua no banco.

Escritas clássicas, por modelo, de ações, de visibilidade e migrações passam por `SessionService.WriteCharacterAsync`. Uma transação bloqueia em ordem as sessões ativas relacionadas à ficha, valida permissão e revisão, grava ficha, versão e histórico por campo, incrementa revisões das sessões e publica sinais somente após commit. O ajuste de vida segue o mesmo contrato transacional na sessão explícita. Revisão antiga responde 409, sem alteração parcial.

`CharacterVersion.ChangedById` identifica o ator e `SessionId` identifica a sessão ativa principal (primeiro GUID em ordem estável), quando existe. Todos os contextos ativos recebem evento privado e histórico por campo com o respectivo `SessionId`, inclusive quando uma ficha participa de mais de uma campanha. Sem sessão ativa, a auditoria continua identificando o ator com sessão nula. Snapshots preservam a ficha completa, incluindo alterações em ações sem mudança na quantidade de ações. Textos longos de histórico por campo têm o limite existente de 2.000 caracteres; o snapshot preserva o estado completo.

Eventos `sheet` são privados independentemente de a ficha ser compartilhada. `MasterOnly=true` e `VisibleToUserId=dono` permitem leitura somente ao mestre daquela sessão e ao dono. Eventos antigos de ficha também são ocultados aos demais jogadores. Notas privadas continuam exclusivas do mestre.

`GET /api/characters/{id}/field-history` e `/history` exigem dono ou mestre vinculado. O dono consulta todo o histórico; o mestre consulta registros de sessões das campanhas que mestra. Outros participantes recebem 404. A lista geral de sessões e o histórico completo da sessão permanecem exclusivos do mestre; o jogador consulta o histórico da própria ficha no editor.

One-shots: o início registra presença do mestre; join e heartbeat renovam a data no banco dentro da transação. Sair ou encerrar como mestre remove campanha e dependências, preservando a ficha pessoal. Acesso a mesa expirada ou sem presença do mestre pelo prazo definido em `OneShotLifecycleService` responde 410 até a limpeza em segundo plano concluir.

Entrada e vínculo manual conferem o sistema da versão do modelo da ficha. Fichas de outro sistema recebem 400 e não criam presença ou vínculo. O fallback livre permanece permitido quando a campanha não escolheu modelo e o sistema não possui modelo padrão ativo e publicado; a seleção da mesa apresenta somente fichas elegíveis.

## Imagem do personagem (ADR-097)

Cada ficha tem no máximo uma imagem (`CharacterPortraits`), mostrada num cartão ao lado do PDF, sem cobrir as páginas. A leitura segue a ficha: dono, mestre das campanhas vinculadas e, quando a ficha é compartilhada, os membros da mesa. Ficha privada esconde a imagem dos demais participantes. Só o dono envia, troca ou remove. A troca não altera `Revision`, não gera histórico de campo e não passa por `SessionService` (não é estado da mesa). Excluir a ficha exclui a imagem.

## Descrições por item (ADR-098)

Descrições de magias, poderes, habilidades e itens ficam em `Character.ItemNotes` e seguem exatamente a leitura e a edição da ficha: quem lê a ficha lê as descrições (inclusive na mesa, só leitura); dono e mestre autorizado editam e gravam com "Salvar ficha", com histórico por item (`@descricao`). Ficha privada esconde as descrições dos demais participantes.

## Ficha em jogo, cópias e restauração (ADR-099)

- **Imagem no marcador:** o marcador do personagem mostra a imagem da ficha só para quem pode ler a ficha (mestre, dono ou participantes quando a ficha é compartilhada). Ficha privada: os demais veem o marcador sem imagem.
- **Rolar e usar:** rolagens com a ficha como escopo e o uso de itens (com custo) exigem o dono jogando com a ficha ou o mestre; o servidor confere a ficha na sessão. O gasto entra no histórico por campo como os demais ajustes da mesa.
- **Condições com duração:** gravadas na ficha; os eventos ficam com o mestre e o dono, como as condições de texto.
- **Visão do grupo:** só o mestre da campanha; mostra fichas privadas da própria campanha (que ele já lê) e nunca e-mails.
- **Duplicar:** só o dono; a cópia não leva histórico nem vínculo com campanhas.
- **Restaurar ao início de uma sessão:** só o dono, que vê o histórico completo; o mestre restaura valor a valor pelas linhas do histórico que já lê. Nada é gravado sem o "Salvar ficha".
- **Rascunho local:** valores não salvos ficam no IndexedDB deste navegador, por usuário e ficha, e são apagados ao sair da conta.
