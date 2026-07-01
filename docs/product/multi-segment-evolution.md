# Evolução Multi-Segmento do Core

**Status:** Planejado — próximo ciclo de desenvolvimento  
**Última revisão:** 2026-06-30

Este documento define o plano concreto para tornar o `systemops-sales-engine` capaz de
operar qualquer segmento de negócio sem reescrever o runtime.

O sistema já funciona. O trabalho aqui não é refatoração por elegância — é
desbloqueio comercial. Clientes de outros segmentos já estão batendo na porta.

---

## Premissas

1. Multi-tenancy já está correto. Não mexa.
2. O pipeline de inbox/outbox, jobs e retry não precisa mudar.
3. O que precisa mudar é o vocabulário exposto — prompts, UI, automações —
   não a estrutura de dados central.
4. Generalizar sem um segundo cliente real gera abstração errada. O atelier
   é o segundo cliente âncora. Use-o como validação concreta.

---

## O que precisa mudar — por área

### 1. Vocabulário em prompts

**Situação atual:** o system prompt do agente fala em "recepcionista virtual",
"clínica", "consulta", "tratamento", "paciente".

**O que fazer:**
- Substituir termos fixos por variáveis derivadas da configuração do tenant
- Os campos `serviceNoun`, `segment`, `specialty` já existem no banco
- Criar um `PromptContextBuilder` que monta o vocabulário correto por tenant
  antes de compor qualquer prompt
- Exemplos de substituição:

| Hoje (fixo) | Derivado de config |
|---|---|
| "recepcionista virtual" | `agentRole` configurável por tenant |
| "tratamento" | `serviceNoun` |
| "consulta" | `bookingNoun` (novo campo sugerido) |
| "clínica" | `businessName` do tenant |
| "paciente" | `contactNoun` (novo campo sugerido) |

### 2. IntentClassifier

**Situação atual:** os intents estão hardcoded para fluxo de clínica:
`book_appointment`, `check_availability`, `confirm_slot`, `clinical_urgency`,
`patient_arrived`.

**O que fazer:**
- Separar intents universais de intents segment-specific
- Intents universais (existem em qualquer segmento):
  - `request_service` (equivalente a `book_appointment`)
  - `check_availability`
  - `confirm_offer`
  - `cancel_or_reschedule`
  - `request_information`
  - `express_dissatisfaction`
  - `needs_human`
- Intents segment-specific (ativados por capability):
  - `clinical_urgency` → capability: `scheduling.clinical`
  - `patient_arrived` → capability: `scheduling.clinical`
  - `request_quote_with_art` → capability: `commercial.atelier`
- O classifier recebe a lista de intents ativos para o tenant, não uma lista
  estática hardcoded

### 3. Capabilities como módulos opcionais

**Situação atual:** scheduling, follow-up, reminders e urgência estão
entrelaçados no fluxo principal.

**O que fazer (em ordem de prioridade):**

#### 3a. Scheduling como capability opcional
- Criar um flag `capabilities.scheduling.enabled` por tenant
- Quando desabilitado, o agente não oferece horários nem acessa o calendário
- O fluxo de conversa vai até `request_service` e registra como lead qualificado
  sem booking
- Segmentos como atelier não têm agenda de recurso — eles têm prazo de entrega

#### 3b. Follow-up como capability opcional
- Cadência de follow-up já é configurável, mas ainda pressupõe funil de consulta
- Generalizar para: `followup.trigger` (qual evento dispara), `followup.noun`
  (o que está sendo seguido), `followup.cta` (chamada para ação configurável)

#### 3c. Reminders como capability opcional
- Appointment reminders só fazem sentido com scheduling ativo
- Guardar dentro do módulo de scheduling, não no core do fluxo

#### 3d. Urgência como capability opcional
- `clinical_urgency` e `needs_human` por regra de saúde são específicos de clínica
- Generalizar para: `urgency.rules` — lista de condições que forçam handoff humano
- Cada tenant configura suas próprias regras de urgência

### 4. UI e onboarding do owner

**Situação atual:** o painel do owner usa linguagem de clínica em menus,
labels, wizards e templates.

**O que fazer:**
- Criar um `UIContext` derivado da configuração do tenant
- Campos que devem ser configuráveis: `serviceNoun`, `bookingNoun`,
  `contactNoun`, `agentRole`, `businessDescriptor`
- O wizard de onboarding começa com a seleção do segmento (ou pack)
- O pack define os defaults — o owner pode sobrescrever qualquer campo depois

### 5. Dashboard e métricas

**Situação atual:** os indicadores do dashboard medem prontidão de operação
clínica: `taxa de agendamento`, `leads sem resposta`, `conversões para consulta`.

**O que fazer:**
- Generalizar labels: `taxa de conversão` em vez de `taxa de agendamento`
- `contatos sem resposta` em vez de `leads sem resposta`
- `operações abertas` em vez de `consultas marcadas`
- A métrica em si não muda — só o vocabulário exposto ao owner

---

## Novos campos sugeridos no schema

Esses campos complementam os que já existem (`serviceNoun`, `segment`,
`specialty`):

| Campo | Tipo | Descrição |
|---|---|---|
| `bookingNoun` | string | Como chamar o ato de reservar (ex: "consulta", "pedido", "visita") |
| `contactNoun` | string | Como chamar o contato (ex: "paciente", "cliente", "lead") |
| `agentRole` | string | Como o agente se apresenta (ex: "recepcionista", "atendente", "assistente") |
| `businessDescriptor` | string | Frase curta que descreve o negócio para o agente |
| `capabilities` | jsonb | Mapa de capabilities ativas e suas configurações |
| `urgencyRules` | jsonb | Lista de condições que forçam handoff humano |

---

## Sequência de implementação recomendada

Esta sequência minimiza risco de regressão e entrega valor a cada passo.

```
Etapa 1 — PromptContextBuilder
  → todos os prompts deixam de usar termos fixos
  → validar com tenant de clínica (deve funcionar igual)
  → validar com configuração de atelier (deve funcionar diferente)

Etapa 2 — IntentClassifier configurável
  → separar intents universais de segment-specific
  → validar que fluxo de clínica não regride
  → validar que atelier usa apenas intents universais + seus específicos

Etapa 3 — Scheduling como capability opcional
  → criar flag e desabilitar scheduling para tenant de teste
  → fluxo continua até lead qualificado sem booking
  → reminders e calendar sync ficam dentro do módulo de scheduling

Etapa 4 — UI vocabulary configurável
  → labels do painel derivam de configuração do tenant
  → wizard de onboarding com seleção de segmento

Etapa 5 — Segment packs
  → pack `clinic`: defaults atuais do sistema
  → pack `atelier`: defaults documentados em segments/atelier-costura.md
  → pack é ponto de partida, não restrição

Etapa 6 — Validação com segundo cliente real
  → onboardar o atelier de costura/bordados em ambiente de demo
  → registrar gaps encontrados e corrigir antes de abrir para novos segmentos
```

---

## Critério de sucesso

O core está pronto para multi-segmento quando:

1. Um novo tenant de segmento diferente (não clínica) pode ser onboardado sem
   alterar nenhuma linha de código de runtime
2. O agente opera com vocabulário correto para o segmento do tenant
3. O tenant de clínica não sofre nenhuma regressão de comportamento
4. O wizard de onboarding permite selecionar o segmento e aplica defaults
   corretos automaticamente

---

## Leitura complementar

- `docs/product/segments/atelier-costura.md` — caso de uso concreto do segundo segmento
- `docs/architecture/target-architecture.md` — desenho da arquitetura 2.0
- `docs/product/multi-segment.md` — diagnóstico de gaps do sistema atual
- `systemops-platform/docs/architecture/adr-004-multi-product-platform-vision.md`
- `systemops-platform/docs/product/roadmap.md`
