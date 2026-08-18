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

## C.7 — segunda revisão e quarto vazamento de PII

A segunda revisão do pacote final devolveu, na própria folha, um primeiro nome
de paciente: `scheduling-0001` abria com uma saudação seguida do nome. O lead
está cadastrado com uma grafia e o operador digitou outra. A redação de identidade
casa token exato contra o cadastro, então grafia errada não é alcançada por
construção, e nenhum detector procurava nome solto — nome de pessoa não tem forma
reconhecível como telefone tem.

O vocativo depois da saudação tem forma: é posição, não grafia. A regra passou a
valer na barreira, no detector do parse e no auditor, a partir de uma fonte só.
Rodada sobre os 66 casos, achou um segundo nome que ninguém tinha visto, em
`procedure-0001`, e nenhum falso positivo.

**Nenhum caso mudou de rótulo.** Só dois textos mudaram, e a mudança é a troca do
nome por `[PACIENTE]`.

## C.8 — régua única, renderer completo, purga de histórico

A barreira de nome em vocativo entrou nos três lugares a partir de uma fonte só,
e os blobs que ainda carregavam os dois nomes foram removidos dos 18 commits não
publicados da branch. `main` e as branches já publicadas não foram tocadas.

A folha passou a mostrar side effect com fonte, descrição do serviço que o turno
menciona, e — quando não há ação registrada — a ausência declarada em vez de
silêncio.

Os 66 foram re-derivados sob a régua vigente, 65 válidos mais um declarado
inválido. `golden` cai de 15 para 8, `anti-pattern` sobe de 46 para 51.

## C.9 — fixtures sem corte, régua com as duas regras que faltavam

A política comercial e a descrição de serviço deixaram de ser truncadas; mídia
passou a entrar por título; toda fixture declara se o catálogo é fechado ou de
completude desconhecida.

O texto que estava sendo cortado continha o sinal de reserva abatido no dia do
procedimento — o que devolveu `other-0001` a `golden` depois de duas rodadas
julgando-o sem lastro por defeito da fixture, não da resposta.

65/65 re-derivados. `golden` 8 → 7, `anti-pattern` 51 → 55.

## C.9 final — régua calibrada e congelada

91,7 / 91,7 / 87,5 / 87,5 entre dois revisores independentes, com 16 de 20 casos
inéditos. As perguntas estão congeladas em `review-checklist.v2-calibrada`, com
digest travado em teste.

Baseline V1 remedido sobre os 65 válidos: 68,8% no eixo `request`, 89,1% na
camada de decisão.
