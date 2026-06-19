# Spec: Pipeline de Receita + Controle de Acesso por Papel

**Status:** Pronto para implementação  
**Estimativa:** 1 sessão de trabalho (6–8h)  
**Branch sugerida:** `feat/revenue-pipeline`  
**Criado em:** 2026-06-19  
**Pré-requisito:** `docs/specs/module-system.md` deve estar implementado primeiro — esta feature usa `clinicHasModule(clinicId, "revenue_pipeline")`

---

## 1. Contexto e objetivo

O sistema hoje agenda consultas mas não captura o valor financeiro gerado. O médico/dono não consegue ver quanto dinheiro a IA está gerando. O objetivo desta feature é:

1. Ligar **tratamentos → preços → agendamentos → receita confirmada**
2. Exibir no dashboard um **pipeline de receita em tempo real** (efeito ticker)
3. Implementar **controle de acesso por papel** (admin vê tudo, profissional vê só o seu, recepção não vê valores)

---

## 2. Estado atual do sistema (O que JÁ existe)

### Schema relevante

**`treatments` table** (`src/infrastructure/db/schema.ts` linha 212)
```ts
// Campos existentes:
id, clinicId, name, durationMinutes, description, commonObjections,
requiresEvaluationFirst, triggerTemplate, keywordMatchEnabled,
aliases, isAesthetic, pipelineSteps, createdAt, updatedAt

// FALTAM: priceCents, minPriceCents, maxPriceCents
```

**`appointments` table** (`src/infrastructure/db/schema.ts` linha 489)
```ts
// Campos existentes:
id, clinicId, leadId, professionalId, roomId, calendarEventId,
calendarEventUrl, startsAt, endsAt, status, source, reminderSentAt,
createdAt, updatedAt

// FALTAM: treatmentId, valueCents
```

**`clinic_members` table** (`src/infrastructure/db/schema.ts` linha 748)
```ts
// Campos existentes:
id, clinicId, email, role (owner|clinic_admin), passwordHash, avatarUrl, createdAt

// FALTAM: professionalId (link para professionals)
```

**`memberRoleEnum`** (`src/infrastructure/db/schema.ts` linha 746)
```ts
export const memberRoleEnum = pgEnum("member_role", ["owner", "clinic_admin"]);
// PRECISA ADICIONAR: "receptionist", "professional"
```

**`professionals` table** — JÁ EXISTE, vinculada a `appointments.professionalId`

**`leads.treatmentInterest`** — campo de texto, mas NULL para todos os leads agendados atualmente. Precisa ser populado pelo Orchestrator ao identificar o tratamento.

### Sistema de sessão

Arquivo: `src/lib/session.ts`

```ts
// Estado atual:
export type SessionRole = "owner" | "clinic_admin";
export type SessionPayload = { email: string; role: SessionRole };
// Payload assinado: `email:role:timestamp:signature` (formato caseiro, não JSON)
```

**Decisão de implementação:** migrar o payload da sessão para JSON antes de assinar. Isso permite adicionar `memberRole` e `professionalId` de forma limpa e stateless — sem query extra por request. Com apenas uma clínica piloto e quase nenhum usuário ativo, invalidar as sessões existentes tem impacto zero.

**Novo formato da sessão (alterar `src/lib/session.ts` completamente):**

```ts
export type SessionRole = "owner" | "clinic_admin"; // mantido para compatibilidade

export type MemberRole = "owner" | "clinic_admin" | "receptionist" | "professional";

export type SessionPayload = {
  email: string;
  role: SessionRole;         // "owner" | "clinic_admin" — para resolve-clinic.ts (não alterar)
  memberRole: MemberRole;    // papel granular — novo
  professionalId: string | null; // preenchido quando memberRole === "professional"
};

// signToken recebe o payload completo:
export async function signToken(payload: SessionPayload): Promise<string> {
  const json = JSON.stringify({ ...payload, iat: Date.now() });
  // assinar json com HMAC-SHA256 (mesma lógica atual, só muda o que é assinado)
  const key = await getKey();
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(json));
  const sigHex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return btoa(`${json}:${sigHex}`)
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// verifyToken retorna SessionPayload completo (com memberRole e professionalId):
export async function verifyToken(token: string): Promise<SessionPayload | null> {
  // split no último ":" para separar json do sigHex
  // verificar HMAC, parsear JSON, retornar payload
}
```

Ao fazer login (`src/app/(auth)/login/actions.ts` ou similar), buscar o membro no banco e incluir `memberRole` e `professionalId` no token gerado.

**Com isso, o helper `member-role.ts` da seção 3.2 fica mais simples** — não precisa query ao banco, só lê da sessão:

```ts
export async function getSessionMemberProfile(): Promise<MemberProfile | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const session = await verifyToken(token); // já tem memberRole e professionalId
  if (!session) return null;
  return {
    email: session.email,
    role: session.memberRole,
    professionalId: session.professionalId,
  };
}
```

### Helper de tenant

Arquivo: `src/application/tenancy/resolve-clinic.ts`

Funções existentes:
- `getSessionClinicId()` — retorna clinicId da sessão
- `assertSessionCanAccessClinic(clinicId)` — verifica acesso
- `readSession()` (privada) — lê JWT

### Páginas relevantes que serão modificadas

| Arquivo | O que é |
|---|---|
| `src/app/(clinic)/app/dashboard/page.tsx` | Dashboard principal — adicionar seção financeira |
| `src/app/(clinic)/app/agenda/AppointmentDrawer.tsx` | Drawer de agendamento — adicionar modal "Realizado" |
| `src/app/(clinic)/app/settings/tratamentos/TreatmentRow.tsx` | Row do tratamento — adicionar campo de preço |
| `src/app/(clinic)/app/settings/tratamentos/AddTreatmentForm.tsx` | Form de novo tratamento — adicionar campo de preço |
| `src/app/(clinic)/app/settings/tratamentos/actions.ts` | Server actions — salvar preço |
| `src/core/scheduling/BookingService.ts` | Serviço de agendamento — vincular treatmentId |
| `src/domain/entities/treatment.ts` linha 66 | Tipo Treatment — adicionar campos de preço |

### Dado existente aproveitável

`clinics.monthlyRevenueBrl` = 89700 para Ximendes (R$89.700/mês de faturamento declarado). Usar este dado para calcular ROI: `receita_gerada / (monthlyRevenueBrl / 100) * 100 = % da receita mensal`.

---

## 3. O que precisa ser construído

### 3.1 Migrations (Drizzle)

Criar arquivo `src/infrastructure/db/migrations/0028_revenue_pipeline.sql` (ou o próximo número disponível — verificar o último migration em `src/infrastructure/db/migrations/`).

```sql
-- 1. Novos roles de membro
ALTER TYPE member_role ADD VALUE IF NOT EXISTS 'receptionist';
ALTER TYPE member_role ADD VALUE IF NOT EXISTS 'professional';

-- 2. Link do membro ao profissional (para usuários com papel "professional")
ALTER TABLE clinic_members
  ADD COLUMN IF NOT EXISTS professional_id UUID REFERENCES professionals(id);

-- 3. Preço nos tratamentos
ALTER TABLE treatments
  ADD COLUMN IF NOT EXISTS price_cents INTEGER,
  ADD COLUMN IF NOT EXISTS min_price_cents INTEGER,
  ADD COLUMN IF NOT EXISTS max_price_cents INTEGER;

-- 4. Tratamento e valor no agendamento
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS treatment_id UUID REFERENCES treatments(id),
  ADD COLUMN IF NOT EXISTS value_cents INTEGER;
```

Também atualizar o schema Drizzle em `src/infrastructure/db/schema.ts`:

```ts
// Em memberRoleEnum (linha ~746):
export const memberRoleEnum = pgEnum("member_role", [
  "owner",
  "clinic_admin",
  "receptionist",
  "professional",
]);

// Em clinicMembers table, adicionar:
professionalId: uuid("professional_id").references(() => professionals.id),

// Em treatments table, adicionar:
priceCents: integer("price_cents"),
minPriceCents: integer("min_price_cents"),
maxPriceCents: integer("max_price_cents"),

// Em appointments table, adicionar:
treatmentId: uuid("treatment_id").references(() => treatments.id),
valueCents: integer("value_cents"),
```

Atualizar o tipo `Treatment` em `src/domain/entities/treatment.ts`:
```ts
priceCents: number | null;
minPriceCents: number | null;
maxPriceCents: number | null;
```

---

### 3.2 Controle de acesso — novo helper

Criar `src/application/tenancy/member-role.ts`:

```ts
import { cookies } from "next/headers";
import { db } from "@/infrastructure/db/client";
import { clinicMembers } from "@/infrastructure/db/schema";
import { and, eq } from "drizzle-orm";
import { verifyToken, COOKIE_NAME } from "@/lib/session";

export type MemberRole = "owner" | "clinic_admin" | "receptionist" | "professional";

export type MemberProfile = {
  email: string;
  sessionRole: "owner" | "clinic_admin"; // role no JWT
  memberRole: MemberRole;                 // role granular no banco
  clinicId: string;
  professionalId: string | null;          // preenchido quando memberRole === "professional"
};

/**
 * Retorna o perfil completo do membro logado, incluindo o papel granular.
 * - owner: memberRole = "owner", professionalId = null
 * - clinic_admin ou mais específico: lê clinic_members.role
 */
export async function getSessionMemberProfile(
  clinicId: string,
): Promise<MemberProfile | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await verifyToken(token);
  if (!session) return null;

  if (session.role === "owner") {
    return {
      email: session.email,
      sessionRole: "owner",
      memberRole: "owner",
      clinicId,
      professionalId: null,
    };
  }

  const member = await db
    .select({
      role: clinicMembers.role,
      professionalId: clinicMembers.professionalId,
    })
    .from(clinicMembers)
    .where(
      and(
        eq(clinicMembers.email, session.email),
        eq(clinicMembers.clinicId, clinicId),
      ),
    )
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!member) return null;

  return {
    email: session.email,
    sessionRole: "clinic_admin",
    memberRole: member.role as MemberRole,
    clinicId,
    professionalId: member.professionalId ?? null,
  };
}

export function canViewFinancials(profile: MemberProfile): boolean {
  return profile.memberRole === "owner" || profile.memberRole === "clinic_admin";
}

export function canViewOwnRevenue(profile: MemberProfile): boolean {
  return profile.memberRole === "professional";
}
```

---

### 3.3 Regras de acesso por papel (tabela de referência)

| Funcionalidade | owner | clinic_admin | professional | receptionist |
|---|---|---|---|---|
| Ver preço dos tratamentos | ✅ | ✅ | ✅ | ✅ |
| Editar preço dos tratamentos | ✅ | ✅ | ❌ | ❌ |
| Ver valor no agendamento individual | ✅ | ✅ | só o próprio | ❌ |
| Marcar agendamento como realizado | ✅ | ✅ | ✅ | ✅ |
| Dashboard de receita total | ✅ | ✅ | ❌ | ❌ |
| Dashboard receita própria | ✅ | ✅ | ✅ | ❌ |
| Seção ROI / % da receita mensal | ✅ | ✅ | ❌ | ❌ |
| Insights de tráfego / oportunidades | ✅ | ✅ | ❌ | ❌ |

---

### 3.4 UX — Tela de Tratamentos (settings)

**Arquivo:** `src/app/(clinic)/app/settings/tratamentos/TreatmentRow.tsx`

Adicionar campo de preço na linha do tratamento. O grid atual é `"1fr 130px auto auto"` — expandir para `"1fr 130px 160px auto auto"`.

Campo novo entre duração e botão salvar:
```
R$ [________] estimado
```

Comportamento:
- Input de número, em reais (internamente salva centavos: `Math.round(valor * 100)`)
- Placeholder: "opcional"
- Se vazio, salva `null` (tratamento sem preço definido)
- Para ranges (ex: lentes), mostrar dois campos: "de R$ ___ até R$ ___" (min/max)
- Só admin e clinic_admin veem/editam esse campo

**Server action** `updateTreatment` (em `actions.ts`) — adicionar `priceCents`, `minPriceCents`, `maxPriceCents` ao `input`.

---

### 3.5 UX — Appointment Drawer "Marcar como Realizado"

**Arquivo:** `src/app/(clinic)/app/agenda/AppointmentDrawer.tsx`

O drawer já tem o botão `updateStatus("completed")`. Substituir esse botão por um que abre um modal de confirmação antes de marcar como realizado.

**Modal "Consulta Realizada":**

```
┌─────────────────────────────────────────┐
│  Consulta Realizada ✓                   │
│                                         │
│  Paciente: Maria Silva                  │
│                                         │
│  Procedimento:                          │
│  [Lentes de Resina Composta      ▾]     │  ← dropdown dos tratamentos da clínica
│                                         │
│  Valor cobrado:                         │
│  R$ [8.500                         ]    │  ← pré-preenchido do treatment.priceCents
│      Ajuste se o valor foi diferente    │
│                                         │
│  [Cancelar]              [Confirmar ✓]  │
└─────────────────────────────────────────┘
```

Ao confirmar:
1. `PATCH /api/appointments/{id}` com `{ status: "completed", treatmentId, valueCents }`
2. O endpoint existente já chama `BookingService` que atualiza lead para `"won"`
3. O valor é salvo em `appointments.valueCents`

**Controle de acesso no modal:**
- O campo de valor é visível para todos (admin, clinic_admin, professional)
- Para `receptionist`: dropdown de tratamento visível, campo de valor OCULTO (eles marcam o procedimento, não o valor)

---

### 3.6 UX — Dashboard de Receita

**Arquivo:** `src/app/(clinic)/app/dashboard/page.tsx`

Adicionar seção financeira **apenas para** `canViewFinancials(profile) || canViewOwnRevenue(profile)`.

**Layout da seção (abaixo dos KPIs existentes, antes do gráfico de fluxo):**

```
┌───────────────────────────────────────────────────────────┐
│  Pipeline de Receita          [este mês ▾]                │
│                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐ │
│  │ Potencial    │  │ Confirmado   │  │ ROI             │ │
│  │ R$ 42.500    │  │ R$ 18.000    │  │ 21×             │ │
│  │ 6 agendadas  │  │ 2 realizadas │  │ vs R$897/mês    │ │
│  └──────────────┘  └──────────────┘  └─────────────────┘ │
│                                                           │
│  ░░░░░░░░░░░░░░░░░░████████████████   42% convertido     │
│                                                           │
│  Lentes de Resina  ████████████  R$ 17.000  2 consultas  │
│  Harmonização      ██████        R$ 12.000  1 consulta   │
│  Implante          ████          R$ 8.000   1 consulta   │
└───────────────────────────────────────────────────────────┘
```

**Para `professional` (view "Minha Receita" — sem total da clínica):**
```
┌───────────────────────────────────────┐
│  Minha Receita — junho                │
│  R$ 18.000 confirmado                 │
│  R$ 24.500 agendado (pendente)        │
└───────────────────────────────────────┘
```

**Para `receptionist`:** seção financeira completamente ausente. Dashboard mostra leads, conversas, temperatura — sem nenhum número monetário.

**Queries necessárias para o dashboard:**

```ts
// Receita potencial = agendamentos status scheduled/confirmed com valueCents
const potentialRevenue = await db
  .select({ sum: sql<number>`sum(value_cents)`, count: count() })
  .from(appointments)
  .where(
    and(
      eq(appointments.clinicId, clinicId),
      inArray(appointments.status, ["scheduled", "confirmed"]),
      gte(appointments.createdAt, periodStart),
      isNotNull(appointments.valueCents),
      // Se professional: and(eq(appointments.professionalId, profile.professionalId))
    )
  );

// Receita confirmada = agendamentos status completed com valueCents
const confirmedRevenue = await db
  .select({ sum: sql<number>`sum(value_cents)`, count: count() })
  .from(appointments)
  .where(
    and(
      eq(appointments.clinicId, clinicId),
      eq(appointments.status, "completed"),
      gte(appointments.createdAt, periodStart),
      isNotNull(appointments.valueCents),
    )
  );

// Por tratamento (top 3)
const byTreatment = await db
  .select({
    treatmentId: appointments.treatmentId,
    treatmentName: treatments.name,
    total: sql<number>`sum(appointments.value_cents)`,
    count: count(),
  })
  .from(appointments)
  .innerJoin(treatments, eq(appointments.treatmentId, treatments.id))
  .where(...)
  .groupBy(appointments.treatmentId, treatments.name)
  .orderBy(desc(sql`sum(appointments.value_cents)`))
  .limit(3);
```

---

### 3.7 Vincular treatmentId ao agendar (Orchestrator)

**Arquivo:** `src/core/scheduling/BookingService.ts`

O método `book()` cria o appointment. Precisa receber `treatmentId` e `valueCents` opcionais e salvá-los.

**De onde vem o treatmentId:** O `ConversationOrchestrator` (em `src/core/pipeline/ConversationOrchestrator.ts`) já identifica o tratamento via intent e `lead.treatmentInterest`. Na etapa de `confirm_slot` / `book_appointment`, buscar o tratamento pelo nome:

```ts
// No Orchestrator, antes de chamar BookingService.book():
const matchedTreatment = await db
  .select({ id: treatments.id, priceCents: treatments.priceCents })
  .from(treatments)
  .where(
    and(
      eq(treatments.clinicId, clinicId),
      ilike(treatments.name, `%${lead.treatmentInterest}%`),
    )
  )
  .limit(1)
  .then(r => r[0] ?? null);

// Passar para BookingService.book():
treatmentId: matchedTreatment?.id ?? null,
valueCents: matchedTreatment?.priceCents ?? null,
```

**Atualizar a interface de BookingService.book():**
```ts
async book(params: {
  lead: Lead;
  clinicId: string;
  startsAt: Date;
  endsAt: Date;
  professionalId?: string;
  roomId?: string;
  treatmentId?: string | null;     // novo
  valueCents?: number | null;       // novo
}): Promise<Appointment>
```

---

### 3.8 Settings — Gestão de membros (admin)

Criar página `/app/settings/equipe` para o admin gerenciar os membros da clínica e seus papéis.

**Dados da tabela:**
- Nome / Email do membro
- Papel: `clinic_admin` | `professional` | `receptionist`
- Se `professional`: vincular ao profissional correspondente (dropdown dos `professionals` da clínica)

Esta página é acessível apenas para `clinic_admin` e `owner`. Referência: padrão visual de `/app/settings/profissionais/`.

---

## 4. Sequência de implementação recomendada

Execute nesta ordem para evitar dependências quebradas:

1. **Migration do banco** — incluir `service_noun` em `clinics`, roles novos, `professional_id` em `clinic_members`, `price_cents/min/max` em `treatments`, `treatment_id/value_cents` em `appointments`. Rodar `drizzle-kit generate` e aplicar no Neon
2. **Schema Drizzle** — atualizar `src/infrastructure/db/schema.ts` 
3. **Tipo Treatment** — adicionar campos em `src/domain/entities/treatment.ts`
4. **Helper de role** — criar `src/application/tenancy/member-role.ts`
5. **Settings tratamentos** — adicionar campo de preço em `TreatmentRow.tsx` e `AddTreatmentForm.tsx` + actions
6. **BookingService** — aceitar `treatmentId` e `valueCents`
7. **Orchestrator** — inferir treatmentId ao agendar
8. **AppointmentDrawer** — modal "Marcar como Realizado" com tratamento + valor
9. **API `PATCH /api/appointments/[id]`** — aceitar e salvar `treatmentId` + `valueCents` ao marcar completed
10. **Dashboard** — seção financeira com controle de acesso por papel
11. **Settings equipe** — página de gestão de membros e papéis

---

## 5. Arquivos que NÃO devem ser alterados

- `src/application/tenancy/resolve-clinic.ts` — não altere as funções existentes, apenas adicione o novo helper em arquivo separado
- Migrations existentes — não altere, só crie a nova

**`src/lib/session.ts` DEVE ser alterado** — migrar o payload de string `email:role:timestamp` para JSON com `{ email, role, memberRole, professionalId, iat }`. Qualquer sessão existente fica inválida (re-login necessário), mas com apenas uma clínica piloto sem usuários ativos isso tem impacto zero.

---

## 6. Critérios de validação

Ao final da implementação, verificar:

- [ ] Admin vê seção financeira no dashboard com receita potencial + confirmada + ROI
- [ ] Membro com role `professional` vê apenas "Minha Receita" (filtrado pelo seu professionalId)
- [ ] Membro com role `receptionist` não vê nenhum número monetário
- [ ] Tratamento com preço cadastrado: ao agendar via IA, appointment.valueCents é preenchido automaticamente
- [ ] Modal "Realizado" pré-preenche tratamento e valor; permite ajuste; salva ao confirmar
- [ ] Recepcionista pode marcar como realizado mas não vê o campo de valor
- [ ] `drizzle-kit generate` gera migration limpa sem conflito
- [ ] `npx tsc --noEmit` passa sem erros
- [ ] `npx vitest run` passa (nenhum teste existente quebrado)

---

## 7. Multi-segmento — regra de ouro desta feature

**Esta feature não é exclusiva para clínicas odontológicas.** O sistema já é multi-segmento por design (ver PRs #36/#37). O pipeline de receita deve funcionar para barbearias, cabeleireiros, estética, e qualquer negócio baseado em agendamento de serviços.

O modelo de dados é 100% agnóstico — `appointments.valueCents`, `treatments.priceCents` funcionam para qualquer ticket, de R$50 a R$15.000.

**O único ponto de variação é a terminologia.** Nunca escreva "Tratamento" hardcoded no código desta feature. Sempre leia de `clinic.serviceNoun`.

### Adicionar campo `serviceNoun` à tabela `clinics`

Na migration, adicionar:
```sql
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS service_noun TEXT NOT NULL DEFAULT 'tratamento';
```

No schema Drizzle (`src/infrastructure/db/schema.ts`), na tabela `clinics`:
```ts
serviceNoun: text("service_noun").notNull().default("tratamento"),
```

Valores esperados: `"tratamento"` | `"serviço"` | `"procedimento"` (extensível, sem enum — é texto livre).

### Como usar no código

Sempre que a UI precisar exibir o conceito de "o que foi realizado":

```ts
// No server component, buscar junto com a clínica:
const { serviceNoun } = clinic; // ex: "serviço", "tratamento", "procedimento"

// Nos labels:
`${serviceNoun.charAt(0).toUpperCase() + serviceNoun.slice(1)} realizado`
// → "Tratamento realizado" ou "Serviço realizado"

`Adicionar ${serviceNoun}`
// → "Adicionar tratamento" ou "Adicionar serviço"
```

### No menu de settings

O item de menu "Tratamentos" em `/app/settings/tratamentos` deve exibir o label capitalizado do `serviceNoun`. A rota permanece `/tratamentos` para simplicidade, mas o título da página e todos os labels usam o `serviceNoun` da clínica.

---

## 8. Seleção de segmento no onboarding

### Motivação

O `serviceNoun` da seção 7 é o ponto de adaptação principal, mas para que ele seja preenchido corretamente desde o início — e para que o playbook inicial, os exemplos de procedimentos, o horário comercial padrão e o tom de voz sugerido também sejam coerentes com o negócio — o onboarding precisa pedir o segmento **antes** de qualquer outro campo.

A seleção de segmento é a primeira ação do flow de criação de nova clínica/empresa.

---

### Campo `segment` na tabela `clinics`

Na migration (mesma do passo 3.1), adicionar:

```sql
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS segment TEXT NOT NULL DEFAULT 'dental';
```

No schema Drizzle:
```ts
segment: text("segment").notNull().default("dental"),
```

Valores válidos (texto livre, sem enum — para ser extensível):
`"dental"` | `"barbershop"` | `"hair_salon"` | `"aesthetics"` | `"other"`

**Relação entre `segment` e `serviceNoun`:**

| segment | serviceNoun default | businessHours sugerido | toneOfVoice sugerido |
|---|---|---|---|
| `dental` | `tratamento` | `Seg-Sex 08:00-18:00, Sab 08:00-13:00` | `acolhedor` |
| `barbershop` | `serviço` | `Seg-Sab 09:00-20:00` | `descontraído` |
| `hair_salon` | `serviço` | `Ter-Sab 09:00-20:00` | `amigável` |
| `aesthetics` | `procedimento` | `Seg-Sex 09:00-19:00, Sab 09:00-15:00` | `acolhedor` |
| `other` | `serviço` | (campo obrigatório, sem sugestão) | `profissional` |

O `serviceNoun` é preenchido automaticamente baseado no segmento, mas **permanece editável** depois. O segmento apenas define o ponto de partida.

---

### UX do onboarding — Seleção de segmento

**Arquivo afetado:** `src/app/(owner)/owner/clinics/new/page.tsx`

O formulário atual começa com os campos de Identificação. Com esta feature, adicionar **uma seção de seleção de segmento antes de tudo**, com cards visuais clicáveis (não um `<select>`):

```
┌───────────────────────────────────────────────────────────┐
│  Qual é o tipo do seu negócio?                            │
│                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │  🦷          │  │  ✂️           │  │  💅          │    │
│  │ Odontologia  │  │  Barbearia   │  │   Estética   │    │
│  └──────────────┘  └──────────────┘  └──────────────┘    │
│                                                           │
│  ┌──────────────┐  ┌──────────────┐                       │
│  │  💇          │  │  ⚙️           │                       │
│  │ Cabeleireiro │  │    Outro     │                       │
│  └──────────────┘  └──────────────┘                       │
└───────────────────────────────────────────────────────────┘
```

Ao selecionar um card:
1. O `<input name="segment">` hidden recebe o valor (`dental`, `barbershop`, etc.)
2. O formulário restante adapta placeholders e defaults **sem recarregar a página** (via `useState` no client component)
3. Um campo `<input name="serviceNoun">` hidden recebe o `serviceNoun` correspondente

**Comportamento do formulário por segmento:**

```tsx
// Mapa de defaults por segmento (client-side, sem hit ao banco):
const SEGMENT_DEFAULTS: Record<string, {
  serviceNoun: string;
  businessHours: string;
  toneOfVoice: string;
  greetingPlaceholder: string;
  procedureExamples: string[];
}> = {
  dental: {
    serviceNoun: "tratamento",
    businessHours: "Seg-Sex 08:00-18:00, Sab 08:00-13:00",
    toneOfVoice: "acolhedor",
    greetingPlaceholder: "Olá! Sou a assistente virtual da clínica. Como posso ajudar?",
    procedureExamples: ["Lentes de Resina", "Clareamento", "Implante Dentário"],
  },
  barbershop: {
    serviceNoun: "serviço",
    businessHours: "Seg-Sab 09:00-20:00",
    toneOfVoice: "descontraído",
    greetingPlaceholder: "E aí! Sou o assistente da barbearia. Quando vem cair o cabelo?",
    procedureExamples: ["Corte", "Barba", "Sobrancelha"],
  },
  hair_salon: {
    serviceNoun: "serviço",
    businessHours: "Ter-Sab 09:00-20:00",
    toneOfVoice: "amigável",
    greetingPlaceholder: "Olá! Sou a assistente do salão. Quando quer agendar seu horário?",
    procedureExamples: ["Corte", "Escova", "Coloração"],
  },
  aesthetics: {
    serviceNoun: "procedimento",
    businessHours: "Seg-Sex 09:00-19:00, Sab 09:00-15:00",
    toneOfVoice: "acolhedor",
    greetingPlaceholder: "Olá! Sou a assistente da clínica de estética. Como posso te ajudar?",
    procedureExamples: ["Limpeza de Pele", "Botox", "Preenchimento"],
  },
  other: {
    serviceNoun: "serviço",
    businessHours: "",
    toneOfVoice: "profissional",
    greetingPlaceholder: "Olá! Como posso ajudar?",
    procedureExamples: [],
  },
};
```

**Labels que mudam na UI baseados no segmento selecionado:**

| Campo | dental | barbershop | aesthetics | other |
|---|---|---|---|---|
| Seção "Tratamentos iniciais" | Tratamentos iniciais | Serviços iniciais | Procedimentos iniciais | Serviços iniciais |
| Placeholder do greeting | "...clínica..." | "Barbearia" | "...clínica de estética..." | "..." |
| Label do campo nome | "Nome da clínica" | "Nome da barbearia" | "Nome da clínica" | "Nome do estabelecimento" |

---

### Alterações no `onboarding-config.ts`

**Arquivo:** `src/application/onboarding/onboarding-config.ts`

Adicionar campo `segment` e `serviceNoun` ao schema:

```ts
// Adicionar ao onboardingConfigSchema:
segment: z.enum(["dental", "barbershop", "hair_salon", "aesthetics", "other"]).default("dental"),
serviceNoun: z.string().trim().min(1).default("tratamento"),
```

---

### Alterações no `actions.ts` do onboarding

**Arquivo:** `src/app/(owner)/owner/clinics/new/actions.ts`

O `createClinic` use case (ou equivalente) precisa salvar `segment` e `serviceNoun` na tabela `clinics`. Os dois campos devem ser passados como parte do payload de criação.

---

### Propagação do `serviceNoun` após criação

Depois que a clínica é criada com o `segment` e `serviceNoun` corretos, todos os pontos do sistema que antes tinham "Tratamento" hardcoded agora leem `clinic.serviceNoun`. Isso é responsabilidade da feature de Revenue Pipeline (seção 7), não do onboarding em si.

O onboarding apenas garante que o `serviceNoun` nasce correto — sem precisar de configuração manual posterior.

---

### Procedimentos iniciais gerados por segmento

Ao criar a clínica, se o formulário não tiver procedimentos preenchidos mas o segmento tiver `procedureExamples`, **NÃO semear automaticamente** — apenas usar como placeholder no campo de input. O admin escolhe explicitamente o que adicionar.

Isso evita dados de exemplo que "ficam para sempre" na conta de um cliente real que não prestou atenção no onboarding.

---

## 9. Contexto de produto (para o agente entender o "porquê")

O objetivo é que o médico/dono abra o dashboard e veja **R$42.500 em consultas marcadas pela IA este mês**, com o número crescendo a cada agendamento confirmado. O efeito é como um ticker de bolsa — visceral, empolgante, e que justifica o investimento no sistema.

A receita potencial (agendamentos confirmados mas ainda não realizados) + receita confirmada (procedimentos marcados como realizados) juntas mostram o pipeline completo. O ROI calculado contra o custo do plano (`monthlyRevenueBrl` na tabela `clinics`) fecha o argumento de venda para renovação e expansão.

O controle de acesso por papel não é burocracia — é necessário porque clínicas com múltiplos dentistas não devem expor a receita de um profissional para o outro, e a recepção não precisa saber o faturamento da empresa para fazer seu trabalho.
