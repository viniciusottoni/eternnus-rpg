# Ondas A/B — implementação concluída

Concluído em 7 de novembro de 2026, no Windows, com .NET SDK 10.0.303 e PostgreSQL 17.11. A publicação de produção é uma etapa externa descrita em HOSPEDAGEM.md.

- [x] Bundle original verificado e preservado em continuacao-plataforma.
- [x] Master, editor (wa) e Guilda/fórmulas (wb) consolidados; código e artes locais preservados.
- [x] Onda A: painel, papéis/sistemas/auditoria, suporte, biblioteca, editor visual/PDF, fórmulas, Guilda e progressão integrados.
- [x] Onda B: ficha por modelo, criação na campanha, escolha de modelo pelo mestre, preenchimento sobre PDF e formulário acessível, histórico, migração com prévia, ações na mesa e PDF preenchido.
- [x] Correções: multipart real de PDF, erros estruturados, comparação de defaults ao publicar, ações/modelo no live e resumo correto da ficha, GET de perfil sem escrita, limites exatos de upload.
- [x] Verificação local: build sem avisos/erros; 577 testes .NET; 72 frontend; nove suítes PostgreSQL com 1.475 verificações; migração de dados antigos e reaplicação idempotente; 37 checks HTTP na publicação Release; 53 arquivos públicos do precache presentes.
- [x] QA visual desktop e celular, exportações renderizadas/inspecionadas e revisão dos controles de segurança.
- [x] Ajuste solicitado depois da bateria: conteúdo dos campos à esquerda na ficha, mesa e PDF; conferência pontual, sem repetir todas as suítes. Cache público v11 e pacote atualizados.
- [x] Documentação, SQL e pacote Windows/IIS consolidados.

## Entrega local

- `artifacts/EternnusRPG-Ondas-A-B-IIS.zip`: conteúdo completo da publicação framework-dependent ASP.NET Core 10 para Windows/IIS, sem configuração privada, App_Data ou e-mails.
- `artifacts/postgres-ondas-ab.sql`: migrações PostgreSQL idempotentes desta versão, incluindo PlatformFoundation. Revisar e aplicar com backup pelo procedimento de HOSPEDAGEM.md.
- `artifacts/eternnus-ondas-ab-concluidas.bundle`: código integrado e histórico recuperável; não é banco/backup de dados.
- `artifacts/ENTREGA-ONDAS-A-B.md` e `artifacts/SHA256SUMS.txt`: relatório e integridade dos arquivos.
- `artifacts/qa/`: evidências sintéticas de interface e PDFs; `artifacts/test-results/ondas-ab.trx` e `artifacts/onda-ab-*.log`: resultados locais.

O backup anterior à integração é artifacts/antes-ondas-ab.zip. O bundle de origem permanece em continuacao-plataforma/eternnus-plataforma.bundle. A recuperação usou um repositório auxiliar dentro de artifacts; não fez commit nem alterou o índice do Git raiz do usuário. A regra local de .gitignore foi preservada.

## Limites externos

Não foi feita publicação em produção. Ainda é necessário configurar e validar no destino: Hosting Bundle/IIS e HTTPS, conexão/banco/chaves persistentes, SMTP/TLS, ClientId/ClientSecret e callbacks Google/Discord, clamd privado atualizado e Azure AI Content Safety. Upload de avatar continua bloqueado se antivírus/moderação estiverem indisponíveis; documentos também exigem scanner em produção. Não há garantia de detectar toda ameaça.

Instalação em Android/iPhone físico e teste de carga não foram executados. A viewport móvel do navegador não equivale a aparelho. Ver TESTES.md, PLATAFORMA.md e SEGURANCA_OPERACAO.md para escopo e evidências. Esses limites não representam funcionalidade pendente da integração local.
