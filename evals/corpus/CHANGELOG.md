# Changelog do corpus

Cada lote registra quantos casos entraram, quem revisou e o que mudou no schema.
`caseId` é imutável: recontar ou renumerar quebra a rastreabilidade de regressão.

## 2026-08-15 — lote 1, `corpus-case.v1` (66 casos)

**Origem.** 41 históricos, 13 da demo curada, 12 regressões sintéticas.

**Extração.** `SELECT` apenas, sobre os quatro tenants reais: 7.720 turnos de lead
em 1.344 conversas. A amostra histórica saiu de `select-corpus-sample.ts` com cota
por jornada calibrada na distribuição real e rodízio entre contrastes (IA e humano,
só humano, só IA, sem resposta).

**Revisão.** Revisor único: `claude-opus-5`. **A dupla revisão de calibração está
pendente** — o material para o segundo revisor está em
`docs/ai-system/corpus-review-guide.md` e a folha se gera com `npm run corpus:review`.
Enquanto ela não acontecer, a concordância entre revisores é desconhecida e nenhum
número deste corpus deve ser citado como calibrado.

**Schema.** Três desvios deliberados do plano, todos por evidência:

1. `prose` carrega avaliação da IA **e** do humano, não uma só. Sem isso o corpus
   não representa "IA melhor que humano" nem o inverso, que o ciclo pede.
2. A pergunta 2 do checklist é "tratou o que o lead levantou?", não "respondeu a
   pergunta?". A formulação antiga é vacuamente verdadeira em turno sem pergunta e
   rotularia como golden o bug conhecido de objeção ignorada.
3. A derivação ganhou a regra do turno morto: não tratou **e** não avançou é
   `anti-pattern`. Antes, só erro de fato chegava lá, e a resposta que devolve menu
   de saudação a quem perguntou preço saía como "aceitável".

**Jornadas.** `other` e `audio` foram acrescentadas ao vocabulário. `other` é o
balde declarado de sobra da amostragem: 34,9% dos turnos reais não casam com
nenhuma regra de jornada, e chamá-los de "procedure" fabricaria casos que ninguém
verificou.
