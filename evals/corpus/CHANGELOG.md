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

## 2026-08-15 — correção de PII no lote 1

Uma varredura do corpus commitado achou duas formas de PII que a sanitização
automática deixou passar: o nome completo de um terceiro dentro de um nome de
arquivo anexado (`Certidao_Nascimento_<nome>.pdf`) e um payload de Pix
copia-e-cola com domínio de banco e UUID.

Causa de cada escape: nome em nome de arquivo não tem espaço nem título, e
nenhum detector de nome alcança; o padrão de UUID ancorava em `\b` no fim, que
não casa quando o UUID é seguido de dígitos, como no Pix; o padrão de URL exigia
esquema `http(s)://`; e não havia detector de payload de pagamento.

`redactCorpusText` passou a ser a segunda barreira, aplicada na extração e de
novo como recusa no parse. O corpus foi re-extraído, re-amostrado e reconstruído
inteiro; a seleção é determinística e a redação não muda identificador, então os
mesmos 41 turnos voltaram na mesma ordem e todos os rótulos continuam válidos.

Os bytes vazados foram removidos dos quatro commits que os carregavam. A branch
nunca foi publicada.

**Nenhum caso mudou de rótulo.** O baseline foi remedido sobre o texto redigido
e é idêntico: 71,9% no eixo `request`, 18 confusões, 55 puros / 11 com I/O.
