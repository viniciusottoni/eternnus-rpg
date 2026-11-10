# Ficha-modelo 3DeT Victory — mapeamento do PDF

**Publicada em produção em 10/11/2026** — rpg.eternnus.com:
- Sistema criado: **3DeT Victory** (`5bc8c5ca-a5c8-47b6-b62e-c0cc2e2a40d8`, slug `3det-victory`).
- Ficha-modelo **"Ficha oficial 3DeT Victory"** (`6bc6329c-3934-47c0-b569-b91f1ee31ba9`, v1 `f8bb7766-2df2-4c44-b3cc-4d4713a2d5b5`), **padrão do sistema**.
- PDF de fundo: `3DeT Victory - Ficha em Branco.pdf` (1 página, 453,6 × 652,08 pt, colorido, sha256 `1b790fc9…555f`).

`3det-victory-ficha-v1.json` é o corpo exato do `PUT` do editor (77 campos, sem ações), gerado por `gerar-mapeamento.js`.
Validado com as regras do editor e exportado pelo `filled-pdf.js` do site.

## Papéis ligados à mesa
Nome `nome` · PV `pv_atual` / `pv_max`.

## Regras calculadas
| Campo | Fórmula |
|---|---|
| `pa_max` | Poder (mín. 1) |
| `pm_max` | 5 × Habilidade (mín. 1) |
| `pv_max` | 5 × Resistência (mín. 1) |

## Campos
Cabeçalho (nome, pontos, XP, arquétipo, conceito, escala); P, H, R; PA/PM/PV máximos e atuais; 12 perícias (caixas ao lado dos nomes);
FA e FD (atributo, caixa no dado de Luta, número de dados de ganho); 10 vantagens, 8 desvantagens, 6 técnicas, 10 itens (um campo por linha);
11 espaços de itens (comuns, incomuns, raro).

## Limitações conhecidas
- Sem testes predefinidos: a rolagem do Victory (vários d6, críticos que somam o atributo de novo) não cabe na linguagem de fórmulas;
  os jogadores podem criar suas próprias ações na ficha.
- O valor do atributo de FA/FD fica sobre o texto cinza "Atributo" impresso no quadro.
- O PDF usa uma fonte com mapa CJK que o pdf.js do site não carrega (aviso no console); nada visível da ficha é afetado.
