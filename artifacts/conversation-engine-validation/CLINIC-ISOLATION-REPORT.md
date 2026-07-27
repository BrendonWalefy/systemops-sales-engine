# Auditoria de isolamento entre clínicas

Data: 24/07/2026
Base: `origin/develop == origin/main == d8c0fd0`

## Resposta direta

O problema relatado — corrigir uma clínica e quebrar outra — faz sentido e está
demonstrado na arquitetura atual.

Não foi encontrado um conjunto relevante de condicionais por slug, como
`if (clinic.slug === "vitalli")`. O acoplamento é mais sutil e mais perigoso:
casos reais de uma clínica foram convertidos em regras universais dentro do
`ConversationOrchestrator`, sem um contrato explícito dizendo a quais tenants,
segmentos ou tratamentos elas se aplicam.

O pacote V1/V2 identifica corretamente o alto acoplamento, a concorrência e a
necessidade de rollout seguro. Porém, interface de engine, shadow e canary não
resolvem sozinhos o isolamento entre clínicas. Sem corrigir ownership e
aplicabilidade das regras, uma V2 apenas reorganizaria o Frankenstein.

Uma execução direta dos helpers da baseline atual confirmou:

| Entrada neutra/configuração | Resultado atual |
|---|---|
| `Qual dessas fotos?` | entra no caminho de esclarecimento Premium/Estratificada |
| `Seg-Sex 8h-18h` + `posso ir depois das 19h?` | promete que pode abrir exceção |
| depósito de R$ 30 | começa afirmando que a avaliação não tem custo |
| tratamento `Clareamento dental` com flag falsa | heurística ainda devolve estético |

## Achados prioritários

### ISO-01 — Exceção de horário de uma clínica virou promessa global

**Severidade:** P1 alta
**Status:** confirmado

`buildBusinessHoursAnswer()` recebe somente `businessHoursRaw` e a mensagem.
Quando o lead pede um horário fora da janela, o helper sempre responde:

> dependendo do procedimento conseguimos abrir exceção

O comentário do próprio código explica a origem: na Vitalli, lentes podem ser
atendidas depois do horário padrão. Entretanto não existe no contrato:

- flag de exceção por clínica;
- política por procedimento;
- janela excepcional;
- permissão para prometer consulta à equipe.

Assim, Ximendes, NC Beauty e qualquer tenant futuro recebem a mesma promessa. O
teste `BusinessHoursOutOfWindow.test.ts` fixa esse comportamento como universal,
mas não contém um caso negativo de clínica sem exceção.

**Ownership correto:** política operacional estruturada da clínica e, se variar
por serviço, do tratamento. A resposta deve ser renderizada a partir da decisão,
sem texto comercial específico dentro do helper universal.

**Patch seguro:** separar a decisão `outside_standard_hours` da política
`mayRequestException`; até existir configuração explícita, informar o horário
cadastrado e oferecer alternativas válidas sem prometer exceção.

### ISO-02 — Conteúdo Premium/Estratificada está hardcoded no core universal

**Severidade:** P0 de isolamento de conteúdo
**Status:** confirmado

`isMediaClarificationRequest()` considera `foto + qual` suficiente. Em seguida,
`buildMediaClarificationClinicContext()` injeta fatos exatos sobre Lente Premium e
Estratificada:

- Premium usa uma única resina e é mais acessível;
- Estratificada usa duas resinas, borda translúcida e é mais sofisticada.

Esse caminho não exige:

- clínica Vitalli;
- segmento dental;
- tratamento ativo de lentes;
- mídia vinculada a uma dessas técnicas;
- fato vindo do playbook ou do pipeline.

Logo, “qual dessas fotos?” em outra clínica satisfaz o detector e pode receber
conteúdo comercial/técnico da Vitalli. O mesmo fato já existe no
`commercialPolicy` ativo da Vitalli, criando dois donos.

**Ownership correto:** `ContentBlock`/caption do pipeline ou dados editoriais do
tratamento/playbook. O core pode decidir “responder à mídia referenciada”, mas
não deve conhecer Premium, Estratificada nem a comparação comercial.

**Patch seguro:** resolver a mídia e o tratamento do contexto; compor a resposta
somente com caption/conteúdo autorizado daquele tenant. Sem contexto inequívoco,
pedir qual card o lead quis dizer.

### ISO-03 — `depositEnabled` carrega implicitamente “avaliação gratuita”

**Severidade:** P1
**Status:** confirmado como falha de modelagem; impacto atual contido

No ramo de preço, qualquer clínica com `depositEnabled` e valor configurado usa
`buildEvaluationDepositClarification()`, que afirma de forma fixa:

> A avaliação não tem custo.

Essa afirmação coincide com a configuração atual da Vitalli. Ela não é
representada por `depositEnabled`. A Ximendes, por exemplo, declara avaliação
paga de R$ 100, embora hoje não tenha depósito habilitado. Uma clínica futura
com avaliação paga e sinal habilitado receberia uma resposta falsa.

**Ownership correto:** preço da avaliação e regra de abatimento no tratamento
“Avaliação”, com política de reserva separada no tenant. O template deve receber
fatos estruturados, nunca inferir “gratuita” de uma capability diferente.

### ISO-04 — Campo estruturado `isAesthetic` é contornado por heurística de nome

**Severidade:** P1
**Status:** confirmado

O schema e a UI já possuem `treatments.isAesthetic`. Mesmo assim,
`isAestheticTreatment()` contém uma lista fixa de palavras como lente, faceta,
clareamento, botox, sorriso, coloração, mechas e penteado.

Há ainda dois comportamentos diferentes:

- seleção no menu usa apenas a heurística do nome;
- menção direta usa `treatment.isAesthetic || heurística`.

Portanto, renomear um tratamento pode alterar o fluxo; marcar explicitamente
`isAesthetic=false` não desliga a heurística; e os dois caminhos podem discordar.
Isso reduz a configuração explícita a uma sugestão, não a fonte de verdade.

**Ownership correto:** `Treatment.isAesthetic`. Fallback heurístico pode existir
somente na criação/importação como sugestão de onboarding, nunca como decisão de
runtime.

### ISO-05 — Segmentos diferentes colapsam em um único booleano “clínica”

**Severidade:** P1 estrutural
**Status:** confirmado

`PromptContextBuilder` usa regex para transformar dental, saúde, medicina,
clínica e estética em `isClinicSegment=true`. Esse único booleano ativa regras de
chegada e urgência cujo prompt inclui exemplos odontológicos (“caiu a lente”,
“soltou o implante”).

Ao mesmo tempo, coerções de garantia e manutenção são globais e não recebem
capability/segmento. O produto já declara segmentos como barbearia, ateliê,
varejo, pets, fitness, educação, imobiliário e restaurante; o contrato atual não
é expressivo o bastante para dizer quais regras cada segmento suporta.

**Ownership correto:** capabilities tipadas e explícitas, por exemplo
`appointment_arrival`, `clinical_urgency`, `warranty`, `maintenance`,
`visual_preassessment`, com regras universais independentes do texto editorial.

### ISO-06 — Correções por incidente acumulam precedência implícita

**Severidade:** P1 estrutural
**Status:** confirmado

O orquestrador possui 8.222 linhas, 159 declarações de função/método detectadas,
16 escritas reais em `effectiveIntent` e 12 pontos que atribuem
`pendingPipelineAdvance`. Há 134 referências a Ximendes, Vitalli ou NC Beauty nos
testes e 81 no runtime/infra/UI, em grande parte comentários de incidentes.

Usar casos reais em testes é positivo. O problema é que muitos testes provam
apenas “esta clínica agora funciona”, sem provar a não aplicação da regra às
demais. A precedência entre guards é determinada pela posição física de blocos
mutáveis no método principal.

## O que já está bem isolado

Nem tudo precisa ser refeito. Há padrões corretos que devem virar referência:

| Necessidade | Implementação atual correta |
|---|---|
| Oferta de slots após preço | `offerSlotsAfterPriceEnabled`, opt-in por clínica |
| Duração/janela do serviço | campos de `treatments` e `bookingWindows` |
| Fluxo e conteúdo do tratamento | `pipelineSteps` + `ContentBlock` |
| Formato de áudio/texto | capability/config de voz no envio |
| Preço efetivo | tratamento + campanha ativa |
| Fuso e horários | `ClinicTimezone` e config da organização |
| Vocabulário básico | campos do tenant derivados no onboarding |

Esses exemplos mostram que o problema não exige uma engine por clínica. Exige
que toda regra variável tenha dono, escopo e teste negativo.

## Arquitetura recomendada para 10+ clínicas

```text
TurnSnapshot imutável
  ├─ TenantPolicy (config operacional validada)
  ├─ SegmentCapabilities (capabilities explícitas)
  ├─ TreatmentPolicy (regras do serviço)
  └─ EditorialContent (playbook/pipeline, sem regra operacional)
             ↓
Rule Registry determinístico
  cada regra declara: id, prioridade, appliesTo, input, decisão e trace
             ↓
TurnPlan único
  resposta + transição + efeitos + outcome
             ↓
Commit revisionado + outbox
```

Princípios:

1. **Kernel universal, não forks por clínica.** V1/V2 são versões do motor; tenant
   policy e capabilities são dados.
2. **Aplicabilidade explícita.** Toda regra declara a capability/segmento/serviço
   exigido. Ausência significa não aplicar.
3. **Conteúdo não mora em guard.** Regras produzem decisões sem texto específico
   de uma clínica; renderer usa conteúdo autorizado.
4. **Config tipada e validada na ativação.** Combinações inválidas, como depósito
   sem política clara de avaliação, não chegam ao runtime.
5. **Uma decisão por turno.** Guards deixam de sobrescrever uma variável comum e
   passam a produzir uma decisão com trace de precedência.
6. **Estado e outbound atômicos.** O isolamento de tenant não resolve corrida;
   revision/CAS e idempotência continuam necessários.

## Regra de teste para toda correção futura

Toda correção originada por uma clínica deve incluir:

1. reprodução positiva para a clínica afetada;
2. caso negativo para cada capability/segmento que não deve receber a regra;
3. caso de uma segunda clínica do mesmo segmento com política diferente;
4. assert do owner do dado usado na decisão;
5. replay das três clínicas atuais;
6. trace mostrando por que a regra aplicou ou não aplicou.

Uma suíte mínima de isolamento deve manter fixtures contratuais sanitizadas:

| Fixture | Política que precisa diferir |
|---|---|
| Ximendes | avaliação paga, agenda interna, abordagem consultiva |
| Vitalli | avaliação gratuita + sinal, Google Calendar, oferta direta opt-in |
| NC Beauty | estética não odontológica, sem depósito, shadow de entrega atual |
| Controle futuro | segmento não clínico, sem regras odontológicas |

## Relação com a proposta V1/V2

**Manter:**

- V1 preservado;
- engine version fixada por conversa;
- shadow puro;
- canary por novas conversas;
- DecisionTrace;
- commit revisionado e outbox;
- rollout/rollback por flag.

**Adicionar antes da V2:**

- `TenantPolicy` validada;
- capability registry explícito;
- rule applicability;
- separação entre decisão e copy;
- matriz de regressão cruzada;
- lint arquitetural que impeça conteúdo clinic-specific no core universal.

**Não fazer:**

- criar uma branch de código por clínica;
- acumular flags ad hoc sem um schema de policy;
- copiar o orquestrador atual para `V2`;
- considerar shadow/canary como solução de ownership.

## Decisão

**Seguir com a proposta, mas com ajuste arquitetural obrigatório.**

A prioridade não é começar a V2. Primeiro deve-se fechar os vazamentos
clinic-specific já demonstrados e criar o contrato que impede a próxima correção
de escapar para outro tenant. Depois, a interface V1/V2 e o shadow passam a ser
um mecanismo seguro de migração, em vez de apenas uma segunda implementação do
mesmo acoplamento.
