# Instruções do projeto Eternnus RPG

## Fontes de verdade

Antes de alterar uma funcionalidade, leia `docs/ARQUITETURA.md`, `docs/GUIA_VISUAL.md`, `docs/SEGURANCA_OPERACAO.md` e o contrato correspondente em `docs/API.md`. Registre mudanças de direção em `docs/DECISOES.md`. As instruções explícitas do usuário prevalecem.

## Visual e frontend

- Os quatro arquivos `assets/Mockup - Tela N.png`, o logotipo oficial e `Golden Valley Castle at Sunset.png` são a referência principal. Simplificar ornamentos para preservar leitura e operação; não substituir por uma identidade genérica.
- Reutilizar `js/layout.js`, `js/ui.js`, `js/api.js` e tokens de `styles.css`. Não duplicar menus, modais, tratamento de fetch, campos ou feedback em cada nova tela.
- Usar ES Modules e separar apresentação, chamadas HTTP e regras puras. Carregar funcionalidades de jogo sob demanda.
- Escapar valores de usuário ao compor HTML; preferir `textContent` quando não houver marcação necessária. Nunca interpolar conteúdo não confiável em classes, atributos livres, eventos ou URLs sem validação específica.
- Toda ação deve ter estados de carregamento, erro, vazio e indisponibilidade relevantes. Usar labels, foco visível, navegação por teclado e mensagens acessíveis.
- Movimento deve favorecer o cenário, nunca prejudicar tarefas; respeitar `prefers-reduced-motion`. Não acrescentar atrasos artificiais aos formulários ou às ações de campanha.
- Abertura usa a constante compartilhada de 3.000 ms. Não prolongar o loading para esconder chamadas lentas.
- No celular, preservar a navegação inferior fixa e a área de segurança do dispositivo; alvos de toque principais devem ter ao menos 44 px. Não cobrir conteúdo, formulários ou feedback com a barra.
- Manter os contratos de PWA em `docs/PWA.md`: cache somente de arquivos públicos explicitamente permitidos e shell estático. Nunca cachear API, callbacks OAuth, links com token, e-mails, perfil ou dados autenticados.
- Ao alterar arquivos públicos controlados pelo service worker, atualizar sua versão de cache e revisar a lista permitida. Não forçar `skipWaiting` ou recarregar uma sessão ativa sem uma decisão explícita de atualização compatível.

## Backend e dados

- Manter monólito modular e a separação `Domain`, `Application`, `Features`, `Infrastructure` e composição em `Program.cs`. Preferir a solução simples que cumpra as invariantes; não criar camadas genéricas sem uso concreto.
- Todo endpoint de jogo exige a política `Verified`, além de autorização por proprietário/participante no recurso. O estado visual nunca substitui validação no servidor.
- Obter a identidade do principal autenticado. Não aceitar `OwnerId`, permissões ou confirmação de e-mail vindos do cliente.
- Novas escritas de `/api` devem passar pela proteção antiforgery comum; reutilizar `js/api.js` no cliente. Não criar GET mutável.
- Reutilizar ASP.NET Identity para senhas e tokens. Não criar criptografia própria, bypass de confirmação ou endpoint de leitura de tokens de e-mail.
- Usar PostgreSQL e migrações versionadas. Preservar bancos antigos; nunca apagar dados ou volumes para resolver uma migração.
- Consultas de lista devem ser projetadas, limitadas e paginadas. Propagar cancelamento, usar I/O assíncrono e evitar N+1.
- Operações de participação/exclusão de campanha devem manter o bloqueio transacional comum. Testar corridas quando uma mudança envolver múltiplos registros.
- Não expor mensagens de exceção, consultas SQL, senha, token, connection string ou payload de e-mail em respostas ou logs.

## Sessões e mesa ao vivo

- Uma sessão ativa por campanha (índice filtrado + bloqueio da campanha). Não remover essa invariante para "abrir outra rapidamente".
- Toda escrita da mesa passa por `SessionService`: bloqueia a sessão, confere papel/turno/ficha no banco, grava o evento na mesma transação, incrementa `Revision` e chama `SessionSignals.Pulse` após o commit.
- `GET …/live` é somente leitura. Presença e qualquer outra alteração usam `POST`. Não criar estado autoritativo em memória: o sinal em processo é apenas otimização.
- Jogador não recebe notas privadas, objetivo do mestre, lista de sessões nem histórico alheio. Fichas compartilhadas são legíveis pelos membros da mesa; fichas privadas e histórico de alterações são restritos ao dono/mestre autorizado. Não expor e-mail de participantes.
- Tilesets oficiais vivem em `Domain/BattleMaps.cs` e são validados por teste; o cliente desenha a mesma grade. Animações da mesa respeitam `prefers-reduced-motion` e pausam em aba oculta.
- Telas com recursos contínuos (consulta, heartbeat, animação) devolvem uma função de descarte ao roteador.

## Configuração e validação

- Domínio público de produção: `https://rpg.eternnus.com`. Transporte de e-mail: SMTP com TLS. Segredos ficam em configuração privada; jamais em assets, frontend, exemplos com valores reais ou repositório.
- Modo de coleta local de e-mail é somente de desenvolvimento e fica fora de `wwwroot`.
- Google e Discord exigem e-mail verificado; não fundir automaticamente conta externa com conta local pelo e-mail.
- Antes de concluir: compilar, executar testes apropriados da funcionalidade e verificar a interface quando mudar layout/interação. Não declarar teste executado sem evidência.
- Atualizar documentação e contrato no mesmo trabalho. Descrever limitações externas, como credenciais SMTP/SSO ausentes ou carga não medida, sem prometer invulnerabilidade ou capacidade ilimitada.
