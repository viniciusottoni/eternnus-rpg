# Ficha-modelo Fabula Ultima — mapeamento do PDF

**Publicada em produção em 10/11/2026** — rpg.eternnus.com:
- Sistema criado: **Fabula Ultima** (`989b63ab-0224-4313-927c-14fa69ea7d4a`, slug `fabula-ultima`).
- Ficha-modelo **"Ficha oficial Fabula Ultima"** (`3ae3de18-c8d8-4e6d-8842-5d36e1731f9b`, v1 `ebcde55a-d1db-419a-9ba9-0de19d6befc2`), **padrão do sistema**.
- PDF de fundo: `Fabula Ultima - Ficha em Branco.pdf` (3 páginas A4 paisagem, sha256 `b540a6de…4592`).

`fabula-ultima-ficha-v1.json` é o corpo exato do `PUT` do editor (222 campos, 11 ações), gerado por `gerar-mapeamento.js`.
Validado com as regras do editor e exportado pelo `filled-pdf.js` do site; rolagem conferida ([INT + VON] com Confuso → 1d8 + 1d10).

## Papéis ligados à mesa
Nome `nome` · Nível `nivel` · PV `pv_atual` / `pv_max` · Armadura `defesa`.

## Regras calculadas
| Campo | Fórmula |
|---|---|
| `<atributo>_atual` | dado base reduzido um passo (−2) por condição: Lento/Enfurecido (DES), Confuso/Enfurecido (INT), Fraco/Envenenado (VIG), Abalado/Envenenado (VON); mínimo d6 |
| `pv_max` | 5 × Vigor base + nível + outros |
| `pv_crise` | metade dos PV máximos |
| `pm_max` | 5 × Vontade base + nível + outros |
| `pi_max` | 6 + outros |
| ações | Iniciativa [DES + INT] + modificador e os 10 testes de dois atributos, usando o dado atual |

Os dados aparecem como número (6, 8, 10, 12). O bônus "outros" de PV/PM/PI fica em letra pequena logo acima de "OUTROS" na própria linha.

## Organização
1. Nome, pronomes, identidade, tema, origem; 6 laços (com quem + 6 sentimentos); Pontos Fabula; XP; iniciativa, defesa e defesa mágica;
   "pode equipar"; 4 itens equipados com descrição; mochila; zênite; atributos e condições; PV/PM/PI; nível; 3 classes.
2. Nome; 4 outras classes; habilidades heróicas; 6 feitiços; disciplinas de ritual.
3. Nome; 13 feitiços; disciplinas de ritual.

## Limitações conhecidas
- Defesa e defesa mágica são digitadas (dependem da armadura/escudo).
- Os nomes das páginas 2 e 3 são campos próprios.
- O quadro de imagem do personagem (página 1) não foi mapeado.
