# Contas, limites e one-shots

Contas comuns podem manter três campanhas persistentes, somando propriedade e participação. Todas as campanhas existentes contam; o produto não possui estado separado de arquivamento. Sair/excluir libera vaga. Nível e XP não ampliam limites. Administradores e embaixadores não possuem esses limites; somente administradores alteram papéis pela gestão auditada existente.

One-shots são campanhas com `isOneShot=true`, escolhido somente na criação. Possuem a mesma biblioteca, recursos e acesso de uma campanha. Cada conta comum dispõe de dez participações vitalícias, incluindo mesas criadas como mestre. A criação ou primeira entrada por convite reserva uma participação; sair, excluir ou expirar não devolve a quota. Reentrar na mesma mesa não consome outra. Essa definição torna o limite verificável antes de organizar ou acessar os recursos da mesa. Um recibo mínimo (`UserId`, identificador opaco da mesa) e o contador da conta sobrevivem ao encerramento, sem preservar conteúdo de jogo.

A vida máxima é de 72 horas desde a criação, inclusive a preparação antes da sessão. Após abrir, o mestre precisa manter presença por heartbeat; ausência por 45 segundos fecha a mesa. A página da campanha e o editor de ficha abertos a partir da mesa também mantêm presença do mestre durante a organização, com descarte ao sair da tela. Sair explicitamente da sessão ou encerrá-la exclui a mesa imediatamente. A exclusão em cascata remove sessões, eventos, recursos, mapas e vínculos. Fichas pessoais são preservadas. Desconexões não são detectáveis instantaneamente: a ausência utiliza o mesmo prazo de presença da mesa. Um worker verifica lotes de até 100 mesas a cada dez segundos; acesso à sessão vencida é negado mesmo antes da coleta. Vencimentos ocorridos com o processo desligado são coletados ao iniciar o worker.

Criação/entrada bloqueiam a linha do usuário dentro da transação e conferem conjuntamente as quotas. O bloqueio de campanha permanece nas operações de vínculo/exclusão. A coleta trava a sessão ativa antes da campanha e reconfere presença/prazo depois do bloqueio para não remover uma renovação concorrente.

## Contratos

- `POST /api/campaigns`: acrescenta `isOneShot` opcional, padrão falso. Sistema deve ser uma escolha explícita válida (`rpgSystemId` ou nome conhecido); texto desconhecido/vazio retorna 400. O sistema determina a biblioteca e o modelo padrão; o modelo específico de campanha continua disponível.
- `GET /api/campaigns`: itens incluem `isOneShot` e `expiresAt`; resposta inclui `limits`.
- `GET /api/auth/limits`: autenticado, inclusive conta pendente; `{ unlimited, activeCampaigns, campaignLimit, oneShotParticipations, oneShotLimit }`. Limites nulos representam equipe sem quota. Não grava dados.
- Exceder quota retorna 409 com explicação em português; conta comum em nível alto continua limitada.
- One-shot vencida retorna 410 enquanto aguarda coleta e 404 depois da exclusão.

## Primeiro administrador e autenticador

`Platform:InitialAdmin:Password` é um segredo privado, carregado por user-secrets em desenvolvimento ou configuração secreta na hospedagem. `Platform:InitialAdmin:Email` é opcional; padrão `admin@eternnus.com`. A senha nunca consta no repositório, frontend ou exemplos. Bootstrap cria a conta inicial confirmada e com papel admin somente quando o segredo está configurado e ainda não existe conta com esse e-mail. Nunca redefine senha nem assume uma conta anterior pelo e-mail. A conta criada é auditada. Remova o segredo de bootstrap da hospedagem depois de provisionar; mudanças futuras usam Identity.

Administradores precisam cadastrar e validar TOTP no primeiro acesso por senha/OAuth. Antes da validação só há um cookie temporário de desafio (cinco minutos), sem sessão de aplicação. O desafio está vinculado ao security stamp; recuperação de senha/suspensão o invalida. Login social também passa pelo autenticador. A sessão administrativa exige `TwoFactorEnabled` e `amr=mfa`; a validação por requisição impede usar cookie anterior a uma promoção. O refresh da identidade preserva a prova MFA.

- `POST /api/auth/login`: login comum mantém o contrato anterior. Admin/conta com TOTP retorna `{ requiresTwoFactor:true, setupRequired }`.
- `GET /api/auth/two-factor/setup`: exige desafio temporário. Enquanto não ativado, retorna `{ setupRequired:true, sharedKey, issuer, account }`; não gera ou altera chaves em GET. Depois de ativado retorna apenas `{ setupRequired:false }`. Resposta privada `no-store`.
- `POST /api/auth/two-factor/verify`: CSRF comum, desafio temporário e rate limit auth; `{ code?, recoveryCode? }`. TOTP válido ativa o autenticador quando necessário e emite sessão com prova MFA. Na primeira ativação retorna dez `recoveryCodes`, exibidos uma única vez para cópia privada. Login seguinte retorna `recoveryCodes:null`. Cada código de recuperação é resgatável apenas uma vez. Erro incrementa o bloqueio do Identity, além do limite por IP.

O cadastro usa chave manual compatível com aplicativos TOTP; não depende de serviço externo de QR code. Perda do autenticador é atendida pelos códigos de recuperação. Não existe endpoint público para resetar o segredo do admin; recuperação operacional sem códigos exige procedimento privado na administração da hospedagem. TOTP usa o validador padrão do Identity e sua janela de tolerância; não adiciona armazenamento próprio de criptografia.

Testes: `AccountLimitsTests` cobre limites, papéis, idempotência, coleta em cascata e preservação das fichas. `tests/account-limits.mjs` cobre bootstrap com segredo isolado, desafio/CSRF, TOTP e recuperação, promoção invalidando sessão e corridas reais PostgreSQL de criar/entrar e de reserva de one-shot.

Excluir campanha comum pela lista exige ausência de participantes e de sessão ativa. Com sessão em andamento recebe409, devendo encerrá-la primeiro. Esse caminho evita inverter o bloqueio campanha/sessão durante heartbeat ou coleta; encerrar/sair como mestre de uma one-shot continua removendo a mesa pelo SessionService.
