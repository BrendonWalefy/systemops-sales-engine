# Escala de atendimento por dia da semana

Data: 2026-08-13
Status: aprovado, execução autorizada
Posição no programa: spec 4 de 4 — independente das outras três, pode correr em paralelo

## 1. Decisão

Substituir o horário de atendimento de texto livre por uma escala estruturada por dia da
semana, com migração e backfill, e passar `SlotEngine` e o orquestrador a lerem essa escala.

## 2. O defeito

`organizations.businessHours` é uma coluna `text` livre, e `parseBusinessHours` extrai dela:

- **uma** faixa de horário, por uma única expressão regular sobre a string inteira;
- `days`, cuja única variação é sábado ligado ou desligado, detectado por `/s[aá]b/`;
- campos de exceção **exclusivos de sábado** (`saturdayStartHour`, `saturdayEndHour`, …).

Sábado foi remendado duas vezes: no conjunto de dias e no horário. Nenhum outro dia recebeu
tratamento.

O que **não é representável** hoje:

- horário diferente por dia, fora do caso de sábado;
- clínica fechada num dia do meio da semana;
- dois turnos no mesmo dia com intervalo de almoço declarado.

E o dano não fica no texto da resposta. `businessHours.days` alimenta
`SlotEngine.computeAvailableSlots` (`src/core/scheduling/SlotEngine.ts:94` e `:195`), que decide
**quais dias têm horário disponível**. Uma escala que o modelo de dados não consegue guardar
produz disponibilidade errada, não só frase errada.

O comentário do guard `isSaturdayQuestionForOperatingClinic` admite a limitação:
*"Enquanto o parser não souber o resto da semana, o sistema não afirma o que não sabe."* É a
família do bug conhecido em que uma pergunta sobre segunda-feira resultou em indisponibilidade
falsa.

## 3. Precedente de forma que já existe no código

Janelas de agendamento por tratamento já carregam `weekdays?: number[]`
(`src/domain/entities/treatment.ts:105`), com a semântica "ausente = todos os dias de operação".
A escala da clínica deve seguir a mesma convenção de numeração — `0` domingo a `6` sábado — para
não criar um segundo vocabulário de dias no mesmo sistema.

## 4. Modelo de dados

Nova coluna em `organizations`, jsonb, ao lado da existente:

```ts
businessSchedule: jsonb("business_schedule").$type<BusinessSchedule>(),
```

```ts
/** Escala por dia. Dia ausente do mapa = clínica fechada nesse dia. */
export type BusinessSchedule = {
  /** 0=Dom .. 6=Sáb. Um dia pode ter mais de uma janela (manhã e tarde). */
  days: Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, DayWindow[]>>;
};

export type DayWindow = {
  startHour: number;
  startMinute: number;
  /** Exclusivo: uma janela 8:00–12:00 não oferece slot começando às 12:00. */
  endHour: number;
  endMinute: number;
};
```

Decisões de modelagem, e o porquê de cada uma:

- **jsonb em `organizations`, não tabela nova.** A escala é um atributo da clínica, sempre lida
  inteira junto com a organização, e nunca consultada por linha. Uma tabela acrescentaria um
  join a todo cálculo de slot sem nada em troca.
- **Dia ausente significa fechado**, em vez de um campo `closed: true`. Elimina o estado
  contraditório "fechado mas com janela".
- **Lista de janelas por dia**, em vez de uma faixa só. Resolve intervalo de almoço, que hoje é
  invisível e faz o sistema oferecer horário no almoço.
- **A coluna antiga `businessHours` permanece**, sem ser removida nesta spec. Ela é a origem do
  backfill e a rede de segurança de rollback. Remoção é outra mudança, depois de a nova provar
  estabilidade.

## 5. Migração e backfill

Migração `0098`, gerada por `npm run db:generate` — nunca escrita à mão.

Ela apenas acrescenta a coluna, aceitando nulo. Nenhuma escrita de dado na migração.

O backfill é um **script separado e idempotente**, `scripts/backfill-business-schedule.ts`, que
para cada organização com `businessHours` preenchido e `businessSchedule` nulo:

1. roda `parseBusinessHours` no texto atual;
2. constrói a escala equivalente — a faixa geral nos dias de `days`, e a faixa de sábado nos
   campos de sábado quando presentes;
3. grava `businessSchedule`.

O backfill **preserva o comportamento atual exatamente**, incluindo as limitações. Ele não
adivinha o que o texto não diz. Uma clínica cujo texto livre dizia "Segunda a sexta, das 8h às
18h" resulta em cinco dias com uma janela cada — nem mais, nem menos.

Casos em que `parseBusinessHours` não encontra faixa alguma resultam em `businessSchedule` nulo,
e a leitura cai no fallback da §6. Não se inventa horário padrão no backfill.

## 6. Leitura, com fallback explícito

Uma única porta de leitura, `resolveBusinessSchedule(organization): BusinessSchedule`:

1. se `businessSchedule` está preenchido, usa;
2. senão, deriva de `businessHours` via `parseBusinessHours` — o caminho legado;
3. senão, usa o padrão de segunda a sexta, 8h às 18h, que é o default já embutido hoje.

`parseBusinessHours` **não é deletado**: passa a ser o adaptador legado do passo 2. Enquanto
existir organização sem `businessSchedule`, ele é caminho vivo.

## 7. Consumidores a atualizar

| Local | Mudança |
| --- | --- |
| `SlotEngine.computeAvailableSlots` (`:94`, `:195`) | ler janelas do dia a partir da escala, em vez de `days.includes(weekday)` mais uma faixa única |
| `ConversationOrchestrator:1033`, `:1042` | `days.includes(6)` e `days.includes(0)` viram consulta à escala |
| `isSaturdayQuestionForOperatingClinic` | **substituída** por `resolveWeekdayQuestion(message, schedule)`, que reconhece os sete dias |
| `buildBusinessHoursAnswer` | responder qualquer dia perguntado a partir da escala, com o horário real daquele dia |
| UI do owner: `owner/clinics/[clinicId]`, `owner/clinics/new`, `owner/onboarding/[clinicId]` | editor de escala por dia |

A substituição do guard de sábado é o ponto em que o defeito fecha: o guard existia porque o
sistema só sabia sobre sábado; com a escala, saber sobre quarta-feira é a mesma consulta.

## 8. Ordem de entrega

Quatro unidades de mudança separadas, na ordem, porque a spec mestre proíbe misturar schema,
core e UI num deploy:

1. **Schema e leitura.** Migração `0098`, tipo, `resolveBusinessSchedule` com fallback, testes.
   Nenhum consumidor muda ainda. Deploy seguro por construção: nada lê a coluna nova.
2. **Backfill.** Script idempotente, rodado e conferido. A escala existe e ninguém a usa.
3. **Core.** `SlotEngine` e orquestrador passam a ler pela porta única; o guard de sábado é
   substituído pelo de sete dias. É aqui que o comportamento muda.
4. **UI.** Editor por dia no painel do owner.

Entre 2 e 3 há um estado deliberado em que a escala está gravada e não usada. É o que permite
conferir o backfill contra o texto original antes de qualquer mudança de comportamento.

## 9. Verificação

1. Migração gerada por `npm run db:generate` e `npm run db:check` verde.
2. `resolveBusinessSchedule` coberto nos três caminhos: escala presente, derivação do texto
   legado, e padrão.
3. **Equivalência do backfill:** para cada organização, os slots calculados pela escala nova são
   idênticos aos calculados pelo texto antigo. Este é o gate da unidade 2 — o backfill não pode
   mudar disponibilidade.
4. `SlotEngine` com escala por dia: teste com clínica fechada na quarta, com sábado de horário
   reduzido, e com dois turnos e intervalo de almoço. Os três são impossíveis hoje.
5. Pergunta sobre cada um dos sete dias produz resposta com o horário real daquele dia, e
   resposta correta de "fechado" no dia sem janela.
6. `npm run verify` verde em cada uma das quatro unidades.
7. Nenhuma regressão em `verify:agenda`, que cobre `SlotEngine`, dupla marcação e timezone.

## 10. Riscos

- **Disponibilidade errada é dano direto ao lead.** Um erro aqui marca consulta em dia fechado
  ou nega dia aberto. Por isso a unidade 2 tem gate de equivalência: nenhuma mudança de
  comportamento até a escala provar que reproduz o presente.
- **Timezone.** Todo `Date` no banco é UTC e a conversão passa por `ClinicTimezone`. A escala é
  em hora **local da clínica** e precisa continuar assim; comparar hora local com instante UTC
  sem converter é o erro clássico desta área.
- **Texto legado ambíguo.** Alguma clínica pode ter texto que `parseBusinessHours` interpreta de
  forma diferente do que uma pessoa leria. O backfill preserva a interpretação **do parser**,
  não a humana, e a diferença aparece na conferência da unidade 2 para correção manual.
- **Escopo da UI.** O editor por dia é a parte com mais superfície visual e menos risco
  funcional. Se o tempo apertar, as unidades 1 a 3 entregam o conserto e a UI pode esperar,
  com a escala sendo populada por script no intervalo.

## 11. Fora de escopo

- Remover a coluna `businessHours`.
- Feriados e exceções de data específica — são um mecanismo diferente (`calendar_blocks` já
  existe) e não devem ser confundidos com escala semanal.
- Escala por profissional, que já tem tratamento próprio em `professionalSchedule`.
- Fuso diferente por dia. Um só fuso por clínica.
