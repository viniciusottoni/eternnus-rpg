# Shinigamis & Hollows — mapeamento da ficha em branco (PDF comum)

- **Sistema:** Shinigamis & Hollows, id `92df15a1-907f-4abc-bdf2-06e4cf313f38`
- **Modelo:** Ficha oficial Shinigamis & Hollows, id `324b10f4-ed1f-4366-9a36-c4c69dd40332`, versão `d613ab5e-8dbc-4e39-b7f7-e45e2420aba4`, **v1 publicada** e **padrão do sistema**
- **PDF:** `Shinigamis e Hollows - Ficha em Branco.pdf` (6 páginas Carta de 612 × 792 pt), sha256 `d7a5ea40b7157c1d096becf19ce73cd6524d200b900af05f9d8f44479e86d6bd`
- **Conteúdo:** 299 campos (o limite é 300) e 26 ações, 54.379 bytes. O formato é o mesmo do editor (compactDoc); sha256 do documento `9748d82c65b0a97c08dff3fafde03b959d82a17d269f881fc7f4f32c633e34b2`.
- **Arquivos:** `gerar-mapeamento.js` (gerador), `shinigamis-e-hollows-ficha-v1.json` (documento aplicado) e `previa-exportacao.png` (simulação das páginas 1 a 5).

## Página 1 — ficha de shinigami

- **Cabeçalho:** nome (papel *nome*), jogador, origem, divisão, classe, nível (papel *nível*, padrão 1) e bônus.
- **Atributos:** FOR, INT, DES, SAB, CON e CAR. **Níveis em caminhos:** Zanjutsu, Hakuda, Hoho e Kido.
- **Pontos de vida:** máximos (papel *PV máx.*), atuais (papel *PV*) e temporários. **Pontos de reiryoku:** máximos, atuais e temporários.
- **Esquiva:** total calculado (papel *armadura*) = 10 + DES + armadura + escudo + nível + outros; as cinco parcelas são digitadas nas caixinhas.
- **Salvaguardas:** Fortitude, Reflexos e Vontade.
- **Deslocamento:** caminhada (papel *movimento*), escalada e voo.
- **Percepção e sentidos** (texto), **classes de dificuldade** (classe, conjuração, manejo), **dureza** e **resistências/imunidades**.
- **Perícias (23):** cada uma com as caixas **T** (treinada) e **E** (especialista) e o **Total**. Percepção tem o papel *percepção*. Conhecimento 1–3 e Ofício 1–2 são as linhas sem nome; o tipo vai no próprio total ou nas anotações.

## Páginas 2 a 5

- **Inventário (página 2):** duas tabelas de 24 linhas, com peso carregado e peso máximo.
- **Perfil espiritual (página 3):** zanpakuto, forma selada, shikai e bankai (nome, forma e funcionamento em texto corrido), aptidões espirituais e kidos conhecidos.
- **Técnicas de manejo (página 4) e Kido (página 5):** 20 cartões cada, com nome, nível, conjuração e descrição.

## Listas (ADR-098)

No preenchimento, cada lista tem uma caixa por linha, e cada item tem descrição própria.

- **Habilidades de classe e talentos** (18 linhas).
- **Ataques** (6 linhas): bônus, dano, crítico, tipo, alcance e traços são colunas, uma linha por arma, sem descrição própria.
- **Treinamentos** (3 linhas).
- **Inventário 1 e 2** (24 linhas cada): quantidade, peso e valor são colunas.
- **Aptidões espirituais** e **Kidos conhecidos** (18 linhas cada).

Texto corrido: percepção e sentidos, funcionamento de shikai/bankai e as descrições dos cartões.

## Ações

- **Salvaguardas (3):** 1d20 + Fortitude, Reflexos ou Vontade.
- **Perícias (23):** 1d20 + total da perícia.

## Limitações

- **Limite de 300 campos:**
  - a coluna "Outros" das perícias não foi mapeada; some o bônus direto no Total;
  - nos cartões de técnica e kido, alcance, alvo e duração não têm campo próprio e vão no começo da descrição.
- A página 6 só tem as notas do autor da ficha e não foi mapeada.
- As caixas de PV e reiryoku não são calculadas, porque a ficha é genérica quanto à classe.
- O Total das perícias é digitado (a ficha não indica qual atributo cada perícia usa).

## Verificação (19/11/2026)

- Os hashes do documento e do PDF foram conferidos antes do envio. Os campos e as ações no servidor batem 100% com o gerador.
- **Exportação real no site** (DES 2 na esquiva, armadura 1, nível 2):
  - Esquiva 15;
  - os textos caíram nas caixas e nas linhas, e as marcas T/E nas caixinhas;
  - os itens longos de lista terminaram em "…".
- **"Testar ficha"** com valores altos (PV 999, PV −12, nível 20, Total −12/+15, deslocamento 120, nível de kido 99):
  - nenhum número foi cortado;
  - as 19 listas e colunas mostram uma caixa por linha;
  - só um nome de 30 caracteres não coube na caixa do Nome, que é estreita na ficha impressa; nomes comuns cabem.
