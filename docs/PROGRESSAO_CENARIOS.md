# Jornada e atlas do Eternnus

## Direção

A progressão reconhece histórias compartilhadas, criação e colaboração. Não exige login diário, sequência de dias, horário específico, gasto ou disputa no ranking. Ausência não remove XP. O nível da conta não modifica atributos de personagens nem concede vantagem na mesa.

Jogar e responder na Guilda continuam disponíveis desde o nível 1, com conta verificada e acesso ao recurso. Categorias específicas podem exigir nível para abrir tópicos. As quotas de `CONTAS_MESAS_LIVRES.md` continuam independentes da gamificação: três campanhas persistentes e dez participações vitalícias em one-shots para contas comuns. Não apresentar esses limites como metas de XP ou benefícios de nível.

## Recompensas

| Atividade | XP por lançamento | Máximo de lançamentos por dia UTC |
| --- | ---: | ---: |
| Conduzir uma sessão elegível | 60 | 4 |
| Jogar uma sessão elegível | 50 | 4 |
| Criar campanha | 20 | 2 |
| Entrar em campanha | 15 | 3 |
| Criar personagem | 10 | 3 |
| Abrir tópico | 8 | 3 |
| Receber marcação de útil | 6 | 5 |
| Responder na Guilda | 4 | 5 |
| Suporte | 0 | Não concede XP |

O teto de recompensa não impede a atividade nem apaga ganhos anteriores. Os valores novos aplicam-se somente aos próximos lançamentos; o histórico não é reprecificado. O bônus administrativo continua limitado a −500…500, com motivo e auditoria; a redução nunca deixa o total negativo.

Uma sessão elegível dura ao menos dez minutos. O jogador tem ficha associada e sua primeira entrada ocorreu ao menos dez minutos antes do encerramento. Não se exige permanência até o último instante, mensagens, rolagens nem número de cliques. O mestre recebe quando existe ao menos um jogador elegível; preparar uma mesa sozinho não gera XP de sessão. O critério de tempo é uma janela entre entrada e encerramento, não medição de minutos ativos: não certifica presença humana contínua nem elimina conluio entre contas.

Encerrar uma one-shot, inclusive sair explicitamente como mestre, concede o XP elegível na transação de fechamento, antes do cascade. XP e conquistas sobrevivem à exclusão dos dados temporários. Expiração automática/coleta não concede XP de sessão. Duração máxima e política de presença das one-shots permanecem iguais.

## Conquistas e progresso

O catálogo passa de 13 para 21 conquistas. Novos marcos: três, cinco, 25 e 50 sessões somando os dois papéis; jogar e mestrar; experimentar três tipos de atividade; receber a primeira e a quinta marcação de útil. Os marcos anteriores permanecem com suas chaves.

Contadores usam lançamentos de XP concedidos, incluindo o histórico anterior. Atividades além dos tetos não aumentam contadores; a interface explica essa regra. Bônus e suporte não contam como diversidade. Conquistas gravadas permanecem reconhecidas após ajustes administrativos de XP.

`GET /progress/me` projeta também os marcos novos já alcançados pelo histórico, sem gravar. Nesse caso `unlockedAt` pode ser nulo: a interface informa “trajetória reconhecida”, sem inventar data. Uma nova concessão ou um recálculo autorizado persiste os marcos elegíveis. O cartão público usa a mesma regra de reconhecimento, sem revelar contadores, histórico ou e-mail.

A curva permanece `50 × (n−1) × n`, até o nível 100. A tela mostra progresso por conquista e até três sugestões de caminhos distintos, priorizando a proporção já concluída. São sugestões opcionais sem prazo, bônus diário ou obrigação de completar o catálogo. O ranking fica em uma aba secundária.

Idempotência por origem, transações existentes e autorização continuam no servidor. A limitação preexistente de concorrência de `ProgressionService` permanece: concessões distintas simultâneas podem perder um incremento do resumo da conta ou ultrapassar um teto diário; o lançamento persistido é a fonte de verdade e o recálculo administrativo reconstrói o resumo. Esta entrega não certifica tetos estritos sob concorrência nem detecção de fraude. Não foi alterado o esquema do banco.

## Atlas oficial

| Chave | Cenário | Uso sugerido |
| --- | --- | --- |
| `valley` | Vale Dourado | Cartografia e referência de regiões; mantém a arte oficial |
| `crypt` | Ruínas da Cripta | Salões e corredores; grade retangular corrigida |
| `forest` | Clareira do Riacho | Acampamento, trilha e travessia sobre o riacho |
| `tavern` | Salão da Estalagem | Conversas, salas reservadas e combate com cobertura |
| `bridge` | Ponte da Travessia | Escoltas e encontros entre duas margens |
| `courtyard` | Pátio da Fortaleza | Praça, jardins, fonte e caminhos alternativos |
| `harbor` | Cais das Marés | Armazém, carga e três ancoradouros fluviais ou costeiros |
| `sanctuary` | Santuário de Pedra | Templo, ruína ou salão cerimonial sem divindade imposta |
| `mountain` | Passo da Montanha | Neve, pinheiros e travessias entre rochas |
| `savanna` | Savana dos Ventos | Capim seco, acácias e acampamento |
| `desert` | Deserto das Dunas | Areia, cactos, palmeiras e oásis |
| `dense-forest` | Floresta Densa | Mata rasteira, árvores e caminhos entre clareiras |
| `tomb` | Tumba dos Ancestrais | Câmaras funerárias, sarcófagos e altares |
| `graveyard` | Cemitério das Brumas | Lápides, cercas e mausoléu |
| `castle` | Castelo da Coroa | Muralhas, corredores e salão do trono |
| `cave` | Caverna dos Cristais | Galerias, estalagmites e cristais |
| `volcano` | Vulcão da Cinza | Basalto, lava e passagens de pedra |
| `underwater` | Ruínas Debaixo d’Água | Fundo submerso, corais, algas e ruínas |
| `village` | Aldeia do Vale | Casas, caminhos, cercas e poço |
| `city` | Cidade das Arcadas | Ruas calçadas, quarteirões e mercado |

O atlas tem vinte cenários: dezenove mapas táticos e o Vale Dourado cartográfico. Os doze cenários da ADR-078 têm 28 × 20 ou 32 × 22 casas; os anteriores conservam suas grades. Mapas táticos têm pelo menos seis pontos de entrada e não impõem facção, sistema, nível, criaturas nem resultados de encontro. Todas as áreas caminháveis oficiais se conectam por movimentos ortogonais. Cenários existentes preservam identificadores e coordenadas de entrada.

Fonte única das grades: `Domain/BattleMaps.cs`; as 44 peças estão em `Domain/MapTiles.cs`, com terreno, grupo, passagem e bloqueio de visão. O cliente usa a mesma legenda. Textura e iluminação não inventam obstáculos ou permissões. Miniaturas, editor e mesa desenham a mesma grade; o Vale Dourado continua cartográfico. O Mestre pode criar mapas próprios vazios ou copiar cenários táticos no acervo, sem depender dos mapas prontos (ADR-078).

O atlas aparece em Mapas e cenários, junto do acervo privado existente. A escolha ao abrir sessão ou trocar mapa reutiliza `map-picker.js`, com busca sem acentos, miniatura real, dimensões e rádio acessível. Buscar preserva a seleção atual visível. A troca continua removendo criaturas e reposicionando personagens conforme o contrato anterior.

## Movimento e interface

Acabamento compartilhado em títulos, separadores, foco, campos, mensagens, tabelas, modais e estados vazios. Texto secundário usa contraste reforçado; campos móveis usam 16 px e controles principais mantêm ao menos 44 px. Navegação inferior e área segura são preservadas.

Luzes variam lentamente, a água acompanha a grade, e marcadores interpolam por 180 ms apenas na apresentação; o estado autorizado muda imediatamente. A troca de mapa usa uma transição curta de 320 ms sem apagar ou desfocar o tabuleiro. O canvas limita efeitos a 20 quadros/s, cancela o agendamento em aba oculta e remove listeners no descarte. CSS também pausa animações em aba oculta. Movimento reduzido remove interpolação e animações, mantendo foco, dados e comandos. A abertura continua em 3.000 ms, sem atrasos adicionados a operações. Os controles de imagem temporária ficam em um expansor para liberar espaço da mesa, especialmente no celular.

Cache público v19: código estático do seletor e arquivos compartilhados revisados; nenhuma resposta de progressão, perfil, mapa privado ou sessão entra no cache. Atualização sem `skipWaiting` ou recarga forçada.
