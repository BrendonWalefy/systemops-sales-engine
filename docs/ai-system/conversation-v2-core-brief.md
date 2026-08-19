# Conversation Intelligence V2 — briefing do core para análise externa

**Propósito.** Este documento existe para ser lido por alguém de fora do projeto que vai avaliar
como o core de conversa está construído, o que ele cobre, e onde a inteligência pode melhorar. Ele
descreve o que existe no código, não o que está planejado.

**Estado.** Escrito em 2026-08-19 sobre `origin/develop`. Produção está em `0d0015cf`; nada descrito
como recente aqui está no ar ainda. A V2 roda em produção em **um único tenant** — SystemOps Dental
Lab, com `conversation_engine = v2_internal`. Os outros 7 tenants usam a V1, e 5 deles estão pausados.

**Tamanho.** `src/conversation-core/` + `src/domain-packs/dental/` somam 4.689 linhas. O orquestrador
da V1, que faz o trabalho equivalente, tem 8.734 linhas em um arquivo.

---

## 1. O princípio que rege tudo

> O LLM entende e verbaliza. O sistema decide.

Não é slogan: é uma fronteira executável. Existe uma estrutura de dados — o **plano autorizado** —
que separa o que o sistema decidiu do que o modelo pode dizer. O modelo nunca escolhe fato, preço,
horário ou próximo passo. Ele escolhe palavras, e um validador determinístico decide se aquelas
palavras podem sair.

O motivo é o domínio: o produto atende clínicas por WhatsApp. Um preço inventado é dinheiro e risco
jurídico, não um erro cosmético.

---

## 2. Anatomia de um turno

```text
webhook → inbound_events + job(message.process)
  → ProcessMessageJobHandler
  → TenantEngineRouter                         [determinístico]
  → Gate                                       [determinístico]
  → Understanding                              [MODELO]
  → Coordenador (claim de cada capability)     [determinístico]
  → decide()                                   [determinístico]
  → execute() via portas                       [determinístico]
  → AuthorizedResponsePlan                     [determinístico]
  → draft de atos + validador de atos          [determinístico]
  → superfície autorizada + statements         [determinístico]
  → Verbalização (prazo de 6s)                 [MODELO]
  → validador de texto                         [determinístico]
  → texto do modelo OU texto determinístico
  → enqueueOutboundMessage → outbox → sender
```

Duas chamadas de modelo por turno. Todo o resto é código.

### 2.1 Router — `src/application/conversation-v2/tenant-engine-router.ts`

Único ponto do sistema que escolhe V1 ou V2, uma vez por turno, depois do modo de automação. Sem
approval Ed25519 válida vinculada ao commit implantado, volta para V1 antes de qualquer efeito. Não
existe fallback V2→V1 dentro do mesmo turno — trocar a flag vale a partir do turno seguinte.

Um teste arquitetural (`src/__tests__/arch/ConversationV2RuntimeBoundary.test.ts`) percorre o grafo
de imports e falha se qualquer outro arquivo ramificar por engine.

### 2.2 Gate — `src/conversation-core/gate.ts`

Quatro booleanos, nessa ordem: `automationEnabled`, `duplicate`, `humanControlled`, `optedOut`.
Qualquer um suprime o turno antes de o modelo ser chamado.

### 2.3 Understanding — `src/infrastructure/adapters/ai/live-dental-understanding.ts`

Modelo com saída estruturada (`json_schema`, `strict: true`, `temperature: 0`).

**Recebe:** mensagem do lead, histórico recente (`organizations.aiContextWindowMessages`), estado da
conversa, e o catálogo do tenant como `{ id, displayName, aliases }`.

**Devolve:**

| Campo | Vocabulário | Lido por |
|---|---|---|
| `request` | 8 valores fechados | todas as capabilities |
| `entities` | `service`, `date`, `period`, `time`, `serviceCandidates`, `quantity`, `ordinal` | catálogo, agenda, explicação |
| `safety` | `optOut`, `requestsHuman`, `emergency` | escalação, recepção, gate de opt-out |
| `dialogueMove` | `new_topic`, `answers_pending`, `acknowledges`, `repeats`, `closes` | **só `repeats`**, na recepção |
| `signals` | `purchaseIntent`, `priceSensitivity`, `sentiment`, `objection` | **ninguém** |
| `ambiguity` | `{ kind, candidates[] }` | **ninguém** (ver §6.2) |
| `confidence` | 0..1 | carregado no claim; o coordenador ignora |

O vocabulário de `request` é fechado e tem um único dono
(`src/domain-packs/dental/vocabulary.ts`):

```
greeting · other · explain-service · price-of-service · service-availability
book-appointment · confirm-slot · confirm-appointment
```

O parser (`understanding.ts`) exige `entities.service` para `explain-service`, `price-of-service` e
`service-availability`. Um valor fora do vocabulário derruba o turno na validação.

### 2.4 Coordenador — `src/conversation-core/capability/coordinator.ts`

Pergunta a **todas** as capabilities se o turno é delas via `claim(understanding, state)`. Cada uma
responde com um claim tipado ou `null`. Duas que se declaram `conflictsWith` derrubam o turno para
escalação; nenhuma reivindicando devolve `needs_clarification`.

O modelo nunca escolhe capability. A capability nunca lê texto livre do lead — ela lê o objeto
estruturado.

### 2.5 Capabilities — `src/domain-packs/dental/`

Cinco, cada uma com `claim` / `decide` / `execute` separados:

| Capability | Reivindica | Portas | Outcomes |
|---|---|---|---|
| `dental-explanation` | `explain-service` | catálogo (leitura) | `service_explained`, `service_options_offered`, `clarification_required` |
| `dental-catalog` | `price-of-service`, `service-availability` | catálogo (leitura) | `catalog_answered`, `service_options_offered`, `clarification_required`, `escalation_required` |
| `dental-scheduling` | `book-appointment`, `confirm-slot`, `confirm-appointment` | agenda (leitura + escrita, via `BookingService`) | `slots_found`, `appointment_created`, `appointment_confirmed`, e as três falhas correspondentes |
| `dental-escalation` | `safety.emergency`, `safety.requestsHuman` | nenhuma | `escalation_required` |
| `dental-reception` | `greeting`, `other` | nenhuma | `reception_answered`, `escalation_required` |

`decide()` recebe o claim e o contexto (`{ state, policy, now }`) e devolve uma `Decision` fechada:
`ask` · `answer` · `offer` · `execute` · `close` · `suppress` · `escalate`.

`execute()` chama portas e devolve um `ActionResult` com `type`, `semanticClass`, `origin`,
`subject`, `evidence[]`, `facts[]` e opcionalmente `options[]`. Cada fato carrega `disclosure:
"allowed" | "internal"` e a evidência de onde veio.

**Detalhe importante de contrato:** a `Decision` é canonicalizada (`structuredClone`) entre `decide`
e `execute`. Tudo que o `execute` precisa tem de viajar dentro da própria Decision — não sobrevive
estado fora dela.

`src/domain-packs/dental/outcome-provenance.ts` declara, de forma congelada, quais outcomes cada par
(capability, decisionKind) pode produzir. É validado em runtime, não só em tipo.

### 2.6 Plano autorizado — `src/conversation-core/authorized-response-plan.ts`

Transforma os `ActionResult`s em um grafo congelado de refs (`subjects`, `evidence`, `facts`,
`options`, `outcomes`). É a fronteira: **o que não está aqui não pode ser dito.**

Restrições que valem citar porque moldam o conteúdo:

- fato com `disclosure: "allowed"` exige `subject`;
- `display_text` é recusado acima de **240 caracteres** — isso limita, por exemplo, o tamanho de uma
  descrição de procedimento;
- dinheiro só em `BRL`, inteiro em centavos;
- refs duplicadas, órfãs ou com evidência inconsistente derrubam a construção.

### 2.7 Atos de fala — `src/conversation-core/composer/`

O sistema escolhe **o que** dizer na forma de sete atos, um por classe semântica:

| Ato | Classe semântica |
|---|---|
| `inform_fact` | `information_authorized` |
| `offer_options` | `options_found` |
| `confirm_effect` | `effect_completed` |
| `communicate_failure` | `effect_failed` |
| `inform_required_action` | `human_action_required` |
| `invite_engagement` | `engagement_invited` |
| `ask_clarification` | `clarification_required` |

`validator.ts` recusa ato que não case com a classe, ref desconhecida, fato não divulgável,
duplicata e mistura de assunto. O que sobrevive é um `ValidatedDraftResponse`.

### 2.8 Verbalização — `src/infrastructure/adapters/ai/live-response-verbalizer.ts`

O modelo recebe **apenas**:

- `statements`: as intenções autorizadas (`meaning`, `subject`, `values`);
- `allowedValues`, `moneyValues`, `allowedNumbers`;
- `maxQuestions`, `maxCharacters`;
- `style` e `speaker` (nome de apresentação, organização, especialidade, tom de voz, orientação de
  condução).

Ele **não** recebe o plano completo — que carrega fato interno e referência de evidência — nem a
frase determinística. Enviar a frase pronta fazia o modelo copiar o vocabulário de máquina em vez de
dizer o sentido; isso foi medido e corrigido.

### 2.9 Validador de texto — `src/conversation-core/composer/verbalization-validator.ts`

A unidade de validação é o **valor inteiro**, não o dígito. Com `Qua 20/08 às 15h30` e
`Qui 21/08 às 9h` autorizados, validar dígitos soltos deixava passar `Qua 21/08 às 15h` — um horário
que nunca foi oferecido. Hoje: cada valor autorizado precisa aparecer completo, e todo dígito fora
desses trechos é recusado.

Códigos de recusa:

```
empty_text · too_long · too_many_questions · missing_authorized_value
unauthorized_number · unauthorized_currency · unauthorized_link · unauthorized_commitment
```

Notas de desenho:

- `missing_authorized_value` existe porque um validador que só proíbe permite o modelo **omitir** o
  preço e oferecer outra coisa no lugar;
- dinheiro e horário **por extenso** ("trezentos reais", "oito da manhã") são detectados, porque um
  scanner de dígitos não os enxerga;
- `unauthorized_commitment` cobre garantir/prometer/assegurar/jurar **e** prometer retorno ("te
  aviso", "entro em contato"), que nenhuma capability decidiu;
- `maxQuestions` é derivado dos atos: `offer_options`, `ask_clarification` e `invite_engagement`
  autorizam uma pergunta; informar fato ou confirmar efeito autorizam zero.

**Recusa nunca é silêncio.** Sai o texto determinístico renderizado do mesmo plano. Falha do
provedor e estouro do prazo de 6 s têm o mesmo destino.

### 2.10 Observabilidade

O Decision Trace registra, por turno, metadados de allowlist fechada — sem corpo, prompt, telefone,
nome ou URL. Estágios relevantes: `engine.selected`, `v2.understanding`, `v2.decision`,
`v2.action_result`, `response.plan_built`, `response.validated`, `response.fallback_applied`,
`v2.outbox`, `turn.failed`.

Em `response.validated`, `model` diz quem escolheu as palavras entregues
(`gpt-4o-mini` · `deterministic-v2` · `deterministic-fallback`) e `verbalizationViolations` traz os
códigos quando a reescrita foi recusada.

---

## 3. Cenários cobertos hoje

Cada linha é um caminho completo, medido ou testado.

| Turno do lead | request | Capability | Resposta |
|---|---|---|---|
| "oi" | `greeting` | recepção | convite acolhedor, uma pergunta |
| "o que é lente de resina?" | `explain-service` | explicação | descrição cadastrada no tratamento |
| "quanto custa a lente?" | `price-of-service` | catálogo | preço, se `priceQuotableInChat` |
| "vocês fazem clareamento?" | `service-availability` | catálogo | disponibilidade do serviço |
| "tem horário amanhã à tarde?" | `book-appointment` | agenda | horários reais do `SlotEngine` |
| "pode marcar o primeiro" | `confirm-slot` | agenda | agendamento via `BookingService` |
| "confirmo" | `confirm-appointment` | agenda | confirmação do agendamento |
| "quero falar com uma pessoa" | qualquer | escalação | handoff determinístico |
| "socorro, quebrou meu dente" | qualquer | escalação | handoff por emergência |
| pedido casa com 2 tratamentos | qualquer | catálogo/explicação | oferta dos candidatos reais |
| lead repete o turno | `other` + `repeats` | recepção | handoff em vez de repetir o convite |
| "para de me mandar mensagem" | qualquer | — | opt-out durável + confirmação |

### 3.1 O que está medido contra o modelo real

`scripts/measure-v2-verbalization.ts` monta planos autorizados reais e aplica o validador de
produção. Última medição com o formato de rótulo que a produção gera (`Qua 20/08 às 15h30`):
**15 de 16 reescritas aceitas**; a recusa foi uma pergunta a mais numa falha de agenda.

Sondagem de classificação com texto quebrado de propósito:

```
"oq eh lentee de contatoo dental??"                   → explain-service
"eu queria intender melhor oq eh o clareamnto..."     → explain-service
"como funciona esse negocio de faceta"                → explain-service
"quanto custa a lente"                                → price-of-service
"vcs fazem clareamento?"                              → service-availability
"esacreveer3re etttaardo"                             → other, confiança 0.8
```

O entendimento lida bem com erro de digitação e gíria. **O gargalo não é compreensão.**

---

## 4. Cenários NÃO cobertos

Esta lista é o ponto central da análise pedida.

| Cenário | Situação hoje | Existe na V1? |
|---|---|---|
| Objeção ("achei caro", "vou pensar") | `signals.objection` é calculado e descartado; a resposta cadastrada no playbook nunca chega ao lead | sim |
| Diferencial ("por que com vocês?") | sem conceito; cai em `other` | sim |
| Pipeline por tratamento (conteúdo, vídeo) | inexistente na V2 | sim — `PipelineStep` com `content`, `qa`, `photo` |
| Coleta de foto | inexistente | sim |
| Follow-up / recuperação | inexistente | sim |
| Sinal / depósito | inexistente | sim |
| Reagendar / cancelar | inexistente | sim |
| Localização, horário de funcionamento, estacionamento, convênio | inexistente; nenhuma base de conhecimento no schema (43 tabelas, nenhuma de conteúdo curado) | parcial, via playbook em prosa |
| Comparar dois tratamentos | inexistente | parcial |
| Mídia na resposta | o plano tem `allowedMediaCount: 0` fixo | sim |

**Consequência prática:** qualquer turno fora das 8 categorias cai em `other` → recepção → convite.
O sistema entendeu e não tem onde colocar.

---

## 5. Configuração do tenant e como ela entra na resposta

| Dado | Dono | Como chega |
|---|---|---|
| Nome e apelidos do procedimento | `treatments.name`, `.aliases` | catálogo enviado ao Understanding |
| Descrição do procedimento | `treatments.description` | fato autorizado (`service_explained`) |
| Preço | `treatments.priceCents` | fato autorizado |
| Preço pode ser dito no chat | `treatments.priceQuotableInChat` | condição no `decide()` |
| Exige avaliação antes | `treatments.requiresEvaluationFirst` | zera a busca de horários |
| Horário, timezone, buffer, janela, nº de slots | `organizations.*` | `SlotEngine` |
| Nome da recepcionista, especialidade, tom, condução | `playbook_versions.*` | `speaker` do verbalizador |
| Política comercial, diferenciais, garantia, objeções | `playbook_versions.*` | **não chega** (ver §6.1) |
| Permissão de citar preço, escalação obrigatória, antecedência mínima | **constante no código** | `DentalPolicy` fixa em `internal-lab-live-turn-configuration.ts` |

---

## 6. Decisões de desenho que merecem contestação

Estão aqui porque foram tomadas de propósito e podem estar erradas.

### 6.1 O perfil de quem fala carrega maneira, não conteúdo

O verbalizador recebe nome, especialidade, tom de voz e orientação de condução. **Não** recebe
política comercial, diferenciais, garantia nem resposta a objeção.

Razão: `commercialPolicy` é preço derivado somado a enquadramento humano, e o texto do playbook
inclui a seção de garantia. Dar isso ao modelo é colocar preço e cobertura na mão dele e pedir que
siga a orientação — o convite exato para afirmar cobertura que a política do produto proíbe.

Custo aceito: essas informações não chegam ao lead até virarem capability com fato autorizado.

### 6.2 `understanding.ambiguity` fica sem uso de propósito

Seus `candidates` são strings escritas pelo **modelo**. Virar fato autorizado seria o modelo
autorizando a si mesmo. A ambiguidade que o catálogo resolve traz candidatos reais do tenant, e é
essa que o sistema usa.

### 6.3 `nextBestStep` está declarado e não é lido — e não é esquecimento

O tipo `Decision` tem `nextBestStep: NextStep | null`, uma capability o preenche, e nenhum consumidor
o lê. É o motivo de uma resposta de preço terminar em beco sem saída.

Para ligá-lo falta uma decisão de contrato no core: o ato `invite_engagement` **não carrega fatos**,
então um convite não consegue nomear para o que está convidando ("Quer que eu veja um horário para a
avaliação?" versus "Posso ajudar em algo mais?"). Estender `invite_engagement` para carregar fatos
mexe em validador de atos, renderizador e superfície autorizada.

### 6.4 Toda coisa nova que o negócio pode dizer é uma mudança de código

É o preço pago pela garantia. Está certo para conteúdo transacional (preço, horário, compromisso) e
provavelmente errado para o resto — "tem estacionamento?", "aceita convênio?", "posso levar meu
filho?" são infinitas perguntas com zero risco transacional, e hoje cada uma exigiria uma capability.

### 6.5 Modelo fixo no código

A V2 usa `gpt-4o-mini` nas duas chamadas, com vocabulário fechado de model id — trocar é mudança de
código em quatro arquivos. A V1, no mesmo repositório, já tem estratégia por tier
(`STANDARD_COMPOSER_MODEL = gpt-4o-mini`, `PREMIUM_COMPOSER_MODEL = gpt-5.5`) e classificador
sobrescrevível por env.

---

## 7. Armadilhas conhecidas deste código

Úteis para quem for propor mudanças.

1. **Vocabulário fechado duplicado.** Valores costumam ser declarados numa união TypeScript **e**
   num `Set`/`z.enum` em runtime. Já aconteceu de acrescentar em um só e o turno morrer no meio, em
   silêncio. `src/__tests__/DentalVocabularySync.test.ts` agora falha quando o pack, o registro de
   comparação e o parser de evidência divergem — mas essa proteção cobre só três cópias.
2. **A `Decision` é clonada entre `decide` e `execute`.** WeakMap, closure ou qualquer estado fora do
   objeto não sobrevive.
3. **Teste verde não prova que responde.** 3.514 testes passavam enquanto a V2 não respondia "oi" em
   produção. Toda mudança de comportamento conversacional deve ser medida contra o modelo real.
4. **As suítes de attestation exigem árvore git limpa.** Falham com working tree suja; isso é
   esperado.
5. **`src/conversation-core/` é genérico por contrato.** Testes arquiteturais proíbem importar domain
   pack, config de tenant, provider ou infraestrutura, e proíbem vocabulário de vertical (o léxico
   `paciente`, `dental`, `clinica`, `tratamento` etc. quebra o build).

---

## 8. O que queremos da análise

Em ordem de interesse:

1. **A fronteira de autorização é sólida?** Existe caminho pelo qual um fato não autorizado chegue ao
   lead? O ponto mais frágil, na nossa leitura, é o validador de texto — em particular a
   normalização e o consumo de valores em `verbalization-validator.ts`.

2. **A granularidade "uma capability por classe de resposta" é a certa?** Ou existe decomposição
   melhor — por jornada, por intenção, por estado?

3. **Recuperação como fato autorizado é um bom caminho?** A ideia em avaliação: uma base de conteúdo
   curado do tenant, recuperação **determinística** (decisão do sistema, não do modelo), e o trecho
   recuperado tratado como fato autorizado — não como contexto para o modelo raciocinar em cima. Isso
   cobriria o conjunto aberto de perguntas não transacionais sem uma capability por pergunta. O que
   quebra nesse desenho?

4. **Como expressar um próximo passo decidido pelo sistema** (§6.3) sem deixar o modelo escolhê-lo?

5. **Onde um modelo mais forte muda o resultado e onde o limite é arquitetural?** Nossa hipótese é
   que a compreensão já é suficiente e o ganho estaria na verbalização; queremos contestação.

6. **Qual a instrumentação mais barata que diria se uma mudança melhorou a conversa?** Hoje existe
   eval de intenção (95,2% no corpus rotulado) e um juiz de prosa marcado experimental e non-gating.
   Não há juiz de trajetória de conversa.

---

## 9. Referências no repositório

| Assunto | Caminho |
|---|---|
| Regras de contribuição e fontes de verdade | `AGENTS.md` |
| Arquitetura em produção | `docs/architecture/current.md` |
| Seleção de engine e ativação interna | `docs/operations/systemops-lab-runbook.md` |
| Core genérico | `src/conversation-core/` |
| Pack dental | `src/domain-packs/dental/` |
| Handler live da V2 | `src/application/conversation-v2/v2-live-conversation-handler.ts` |
| Adaptadores de modelo | `src/infrastructure/adapters/ai/` |
| Medição contra modelo real | `scripts/measure-v2-verbalization.ts` |
| Personas do Lab | `evals/systemops-lab/personas/` |
| Ciclos anteriores do programa | `docs/ai-system/cycle-*.md` |
