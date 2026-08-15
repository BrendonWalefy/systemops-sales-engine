# Como revisar o corpus

Ciclo C do [plano da Conversation Intelligence V2](../superpowers/plans/2026-08-15-conversation-intelligence-v2.md).

O corpus tem hoje **um revisor só** (`claude-opus-5`). Este documento é o material
do segundo revisor. Enquanto a segunda passagem não acontecer, a concordância
entre revisores é **desconhecida**, e nenhum número medido sobre o corpus deve ser
apresentado como calibrado.

## O que gerar

```bash
npm run corpus:review -- --out ~/corpus-review.md --limit 20
```

Sai um Markdown com os 20 casos de calibração. A folha mostra o turno, o contexto,
os fatos do tenant, as duas respostas observadas e as quatro perguntas. **Ela não
mostra o rótulo nem o parecer do primeiro revisor**, de propósito: ver a resposta
alheia antes de dar a sua transforma revisão em conferência, e a medida de
concordância perde o sentido. Um teste trava essa propriedade.

## Como responder

Cada caso termina com um bloco assim:

```
price-0001 IA  [ ] [ ] [ ] [ ]
price-0001 HUM [ ] [ ] [ ] [ ]
price-0001 OBS:
```

Escreva `S` ou `N` dentro de cada colchete, na ordem das quatro perguntas:

| # | Pergunta | Responda `N` quando |
| --- | --- | --- |
| 1 | O dado afirmado estava correto no momento? | preço, horário, serviço, garantia ou endereço divergem dos fatos listados no caso |
| 2 | A resposta tratou o que o lead levantou? | a pergunta, a objeção, a reclamação ou a foto ficaram sem tratamento |
| 3 | A resposta reduz de forma relevante a distância até uma resolução ou próximo passo válido? | o turno só reconhece, cumprimenta ou encerra socialmente — ou o passo que ele oferece é fabricado |
| 4 | Você mandaria exatamente isso hoje? | você reescreveria antes de enviar |

### Pergunta 3 — o que conta como avanço

Definição adotada no C.8, depois de essa pergunta ser a única divergência que
sobrou entre dois revisores independentes com régua e folha já corrigidas. A
formulação anterior — "ficou mais perto de um próximo passo" — não dizia se
reconhecer aproxima, e dois julgamentos honestos podiam divergir para sempre.

**Conta como avanço** (a resposta reduz a distância até a resolução):

- responde informação necessária;
- reduz ambiguidade;
- coleta informação necessária para uma próxima ação;
- trata uma objeção de forma útil;
- executa ou confirma uma ação válida.

**Não conta:** mero reconhecimento, saudação, encerramento social. Cortesia não é
avanço — "fico à disposição" e "obrigado pela confirmação" deixam a conversa
exatamente onde estava.

**Pergunta de clarificação conta quando** coleta informação realmente necessária
para a próxima ação. Não conta quando devolve ao lead algo que ele já disse, ou
que a configuração do tenant já responde: aí ela custa uma volta e não coleta
nada.

**Ação ou disponibilidade fabricada nunca conta**, por mais que aparente mover a
conversa. Horário inventado, desconto inexistente e agendamento que não foi feito
afastam da resolução em vez de aproximar — o lead vai agir sobre algo que não
existe.

Três regras que valem mais do que a intuição:

- **A resposta humana não é gabarito.** Ela é candidata como qualquer outra. Duas
  respostas humanas do lote atual são `anti-pattern` — uma delas dá garantia
  clínica sobre desgaste de lente em paciente com bruxismo, vinda da recepção.
- **A resposta da IA não é errada por ser da IA.** Há casos em que ela é a melhor
  do turno; um deles é exatamente o par da garantia acima, em que escalar foi o
  movimento certo.
- **Você não escolhe o rótulo.** `golden`, `acceptable` e `anti-pattern` saem das
  suas quatro respostas. Se o rótulo derivado ficar errado, o problema é a
  pergunta, e a correção é reescrever a pergunta e re-derivar tudo — nunca abrir
  exceção para aquele caso.

Linha inteiramente em branco significa "não revisei", que é diferente de "respondi
não" e não conta como divergência. Resposta que não existe (`—`) não se revisa.

Use `OBS:` para o que não cabe em sim ou não. O caso `price-0001` já tem uma
observação registrada do primeiro revisor que vale confirmação sua: o valor da
técnica estratificada citado pela operadora diverge do catálogo lido em 15/08, e a
mensagem é de 15/06 — não dá para saber, hoje, qual era o preço em vigor. O mesmo
vale para os outros casos com a tag `catalog-divergence`.

## O que fazer com a folha preenchida

```bash
npm run corpus:import -- --sheet ~/corpus-review.md --out concordancia.json
```

Sai a concordância **por campo do checklist**, não por caso. É essa a medida que
importa: um campo abaixo de 80% significa que a pergunta está mal formulada, e
reescrever a pergunta vem antes de revisar mais casos. O relatório lista cada
divergência com caso, respondente e campo.

O importador **não reescreve rótulo nenhum**. Resolver divergência é decisão sua.

## Ordem sugerida

1. Revise os 20 de calibração sem olhar o corpus.
2. Rode o importador e leia a concordância por campo.
3. Se algum campo ficar abaixo de 80%, reescreva a pergunta em
   `src/application/corpus/review-checklist.ts`, re-derive o corpus inteiro e
   registre a mudança em `evals/corpus/CHANGELOG.md`.
4. Só então revise os 46 restantes.
