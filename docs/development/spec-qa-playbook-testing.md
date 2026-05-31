# Spec: QA Playbook Testing — Sandbox como Espelho de Produção + Ferramenta de Validação

**Status:** Spec aprovado, implementação pendente  
**Prioridade:** Alta — viabiliza onboarding escalonável de novas clínicas  
**Contexto:** O sandbox `/app/settings/playbook/[id]` já existe com chat simulado. Este spec expande para (a) garantir paridade total com produção e (b) adicionar camada de QA estruturada.

---

## Visão do produto

Operadores precisam de confiança antes de ligar o WhatsApp de uma nova clínica. Hoje a validação é subjetiva ("parece bom"). Com este sistema:

1. O operador roda um script de cenários padronizados antes do go-live
2. Cada resposta da IA é comparada com o intent esperado — passa ou falha
3. Ao aprovar, gera-se um snapshot do playbook + resultado dos testes (contrato de comportamento)
4. Ajustes pós-go-live são testados em sandbox antes de aplicar em produção

Diferencial de venda: **mostrar ao cliente exatamente como a IA vai responder antes de assinar o contrato.**

---

## Fase 0 — Sandbox = Espelho de Produção (pré-requisito)

> **Deve ser feito antes de qualquer outra fase.** Sem paridade, os testes não têm valor.

### O problema atual

O `simulate/route.ts` tem lógica própria que diverge do pipeline real:

| Ponto | Sandbox atual | Produção |
|---|---|---|
| `hasPendingSlotOffer` | regex no texto das mensagens | `ConversationStateMachine` (estado no banco) |
| Primeiro contato | retorna `greetingMessage` diretamente | igual — ok |
| "menu" mid-conversa | atalho direto para `greetingMessage` | `greeting` intent → ResponseComposer compõe |
| `greetingMessage` no greeting intent | não enviado ao ResponseComposer | não enviado (mesma lacuna) |

### Implementação

**1. Passar `intent` no histórico (client → server)**

Em [editor-client.tsx](../../src/app/(clinic)/app/settings/playbook/[id]/editor-client.tsx), o tipo `ChatMessage` já tem `intent?: string`. Garantir que o campo seja enviado no corpo da requisição:

```ts
// SimulateBody["history"] — atualizar o tipo no route.ts
history: { role: "user" | "assistant"; text: string; intent?: string }[];
```

**2. Substituir regex por intent-based detection**

```ts
// Antes (frágil — fazia match na saudação)
const hasPendingSlotOffer = history.some(
  (h) => h.role === "assistant" && /\d\.\s.+às\s\d{2}h\d{2}/.test(h.text),
);

// Depois (espelho da state machine)
const hasPendingSlotOffer = history.some(
  (h) => h.role === "assistant" && h.intent === "slots_found",
);
```

**3. Passar `greetingMessage` ao ResponseComposer (sandbox e produção)**

Adicionar campo `greetingMessage?: string | null` ao objeto `clinic` no `compose()`:

```ts
// ResponseComposer.ts — ClinicContext
type ClinicContext = {
  name: string;
  specialty: string;
  toneOfVoice: string;
  playbook: string | null;
  commercialPolicy: string | null;
  greetingMessage?: string | null; // novo
};
```

No instruction builder do `greeting`:

```ts
case "greeting":
  const menuContext = clinic.greetingMessage
    ? `\nMENU CONFIGURADO DA CLÍNICA (re-exiba se o lead pediu "menu" ou quer ver as opções):\n${clinic.greetingMessage}`
    : "";
  return `AÇÃO EXECUTADA: Lead enviou saudação...${menuContext}`;
```

**4. Atualizar o Orchestrator de produção**

No `ConversationOrchestrator`, ao chamar `ResponseComposer.compose()`, incluir `greetingMessage: clinic.greetingMessage`. Isso garante que sandbox e produção passam o mesmo contexto para o LLM.

**5. Remover atalho "menu" do simulate/route.ts**

O atalho `if (classification.intent === "greeting" && playbook.greetingMessage.trim()) return ...` deve ser removido. O comportamento correto passa pelo LLM com o contexto da `greetingMessage`, igual à produção.

---

## Fase 1 — Scripts de Teste por Clínica

### Conceito

Um script é uma sequência ordenada de mensagens com intent esperado declarado pelo operador. O sandbox executa cada mensagem e compara o intent retornado com o esperado.

### Schema do banco

```sql
-- scripts de teste salvos por clínica
CREATE TABLE qa_test_scripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                          -- "Cenário: objeção de preço"
  description TEXT,
  messages JSONB NOT NULL,                     -- ver estrutura abaixo
  vertical TEXT,                               -- "odonto", "estetica", etc. (para scripts padrão)
  is_template BOOLEAN DEFAULT FALSE,           -- scripts padrão copiados para a clínica
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- estrutura de messages (JSONB)
-- [
--   { "from": "lead", "text": "oi", "expectedIntent": "greeting" },
--   { "from": "lead", "text": "quanto custa implante?", "expectedIntent": "price_inquiry" },
--   { "from": "lead", "text": "tá caro", "expectedIntent": "price_inquiry" },
--   { "from": "lead", "text": "quero agendar", "expectedIntent": "book_appointment" },
--   { "from": "lead", "text": "1", "expectedIntent": "confirm_slot" }
-- ]

-- execuções de scripts (histórico de runs)
CREATE TABLE qa_test_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  script_id UUID NOT NULL REFERENCES qa_test_scripts(id) ON DELETE CASCADE,
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  playbook_id UUID REFERENCES playbook_versions(id),  -- snapshot do playbook testado
  results JSONB NOT NULL,                              -- resultado de cada step
  passed_count INT NOT NULL,
  failed_count INT NOT NULL,
  approved_by TEXT,                                    -- email do operador que aprovou
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- estrutura de results (JSONB)
-- [
--   { "step": 1, "message": "oi", "expectedIntent": "greeting", "actualIntent": "greeting", "passed": true, "response": "Olá!..." },
--   { "step": 2, "message": "quanto custa", "expectedIntent": "price_inquiry", "actualIntent": "price_inquiry", "passed": true, "response": "..." },
--   { "step": 3, "message": "1", "expectedIntent": "confirm_slot", "actualIntent": "acknowledgment", "passed": false, "response": "..." }
-- ]
```

### API

```
POST /api/qa/scripts                  — criar script
GET  /api/qa/scripts?clinicId=...     — listar scripts da clínica
GET  /api/qa/scripts/templates        — scripts padrão por vertical
POST /api/qa/scripts/:id/run          — executar script completo, salva run
POST /api/qa/runs/:id/approve         — aprovar run (marca approved_by + approved_at)
GET  /api/qa/runs?scriptId=...        — histórico de runs de um script
```

### Endpoint de execução (`POST /api/qa/scripts/:id/run`)

Executa cada step sequencialmente, mantendo o histórico acumulado entre steps (igual ao chat manual). Chama `POST /api/playbook/simulate` internamente ou extrai a função de classificação para reutilização direta.

**Importante:** não paralelizar — cada mensagem depende do histórico anterior.

---

## Fase 2 — UI: Painel de QA

### Localização

Aba "Testes" dentro de `/app/settings/playbook/[id]` (ao lado do chat livre atual).

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  SCRIPTS DE TESTE              [+ Novo Script]  [Templates] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ○ Cenário: Objeção de preço       12/12 ✓  [▶ Rodar]     │
│  ○ Cenário: Agendamento completo    8/10 ✗  [▶ Rodar]     │
│  ○ Cenário: Lead urgência           5/5 ✓  [▶ Rodar]      │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  RESULTADO DO ÚLTIMO RUN — "Cenário: Objeção de preço"     │
│  Executado em 01/06 às 14:32 · Aprovado por brendon@...    │
│                                                             │
│  ✓ 1. "oi"              esperado: greeting    → greeting   │
│  ✓ 2. "quanto custa"    esperado: price_inq   → price_inq  │
│  ✗ 3. "1"               esperado: confirm_sl  → acknowledg │
│  ✓ 4. "quero agendar"   esperado: book_appt   → book_appt  │
│                                                             │
│  [Aprovar este resultado]   [Ver histórico de runs]        │
└─────────────────────────────────────────────────────────────┘
```

### Comportamento

- **Verde/vermelho** por step: intent esperado vs real
- **Texto da resposta** expansível por step (clique para ver)
- **Botão Aprovar** ativo somente quando todos os steps passaram
- **Histórico de runs** mostra evolução: passou para piorar após mudança de playbook?
- **Templates** são scripts padrão por vertical que o operador clona e personaliza

---

## Fase 3 — Templates por Vertical

Scripts padrão pré-definidos que cobrem os cenários mais comuns de cada vertical. O operador clona o template e ajusta para a clínica específica.

### Template "Odontologia Padrão" (15 cenários)

```jsonc
[
  // Saudação e menu
  { "text": "oi",                          "expectedIntent": "greeting" },
  { "text": "menu",                        "expectedIntent": "greeting" },

  // Informações
  { "text": "quais procedimentos vocês fazem?", "expectedIntent": "general_question" },
  { "text": "quanto custa implante?",      "expectedIntent": "price_inquiry" },
  { "text": "tem plano odontológico?",     "expectedIntent": "price_inquiry" },
  { "text": "onde vocês ficam?",           "expectedIntent": "general_question" },

  // Agendamento
  { "text": "quero agendar uma consulta",  "expectedIntent": "book_appointment" },
  { "text": "1",                           "expectedIntent": "confirm_slot" },  // (após oferta de slots)
  { "text": "outro horário por favor",     "expectedIntent": "reject_slots" },

  // Objeções
  { "text": "tá muito caro",               "expectedIntent": "price_inquiry" },
  { "text": "vou pensar",                  "expectedIntent": "acknowledgment" },

  // Urgência
  { "text": "tô com dor de dente",         "expectedIntent": "clinical_urgency" },

  // Handoff
  { "text": "quero falar com o dentista",  "expectedIntent": "needs_human" },
  { "text": "me manda as fotos",           "expectedIntent": "needs_human" },

  // Encerramento
  { "text": "obrigado tchau",              "expectedIntent": "farewell" }
]
```

### Outras verticais planejadas
- Clínica estética (botox, preenchimento)
- Psicologia / saúde mental
- Fisioterapia

---

## Fase 4 — Aprovação Formal e Histórico de Versões

### Fluxo de aprovação pré-go-live

```
Operador edita playbook
  → Roda script padrão da vertical
  → Todos os steps passam
  → Clica "Aprovar versão"
  → Sistema salva snapshot: { playbookId, runId, passedCount, approvedBy, approvedAt }
  → Status do playbook muda para "aprovado"
  → Notificação interna: "Playbook da Clínica X aprovado e pronto para ativação"
```

### Bloqueio opcional

Configuração global: `REQUIRE_QA_APPROVAL_BEFORE_ACTIVATE = true` — impede ativar um playbook sem pelo menos um run aprovado. Útil para garantir padrão de qualidade em escala.

### Histórico de versões + cobertura de testes

Na listagem de versões do playbook, mostrar ao lado de cada versão:
- Quantidade de scripts executados
- Última aprovação
- Badge "sem cobertura de testes" quando nunca foi testado

---

## Fase 5 — Modo de Depuração Avançado

Extensões para operadores avançados:

**Breakdown de contexto enviado ao LLM:** Botão "Ver prompt" que exibe exatamente o que foi enviado ao IntentClassifier e ao ResponseComposer naquele turn. Essencial para entender por que a IA classifica errado.

**Override manual de intent:** O operador pode forçar um intent diferente do classificado para ver como o ResponseComposer responderia. Útil para testar o composer de forma isolada.

**Comparação A/B:** Rodar o mesmo script em dois playbooks diferentes lado a lado e comparar respostas. Útil ao decidir entre duas versões de comercialPolicy ou tom de voz.

**Replay de conversa real:** Importar uma conversa real do WhatsApp (histórico de mensagens) e re-executar no sandbox com o playbook atual para ver se o comportamento seria diferente.

---

## Infraestrutura de testes existente

### Google Calendar de QA
Service account: `systemops-calendar@systemops-497316.iam.gserviceaccount.com` (mesmo usado em produção).
O omniQA framework já usa esta conta para testes E2E de agendamento. Adicionar env var:

```bash
# .env.local / Vercel
QA_GOOGLE_CALENDAR_ID=""   # Calendar separado para testes — nunca usar o da Ximendes
```

A Fase 1 do sandbox com scripts de teste pode chamar agendamentos reais neste calendar, tornando os testes de `confirm_slot` end-to-end em vez de fake.

### Instância Z-API de testes
Variáveis para uma segunda instância Z-API (número de WhatsApp de testes), independente da instância de produção:

```bash
# .env.local / Vercel
ZAPI_TEST_INSTANCE_ID=""
ZAPI_TEST_TOKEN=""
ZAPI_TEST_CLIENT_TOKEN=""
ZAPI_TEST_PHONE=""   # número do WhatsApp de testes
```

Com isso, o sandbox pode opcionalmente enviar mensagens reais via WhatsApp de testes, permitindo validar o fluxo completo (webhook → Orchestrator → Z-API) sem afetar leads reais.

---

## Dependências técnicas

- Fase 0: nenhuma (refactor do simulate/route.ts + ResponseComposer)
- Fase 1: migration + repositório + API endpoints
- Fase 2: componentes UI (pode usar o design system atual)
- Fase 3: seed de templates no banco
- Fase 4: campo `approved_at` + lógica de bloqueio opcional
- Fase 5: nenhum schema novo, apenas expansão de UI

## Ordem de implementação recomendada

1. **Fase 0** (hoje) — paridade de produção
2. **Fase 1 + 2 + 3** (próximo sprint) — MVP do QA: scripts, UI, templates odonto
3. **Fase 4** (antes de vender segunda clínica) — aprovação formal
4. **Fase 5** (quando tiver demanda) — ferramentas avançadas
