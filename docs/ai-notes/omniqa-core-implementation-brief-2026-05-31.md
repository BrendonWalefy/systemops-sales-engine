# SystemOps Core — Brief de Implementação omniQA + Melhoria Contínua

**Data:** 2026-05-31
**Origem:** Sessão de design omniQA × SystemOps Core
**Executar em:** systemops-core

---

## Contexto e Objetivo

O omniQA é o framework de QA do SystemOps. Ele valida o comportamento da IA antes que mudanças cheguem aos leads das clínicas. Hoje o fluxo de validação é manual — o dono do produto testa no WhatsApp pessoal e pede para clientes reportarem problemas.

Este brief cobre três fases que transformam esse processo:

1. **Fase 1** — Desbloqueadores: rotas E2E ausentes e simulate sem mock mode
2. **Fase 2** — Evolução do simulate: testar playbook ativo vs novo
3. **Fase 3** — Melhoria contínua: IA que analisa conversas e sugere melhorias de playbook

O objetivo final é um sistema que aprende com cada conversa de cada clínica e melhora continuamente a taxa de conversão de leads em agendamentos — sem intervenção manual.

---

## Fase 1 — Desbloqueadores Imediatos

### F001 — Rotas E2E não existem (Bloqueador)

**Evidência:**
- `POST /api/e2e/reset` → `404 Not Found`
- `PATCH /api/e2e/clinic/settings` → `404 Not Found`
- `find src/app -path '*api*e2e*'` não retorna nada

**Impacto:** Os testes `SYS-MENU-001..005` não conseguem preparar nem restaurar a clínica QA.

**Implementar em `src/app/api/e2e/`:**

```
src/app/api/e2e/
├── reset/route.ts
├── state/route.ts
└── clinic/settings/route.ts
```

**Regras de segurança obrigatórias para todas as rotas:**
```typescript
// Rejeitar se não estiver em E2E_MODE
if (process.env.E2E_MODE !== 'true') {
  return NextResponse.json({ error: 'not available' }, { status: 404 });
}

// Rejeitar em ambiente production-like
const host = req.headers.get('host') ?? '';
if (!host.includes('localhost') && !host.includes('127.0.0.1')) {
  return NextResponse.json({ error: 'refused in production' }, { status: 403 });
}

// Exigir secret
const secret = req.headers.get('x-e2e-secret');
if (secret !== process.env.E2E_SECRET) {
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}
```

**`POST /api/e2e/reset`**
```typescript
// Body: { runId: string }
// - Deleta conversas, leads e appointments vinculados a E2E_CLINIC_ID com runId
// - Restaura configurações da clínica para estado padrão
// - Retorna: { ok: true }
```

**`GET /api/e2e/state?runId=...`**
```typescript
// Retorna:
{
  messages: Array<{ role: 'user' | 'agent'; text: string; intent?: string }>,
  appointments: Array<{ status: string; label: string }>,
  slotOffers: Array<{ index: number; label: string }>
}
```

**`GET /api/e2e/clinic/settings`**
```typescript
// Retorna configuração atual da clínica E2E_CLINIC_ID:
{
  greetingMessage: string | null,
  menuItems: Array<{ number: number; label: string; intent: string; enabled: boolean }> | null,
  businessHours: string | null,
  takeoverTtlHours: number,
  postAppointmentBufferMinutes: number
}
```

**`PATCH /api/e2e/clinic/settings`**
```typescript
// Body: Partial<configuração acima>
// Atualiza somente os campos fornecidos para E2E_CLINIC_ID
// Retorna: { ok: true }
```

---

### F002 — Simulate ignora `DISABLE_REAL_OPENAI` (Alto)

**Evidência no código:**
- `src/app/api/playbook/simulate/route.ts` instancia `new IntentClassifier()` e `new ResponseComposer()`
- Ambas as classes hardcoded em `new OpenAI({ apiKey: process.env.OPENAI_API_KEY })`
- Nenhuma referência a `DISABLE_REAL_OPENAI` nesses caminhos

**Impacto:** `SYS-PLAYBOOK-001..009` não podem rodar em CI (custo, não-determinismo, precisa de API key real).

**Implementar em `src/app/api/playbook/simulate/route.ts`:**

Antes da chamada ao `classifier.classify()` (linha ~308), adicionar branch de mock:

```typescript
const isE2EMode = process.env.DISABLE_REAL_OPENAI === 'true' || process.env.E2E_MODE === 'true';

const classification = isE2EMode
  ? mockClassify(message, hasPendingSlotOffer)
  : await classifier.classify(message, conversationHistory, hasPendingSlotOffer);

// E para o composer:
const result = isE2EMode
  ? mockCompose(actionResult)
  : await composer.compose({ ... });
```

**`mockClassify(message, hasPendingSlotOffer): IntentClassification`**

Implementar keyword matching cobrindo os intents dos testes:

```typescript
function mockClassify(message: string, hasPendingSlotOffer: boolean): IntentClassification {
  const m = message.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  if (hasPendingSlotOffer && /^[123]$/.test(m.trim())) {
    return intent('confirm_slot', { slotChoice: Number(m.trim()) });
  }
  if (/agendar|marcar|quero horario|quero uma consulta/.test(m)) return intent('book_appointment');
  if (/quanto|preco|valor|custo|caro|plano|parcel/.test(m)) return intent('price_inquiry');
  if (/dor|urgente|urgencia|sangrament|emergencia/.test(m)) return intent('clinical_urgency');
  if (/falar com|dentista|humano|especialista|ligar/.test(m)) return intent('needs_human');
  if (/tchaau|tchau|ate mais|ate logo|obrigado tchau/.test(m)) return intent('farewell');
  if (/ok|blz|entendi|certo|combinado/.test(m)) return intent('acknowledgment');
  if (/horario|disponib|vaga/.test(m)) return intent('check_availability');

  return intent('general_question');
}

function intent(type: IntentType, extra: Partial<IntentClassification> = {}): IntentClassification {
  return {
    intent: type,
    slotPreference: { preferredDate: null, preferredPeriod: null, preferredTime: null, slotChoice: extra.slotPreference?.slotChoice ?? null, identifiedTreatment: null },
    confidence: 1,
    shouldAskClarification: false,
    clarificationQuestion: null,
    handoffReason: null,
    ...extra,
  };
}
```

**`mockCompose(actionResult): ComposedResponse`**

Retornar texto fixo por tipo — não precisa ser bonito, só determinístico:

```typescript
function mockCompose(actionResult: ActionResult): ComposedResponse {
  const texts: Record<string, string> = {
    slots_found: '[MOCK] Tenho estes horários:\n1. Seg 02/Jun às 09h00\n2. Ter 03/Jun às 10h30\n3. Qua 04/Jun às 14h00\nQual opção prefere? Responda com o número.',
    appointment_confirmed: '[MOCK] Agendamento confirmado! Nossa equipe estará esperando por você.',
    price_inquiry: '[MOCK] A avaliação inicial é gratuita. Os valores variam conforme o caso e podem ser parcelados.',
    clinical_urgency: '[MOCK] Entendo que é urgente. Vou acionar a equipe imediatamente e alguém entrará em contato.',
    handoff_requested: '[MOCK] Claro! Já avisei a equipe e alguém irá responder em breve.',
    farewell: '[MOCK] Foi um prazer! Qualquer dúvida, é só chamar.',
    acknowledgment: '[MOCK] Certo! Posso ajudar com mais alguma coisa?',
    general_question: '[MOCK] Vou te ajudar com essa dúvida sobre nossa clínica.',
  };
  return {
    text: texts[actionResult.type] ?? '[MOCK] Estou aqui para ajudar.',
    model: 'mock',
    promptVersion: 'mock-v1',
    inputTokens: 0,
    outputTokens: 0,
  };
}
```

**Também corrigir em `buildPlaybookText` (linha ~149):**

Objeções com `response` vazio geram `Resposta: ` no prompt:
```typescript
// Antes:
.map((o) => [`Objeção: ${o.objection}`, o.response.trim() ? `Resposta: ${o.response}` : null].filter(Boolean).join('\n'))

// Já está correto na lógica mas verificar se o .trim() está sendo aplicado antes de concatenar
// Se não estiver, adicionar: o.response?.trim() ?? ''
```

**Adicionar campo `debug` quando `E2E_MODE=true`:**

```typescript
// No retorno do POST handler, antes do return final:
const debugInfo = process.env.E2E_MODE === 'true' ? {
  playbookBlocksUsed: [
    playbook.specialty ? 'specialty' : null,
    playbook.procedureDescription ? 'procedureDescription' : null,
    (playbook.differentials?.length ?? 0) > 0 ? 'differentials' : null,
    (playbook.objections?.length ?? 0) > 0 ? 'objections' : null,
    playbook.commercialPolicy ? 'commercialPolicy' : null,
  ].filter(Boolean)
} : undefined;

return NextResponse.json({ text: result.text, intent: classification.intent, ...(debugInfo ? { debug: debugInfo } : {}) });
```

---

### F003 — Variáveis QA ausentes (Médio)

Criar `.env.e2e.example` na raiz do projeto:

```bash
# .env.e2e.example — copie para .env.local e preencha para rodar QA local

# Identidade da clínica de testes
PILOT_CLINIC_ID="uuid-da-clinica-piloto"
E2E_CLINIC_ID="uuid-da-clinica-piloto"

# Admin de testes
ADMIN_EMAIL="qa-admin@systemops.local"
ADMIN_PASSWORD="qa-admin-pass"

# Flags de modo QA
E2E_MODE="true"
E2E_SECRET="local-e2e-scheduling-secret"
DISABLE_REAL_WHATSAPP_SEND="true"
DISABLE_REAL_OPENAI="true"        # false para validação completa com LLM real

# Para validação completa com LLM real (SYSTEMOPS_RUN_LLM_SANDBOX=true no omniQA)
OPENAI_API_KEY=""

# Para slots reais no sandbox (opcional mas recomendado)
QA_GOOGLE_CALENDAR_ID=""

# Segurança do simulate
SIMULATE_API_KEY="local-simulate-key"
```

---

### F004 — Erro de validação retorna 500 (Baixo)

Em `src/app/(admin)/agenda/actions.ts` (ou onde `createBlock` está definido):

```typescript
// Antes: throw new Error("Horario de fim deve ser apos o inicio")
// Depois: retornar estado controlado
if (endTime <= startTime) {
  return { error: 'Horário de fim deve ser após o início' };
}
```

O server action deve retornar `{ error: string }` em vez de fazer throw para erros de validação de formulário esperados.

---

## Fase 2 — Evolução do Simulate

### Modo 1: Testar playbook ativo via `clinicId`

**Objetivo:** Permitir que o omniQA teste o comportamento da IA com o playbook que está em produção agora, sem precisar passar o playbook no body.

**Modificar `src/app/api/playbook/simulate/route.ts`:**

```typescript
type SimulateBody = {
  message: string;
  history: Array<{ role: 'user' | 'assistant'; text: string; intent?: string }>;
  // Modo 1: clinicId → busca playbook ativo do banco
  clinicId?: string;
  // Modo 2: playbook → usa o fornecido (comportamento atual)
  playbook?: { ... };
};
```

No handler, após validação de auth:

```typescript
let resolvedPlaybook: SimulateBody['playbook'];

if (body.clinicId) {
  // Modo 1: busca playbook publicado do banco
  const published = await db
    .select()
    .from(playbookVersions)
    .where(and(eq(playbookVersions.clinicId, body.clinicId), eq(playbookVersions.status, 'published')))
    .orderBy(desc(playbookVersions.createdAt))
    .limit(1)
    .then(r => r[0]);

  if (!published) {
    return NextResponse.json({ error: 'no published playbook found' }, { status: 404 });
  }

  resolvedPlaybook = {
    specialty: published.specialty,
    procedureDescription: published.procedureDescription,
    toneOfVoice: published.toneOfVoice,
    differentials: published.differentials ?? [],
    commercialPolicy: published.commercialPolicy ?? '',
    objections: published.objections ?? [],
    greetingMessage: published.greetingMessage ?? '',
  };
} else if (body.playbook) {
  resolvedPlaybook = body.playbook;
} else {
  return NextResponse.json({ error: 'clinicId or playbook required' }, { status: 400 });
}
```

### Contrato: `intent` obrigatório nas mensagens de assistant

```typescript
// Antes (permite omitir):
history: Array<{ role: 'user' | 'assistant'; text: string; intent?: string }>

// Depois (validar no handler):
const assistantWithoutIntent = body.history.filter(
  h => h.role === 'assistant' && !h.intent
);
if (assistantWithoutIntent.length > 0) {
  return NextResponse.json({ error: 'intent required in assistant history messages' }, { status: 400 });
}
```

### Response: campo `slots` estruturado

```typescript
// Adicionar ao tipo de retorno:
type SimulateResponse = {
  text: string;
  intent: string;
  slots?: Array<{ index: number; label: string; startsAt: string; endsAt: string }>;
  debug?: { playbookBlocksUsed: string[] };
};

// Incluir slots quando relevante:
const shouldIncludeSlots = ['book_appointment', 'check_availability', 'reject_slots', 'confirm_slot', 'reschedule_appointment'].includes(classification.intent);

return NextResponse.json({
  text: result.text,
  intent: classification.intent,
  ...(shouldIncludeSlots ? { slots } : {}),
  ...(debugInfo ? { debug: debugInfo } : {}),
});
```

### Segurança: rejeitar sem `SIMULATE_API_KEY`

```typescript
// Antes: aceita tudo se a variável não estiver definida
if (SIMULATE_API_KEY) { ... }

// Depois: modo permissivo é opt-in explícito
const allowUnauthenticated = process.env.SIMULATE_ALLOW_UNAUTHENTICATED === 'true';
if (!allowUnauthenticated) {
  if (!SIMULATE_API_KEY) {
    return NextResponse.json({ error: 'SIMULATE_API_KEY not configured' }, { status: 500 });
  }
  const key = req.headers.get('x-simulate-key');
  if (key !== SIMULATE_API_KEY) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
}
```

---

## Fase 3 — Melhoria Contínua (Playbook Advisor)

> Esta fase transforma o SystemOps de uma ferramenta que o admin configura manualmente para um sistema que aprende com cada conversa e melhora a taxa de conversão de leads.

### Arquitetura

```
Conversas reais (DB)
        ↓
MetricsAggregator (job periódico)
        ↓
PlaybookAdvisor (Claude analisa métricas)
        ↓
Sugestão + confidence score
        ↓
Pipeline de validação (simulate + omniQA)
        ↓
Interface de revisão no admin (publica ou descarta)
```

### 3.1 — MetricsAggregator

**Criar `src/core/intelligence/MetricsAggregator.ts`:**

```typescript
export type ClinicMetrics = {
  clinicId: string;
  period: { from: Date; to: Date };
  totalConversations: number;
  unclearRate: number;                    // % de mensagens classificadas como 'unclear'
  topUnclearMessages: string[];           // top 10 mensagens não classificadas
  needsHumanRate: number;                 // % de conversas que pediram humano
  needsHumanReasons: string[];            // motivos mais frequentes
  dropOffAfterSlotsRate: number;          // % de conversas que pararam após oferta de slots
  priceInquiryToBookingRate: number;      // conversão preço → agendamento
  objectionTriggerCounts: Record<string, number>; // objeções que apareceram sem resposta
  frequentQuestionsWithoutAnswer: string[]; // perguntas frequentes sem cobertura no playbook
};

export class MetricsAggregator {
  async aggregate(clinicId: string, days = 30): Promise<ClinicMetrics> {
    // Lê conversas do banco no período
    // Calcula métricas derivadas das mensagens e intents
    // Identifica padrões de drop-off e gaps de cobertura
  }
}
```

**Criar cron job em `src/app/api/cron/metrics-aggregate/route.ts`:**

```typescript
// Rodar diariamente para todas as clínicas ativas
// Salvar resultado em tabela clinic_metrics (nova migration)
// Protegido por CRON_SECRET
```

**Migration necessária:**

```sql
CREATE TABLE clinic_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id UUID NOT NULL REFERENCES clinics(id),
  period_from TIMESTAMP NOT NULL,
  period_to TIMESTAMP NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### 3.2 — PlaybookAdvisor

**Criar `src/core/intelligence/PlaybookAdvisor.ts`:**

```typescript
export type PlaybookGap = {
  type: 'missing_objection' | 'missing_faq' | 'unclear_scenario' | 'low_conversion' | 'wrong_tone';
  description: string;           // "18% das mensagens perguntam sobre convênio sem resposta"
  evidence: string[];            // mensagens reais que evidenciam o gap (anonimizadas)
  suggestion: string;            // o que adicionar/mudar no playbook
  impactEstimate: 'high' | 'medium' | 'low';
};

export type AdvisorResult = {
  gaps: PlaybookGap[];
  proposedPlaybook: PlaybookVersion;  // versão melhorada para validar
  confidenceScore: number;            // 0-1
  reasoning: string;                  // justificativa em linguagem natural
};

export class PlaybookAdvisor {
  async analyze(clinicId: string, metrics: ClinicMetrics, currentPlaybook: PlaybookVersion): Promise<AdvisorResult> {
    // Usa Claude (claude-haiku-4-5) para analisar métricas e gerar sugestões
    // Prompt inclui: playbook atual + métricas + exemplos de mensagens problemáticas
    // Retorna gaps identificados + playbook proposto + justificativa
  }
}
```

**Usar Claude como advisor (independência do modelo):**

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const response = await client.messages.create({
  model: 'claude-sonnet-4-6',  // Sonnet: raciocina sobre padrões de negócio; Haiku insuficiente para gaps complexos
  max_tokens: 2000,
  messages: [{
    role: 'user',
    content: buildAdvisorPrompt(metrics, currentPlaybook)
  }]
});
```

**Variável de ambiente necessária:**
```bash
ANTHROPIC_API_KEY=""   # adicionar ao .env.e2e.example e ao Vercel
```

### 3.3 — Pipeline de Validação Automática

**Criar `src/app/api/playbook/advisor/validate/route.ts`:**

```typescript
// POST com { clinicId, proposedPlaybook }
// 1. Busca cenários de teste salvos para esta clínica (ou usa cenários genéricos)
// 2. Roda cada cenário contra o proposedPlaybook via simulate (chamada interna)
// 3. Retorna: { passed: number; total: number; failures: Array<{ scenario; expected; actual }> }
```

Cenários genéricos de validação (sempre rodar antes de sugerir ao admin):

```typescript
const BASELINE_SCENARIOS = [
  { message: 'oi', expectedIntent: 'greeting' },
  { message: 'quero agendar', expectedIntent: 'book_appointment' },
  { message: 'quanto custa', expectedIntent: 'price_inquiry' },
  { message: 'estou com dor', expectedIntent: 'clinical_urgency' },
  { message: 'obrigado tchau', expectedIntent: 'farewell' },
];
```

### 3.4 — Interface de Revisão no Admin

**Criar página `src/app/(admin)/playbook/suggestions/page.tsx`:**

Exibir para cada sugestão:
- Gap identificado com evidências (mensagens reais anonimizadas)
- Justificativa em linguagem natural
- Confidence score visual (barra ou badge)
- Resultado da validação automática: "9/9 cenários passaram"
- Diff do playbook: o que vai mudar
- Botão **Publicar nova versão** ou **Descartar**

**Regra:** Nunca auto-publicar. O admin sempre aprova. O sistema nunca publica sem confirmação humana.

---

## Variáveis de Ambiente — Resumo Completo

```bash
# Fase 1 — QA local
E2E_MODE="true"
E2E_SECRET="local-e2e-scheduling-secret"
E2E_CLINIC_ID="uuid"
PILOT_CLINIC_ID="uuid"
ADMIN_EMAIL="qa-admin@systemops.local"
ADMIN_PASSWORD="qa-admin-pass"
DISABLE_REAL_WHATSAPP_SEND="true"
DISABLE_REAL_OPENAI="true"

# Fase 1 — Simulate
SIMULATE_API_KEY="chave-segura"
SIMULATE_ALLOW_UNAUTHENTICATED="false"  # nunca true em produção

# Fase 2 — Validação completa com LLM real
OPENAI_API_KEY="sk-..."
QA_GOOGLE_CALENDAR_ID="calendar-id-de-testes"

# Fase 3 — Playbook Advisor
ANTHROPIC_API_KEY="sk-ant-..."
```

---

## Critérios de Aceitação por Fase

### Fase 1 — Concluída quando:
```sh
SYSTEMOPS_BASE_URL=http://localhost:3000 \
SYSTEMOPS_E2E_SECRET=local-e2e-scheduling-secret \
SYSTEMOPS_RUN_DESTRUCTIVE=true \
npx playwright test --project=systemops-api \
  targets/systemops/api/specs/menu.spec.ts \
  --workers=1 --reporter=list
# Esperado: SYS-MENU-001..005 passam

DISABLE_REAL_OPENAI=true \
SYSTEMOPS_RUN_LLM_SANDBOX=true \
npx playwright test --project=systemops-api \
  targets/systemops/api/specs/playbook-sandbox.spec.ts \
  --workers=1 --reporter=list
# Esperado: SYS-PLAYBOOK-001..009 passam com mock
```

### Fase 2 — Concluída quando:
```sh
# Modo 1: testar playbook ativo via clinicId
curl -X POST http://localhost:3000/api/playbook/simulate \
  -H "x-simulate-key: local-simulate-key" \
  -H "Content-Type: application/json" \
  -d '{"clinicId":"uuid","message":"oi","history":[]}'
# Esperado: retorna greetingMessage da clínica + intent: "greeting"

# Slots estruturados na response
curl ... -d '{"clinicId":"uuid","message":"quero agendar","history":[]}'
# Esperado: response contém campo "slots": [{ index, label, startsAt, endsAt }]
```

### Fase 3 — Concluída quando:
- Job de métricas roda sem erro e salva na tabela `clinic_metrics`
- `PlaybookAdvisor.analyze()` retorna `AdvisorResult` válido com pelo menos um gap identificado para uma clínica com histórico
- Pipeline de validação roda os 5 cenários baseline e retorna resultado estruturado
- Página de sugestões no admin exibe gaps com evidências e botão de publicação funciona

---

## Ordem de Execução Recomendada

```
F002 (mock mode) → F001 (rotas E2E) → F003 (.env.example) → F004 (500 → validação)
→ Fase 2 (clinicId + slots + segurança)
→ Fase 3 (metrics → advisor → validação → UI)
```

F002 primeiro porque desbloqueia os testes de playbook no CI imediatamente, sem depender de infra nova.
