# Spec: Sistema de Módulos (Feature Flags por Plano)

**Status:** Pronto para implementação  
**Estimativa:** 1 sessão de trabalho (5–7h)  
**Branch sugerida:** `feat/module-system`  
**Criado em:** 2026-06-19  
**Prioridade:** Implementar ANTES do revenue pipeline — este spec é pré-requisito

---

## 1. Contexto e objetivo

### O problema atual

O sistema tem features sendo controladas por **booleans soltos na tabela `clinics`**:

| Campo atual | O que controla | Problema |
|---|---|---|
| `clinics.voiceResponseEnabled` | Resposta por voz (TTS OpenAI) | Boolean sem distinção de nível (basic vs pro) |
| `clinics.ttsVoice` + `clinics.ttsConfig` | Config do TTS | Config do "módulo" dispersa em 2 colunas |
| `clinics.conversationExperience` | Menu vs Concierge | Usado em ~15 pontos do Orchestrator sem gate de plano |
| `clinics.autoReplyEnabled` | IA ligada/desligada | Correto como está — é toggle operacional, não módulo |

À medida que o sistema cresce (voz pro ElevenLabs, revenue pipeline, team roles, vídeos), esse padrão vai criar uma `clinics` com 30+ booleans soltos e zero controle de qual plano acessa o quê.

### O objetivo

Criar um **sistema de módulos plug-and-play** onde:

1. Cada feature é um **módulo com chave tipada** (`"voice_tts"`, `"concierge_mode"`, etc.)
2. Cada plano de assinatura tem uma **lista de módulos incluídos** (definida em código, não no banco)
3. O owner pode **ativar/desativar módulos individualmente** por clínica via painel `/owner`
4. Todo novo código de feature começa com: `if (!await clinicHasModule(clinicId, "nome_modulo")) return <Locked />`
5. Os booleans antigos são **migrados e removidos**

---

## 2. Catálogo de módulos (v1)

### Definição em código — não criar enum no banco

O catálogo vive em `src/application/modules/module-catalog.ts`:

```ts
export const MODULE_KEYS = [
  // Modos de interação da IA
  "menu_mode",           // Resposta com menu numerado (padrão atual)
  "concierge_mode",      // Resposta em linguagem natural (premium)

  // Voz
  "voice_tts",           // Voz básica — OpenAI TTS (shimmer/nova)
  "voice_elevenlabs",    // Voz pro — ElevenLabs (clonagem de voz)

  // Receita e equipe
  "revenue_pipeline",    // Dashboard financeiro + valor nos agendamentos
  "team_roles",          // RBAC com professional/receptionist

  // Conteúdo e mídia
  "video_library",       // Biblioteca de vídeos + envio de mídia pela IA
  "ai_co_writer",        // Co-escritor IA no editor de playbook

] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export type ModuleDefinition = {
  key: ModuleKey;
  label: string;           // Nome exibido no painel owner
  description: string;     // Uma linha de descrição
  plans: ClinicPlan[];     // Quais planos incluem este módulo por padrão
};

export const MODULE_CATALOG: ModuleDefinition[] = [
  {
    key: "menu_mode",
    label: "Modo Menu",
    description: "IA responde com opções numeradas para guiar o lead",
    plans: ["essencial", "clinica", "rede", "custom"],
  },
  {
    key: "concierge_mode",
    label: "Modo Concierge",
    description: "IA conversa naturalmente, sem menu — experiência premium",
    plans: ["clinica", "rede", "custom"],
  },
  {
    key: "voice_tts",
    label: "Resposta por Voz (básica)",
    description: "IA responde em áudio usando voz sintética OpenAI",
    plans: ["clinica", "rede", "custom"],
  },
  {
    key: "voice_elevenlabs",
    label: "Resposta por Voz Pro (ElevenLabs)",
    description: "Voz clonada do profissional via ElevenLabs",
    plans: ["rede", "custom"],
  },
  {
    key: "revenue_pipeline",
    label: "Pipeline de Receita",
    description: "Dashboard financeiro com receita potencial e confirmada",
    plans: ["clinica", "rede", "custom"],
  },
  {
    key: "team_roles",
    label: "Controle de Equipe",
    description: "Papéis por membro: admin, profissional, recepcionista",
    plans: ["clinica", "rede", "custom"],
  },
  {
    key: "video_library",
    label: "Biblioteca de Mídia",
    description: "IA envia vídeos e áudios personalizados na conversa",
    plans: ["clinica", "rede", "custom"],
  },
  {
    key: "ai_co_writer",
    label: "Co-escritor IA",
    description: "Assistente IA para redigir e melhorar o playbook",
    plans: ["clinica", "rede", "custom"],
  },
];
```

### Mapeamento plano → módulos (referência rápida)

| Módulo | essencial | clinica | rede | custom |
|---|---|---|---|---|
| menu_mode | ✅ | ✅ | ✅ | owner define |
| concierge_mode | ❌ | ✅ | ✅ | owner define |
| voice_tts | ❌ | ✅ | ✅ | owner define |
| voice_elevenlabs | ❌ | ❌ | ✅ | owner define |
| revenue_pipeline | ❌ | ✅ | ✅ | owner define |
| team_roles | ❌ | ✅ | ✅ | owner define |
| video_library | ❌ | ✅ | ✅ | owner define |
| ai_co_writer | ❌ | ✅ | ✅ | owner define |

**Plano `custom`:** owner configura módulo a módulo no painel `/owner/clinics/[id]/modules`. Usado para pilotos, negociações especiais, e testes internos.

---

## 3. Banco de dados

### 3.1 Nova tabela `clinic_modules`

```sql
-- migration: 0029_module_system.sql

CREATE TABLE clinic_modules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   UUID NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  module_key  TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  config      JSONB,           -- config específica do módulo (ex: voice ID do ElevenLabs)
  updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_by  TEXT,            -- email de quem fez a última alteração
  UNIQUE (clinic_id, module_key)
);

CREATE INDEX idx_clinic_modules_clinic ON clinic_modules (clinic_id) WHERE is_active = true;
```

### 3.2 Migrar features existentes para módulos

```sql
-- Cria linha de voice_tts para clínicas com voiceResponseEnabled = true
INSERT INTO clinic_modules (clinic_id, module_key, is_active, config, updated_by)
SELECT
  id,
  'voice_tts',
  true,
  jsonb_build_object(
    'provider', COALESCE(tts_config->>'provider', 'openai'),
    'voice',    COALESCE(tts_voice, 'nova'),
    'speed',    COALESCE((tts_config->>'speed')::numeric, 1.0)
  ),
  'migration_0029'
FROM clinics
WHERE voice_response_enabled = true;

-- Cria linha de menu_mode para clínicas com conversation_experience = 'menu_first' (padrão)
INSERT INTO clinic_modules (clinic_id, module_key, is_active, updated_by)
SELECT id, 'menu_mode', true, 'migration_0029'
FROM clinics
WHERE conversation_experience = 'menu_first' OR conversation_experience IS NULL;

-- Cria linha de concierge_mode para clínicas com conversation_experience = 'concierge'
INSERT INTO clinic_modules (clinic_id, module_key, is_active, updated_by)
SELECT id, 'concierge_mode', true, 'migration_0029'
FROM clinics
WHERE conversation_experience = 'concierge';

-- Ativa módulos base por plano para todas as clínicas existentes
-- (essencial: menu_mode já inserido acima)
-- (clinica/rede: ativar módulos adicionais)
INSERT INTO clinic_modules (clinic_id, module_key, is_active, updated_by)
SELECT c.id, m.module_key, true, 'migration_0029'
FROM clinics c
CROSS JOIN (VALUES
  ('video_library'), ('ai_co_writer'), ('revenue_pipeline'), ('team_roles'), ('voice_tts')
) AS m(module_key)
WHERE c.plan IN ('clinica', 'rede')
ON CONFLICT (clinic_id, module_key) DO NOTHING;

INSERT INTO clinic_modules (clinic_id, module_key, is_active, updated_by)
SELECT c.id, 'voice_elevenlabs', true, 'migration_0029'
FROM clinics c
WHERE c.plan = 'rede'
ON CONFLICT (clinic_id, module_key) DO NOTHING;
```

### 3.3 Remover colunas obsoletas

```sql
-- Após migração e validação, remover colunas que o módulo substituiu
ALTER TABLE clinics
  DROP COLUMN IF EXISTS voice_response_enabled,
  DROP COLUMN IF EXISTS tts_voice,
  DROP COLUMN IF EXISTS tts_config,
  DROP COLUMN IF EXISTS conversation_experience;
```

**Atenção:** Só executar a remoção DEPOIS que todo o código de leitura tiver sido migrado para o helper `getClinicModules()`. A migration pode ser em 2 partes: uma que cria e popula `clinic_modules`, outra (em sessão futura) que remove as colunas antigas.

### 3.4 Atualizar schema Drizzle

**Criar tabela no schema (`src/infrastructure/db/schema.ts`):**

```ts
export const clinicModules = pgTable(
  "clinic_modules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clinicId: uuid("clinic_id")
      .notNull()
      .references(() => clinics.id, { onDelete: "cascade" }),
    moduleKey: text("module_key").notNull().$type<ModuleKey>(),
    isActive: boolean("is_active").notNull().default(true),
    config: jsonb("config"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedBy: text("updated_by"),
  },
  (t) => ({
    uniq: unique().on(t.clinicId, t.moduleKey),
    activeIdx: index("idx_clinic_modules_clinic").on(t.clinicId).where(eq(t.isActive, true)),
  }),
);
```

**Remover do schema as colunas que serão dropadas:**
- `clinics.voiceResponseEnabled`
- `clinics.ttsVoice`
- `clinics.ttsConfig`
- `clinics.conversationExperience` e o tipo `ConversationExperience` em `src/domain/entities/clinic.ts`

---

## 4. Arquitetura do código

### 4.1 Helper principal: `getClinicModules()`

**Criar `src/application/modules/module-gate.ts`:**

```ts
import { db } from "@/infrastructure/db/client";
import { clinicModules } from "@/infrastructure/db/schema";
import { and, eq } from "drizzle-orm";
import type { ModuleKey } from "./module-catalog";

export type ActiveModule = {
  key: ModuleKey;
  config: Record<string, unknown> | null;
};

/**
 * Retorna todos os módulos ativos para uma clínica.
 * Chamada única por request — guarde o resultado em variável local
 * em vez de chamar múltiplas vezes.
 */
export async function getClinicModules(clinicId: string): Promise<ActiveModule[]> {
  const rows = await db
    .select({ moduleKey: clinicModules.moduleKey, config: clinicModules.config })
    .from(clinicModules)
    .where(
      and(
        eq(clinicModules.clinicId, clinicId),
        eq(clinicModules.isActive, true),
      ),
    );

  return rows.map((r) => ({
    key: r.moduleKey as ModuleKey,
    config: r.config as Record<string, unknown> | null,
  }));
}

/**
 * Verifica se um módulo específico está ativo.
 * Use quando só precisa checar um módulo — evita carregar todos.
 */
export async function clinicHasModule(clinicId: string, key: ModuleKey): Promise<boolean> {
  const [row] = await db
    .select({ id: clinicModules.id })
    .from(clinicModules)
    .where(
      and(
        eq(clinicModules.clinicId, clinicId),
        eq(clinicModules.moduleKey, key),
        eq(clinicModules.isActive, true),
      ),
    )
    .limit(1);

  return !!row;
}

/**
 * Retorna a config tipada de um módulo específico.
 * Usar quando o módulo tem configuração (ex: voice_tts, voice_elevenlabs).
 */
export async function getModuleConfig<T = Record<string, unknown>>(
  clinicId: string,
  key: ModuleKey,
): Promise<T | null> {
  const [row] = await db
    .select({ config: clinicModules.config })
    .from(clinicModules)
    .where(
      and(
        eq(clinicModules.clinicId, clinicId),
        eq(clinicModules.moduleKey, key),
        eq(clinicModules.isActive, true),
      ),
    )
    .limit(1);

  return (row?.config as T) ?? null;
}
```

### 4.2 Tipos de config por módulo

**Criar `src/application/modules/module-configs.ts`:**

```ts
import type { ModuleKey } from "./module-catalog";

export type VoiceTtsConfig = {
  provider: "openai";
  voice: string;   // "shimmer" | "nova" | "alloy" etc.
  speed: number;   // 0.25–4.0
};

export type VoiceElevenLabsConfig = {
  voiceId: string;
  stability: number;
  similarityBoost: number;
};

// Map: qual ModuleKey tem qual tipo de config
export type ModuleConfigMap = {
  voice_tts: VoiceTtsConfig;
  voice_elevenlabs: VoiceElevenLabsConfig;
  menu_mode: null;
  concierge_mode: null;
  revenue_pipeline: null;
  team_roles: null;
  video_library: null;
  ai_co_writer: null;
};
```

### 4.3 Helper de sincronização plano → módulos

**Adicionar em `src/application/modules/module-gate.ts`:**

```ts
import { MODULE_CATALOG } from "./module-catalog";
import type { ClinicPlan } from "@/infrastructure/db/schema";

/**
 * Sincroniza os módulos de uma clínica com base no plano.
 * Chamado ao criar clínica ou ao mudar de plano.
 * Para plano "custom": não faz nada (owner configura manualmente).
 */
export async function syncModulesForPlan(
  clinicId: string,
  plan: ClinicPlan,
  updatedBy: string,
): Promise<void> {
  if (plan === "custom") return; // custom: owner define tudo

  const modulesForPlan = MODULE_CATALOG
    .filter((m) => m.plans.includes(plan))
    .map((m) => m.key);

  // Upsert: ativa módulos do plano, desativa os que não fazem parte
  for (const moduleKey of MODULE_CATALOG.map((m) => m.key)) {
    const shouldBeActive = modulesForPlan.includes(moduleKey);
    await db
      .insert(clinicModules)
      .values({ clinicId, moduleKey, isActive: shouldBeActive, updatedBy })
      .onConflictDoUpdate({
        target: [clinicModules.clinicId, clinicModules.moduleKey],
        set: { isActive: shouldBeActive, updatedBy, updatedAt: new Date() },
      });
  }
}
```

---

## 5. Migração do código existente

### 5.1 `conversationExperience` → módulos de modo

Substituir em todos os pontos do Orchestrator (`src/core/pipeline/ConversationOrchestrator.ts`) onde lê `clinic.conversationExperience`:

```ts
// ANTES:
const experience = clinic.conversationExperience ?? "menu_first";
if (experience === "concierge") { ... }

// DEPOIS:
// Carregar módulos uma vez no início do método run():
const clinicModules = await getClinicModules(clinicId);
const hasMenuMode = clinicModules.some(m => m.key === "menu_mode");
const hasConcierge = clinicModules.some(m => m.key === "concierge_mode");

// Derivar a experience a partir dos módulos:
const experience: ConversationExperience =
  hasConcierge ? "concierge" : "menu_first";
```

**Regra:** Se a clínica tem `concierge_mode` ativo, opera em concierge. Caso contrário, menu. Não faz sentido ter os dois ativos simultaneamente — o owner escolhe um.

**Ponto de carga:** O Orchestrator já faz 1 query para buscar todos os dados da clínica. Adicionar a query de `getClinicModules()` na mesma Promise.all ao início do método `run()`, para evitar waterfall.

### 5.2 `voiceResponseEnabled` + `ttsConfig` → módulo `voice_tts`

```ts
// ANTES:
const voiceEnabled = clinic.voiceResponseEnabled;
const ttsConf = clinic.ttsConfig ?? ttsConfigFromVoice(clinic.ttsVoice ?? "nova");

// DEPOIS:
const voiceModule = clinicModules.find(m => m.key === "voice_tts");
const voiceEnabled = !!voiceModule;
const ttsConf = (voiceModule?.config as VoiceTtsConfig | null)
  ?? { provider: "openai", voice: "nova", speed: 1.0 };
```

Pontos afetados (buscar por `voiceResponseEnabled` no código):
- `src/core/pipeline/ConversationOrchestrator.ts` (~5 usos)
- `src/core/intelligence/ResponseComposer.ts` (2 usos)
- `src/app/(clinic)/app/settings/playbook/ia-settings-client.tsx`
- `src/app/(clinic)/app/settings/playbook/page.tsx`
- `src/app/(clinic)/app/settings/playbook/playbook-version-actions.ts`

### 5.3 Settings de IA — substituir toggle booleano por UI de módulo

A tela `/app/settings/playbook` hoje tem um toggle para `voiceResponseEnabled`. Após a migração:

- O toggle de voz desaparece desta tela
- A ativação de módulos passa a ser exclusiva do painel `/owner` (só o owner ativa/desativa)
- O admin da clínica configura parâmetros do módulo (ex: qual voz TTS) mas não ativa/desativa
- Mostrar na tela de settings o status do módulo (ativo/inativo) com mensagem "Para ativar este módulo, fale com o suporte"

---

## 6. Owner UI — gerenciamento de módulos

### Página: `/owner/clinics/[clinicId]/modules`

Nova aba na página da clínica no painel owner. Estrutura:

```
┌─────────────────────────────────────────────────────────────┐
│  Clínica Ximendes — Módulos                                 │
│  Plano: Clínica  [Alterar plano ▾]                          │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Modo Menu                          ● Ativo   [—]   │    │
│  │  IA responde com opções numeradas                   │    │
│  ├─────────────────────────────────────────────────────┤    │
│  │  Modo Concierge             ○ Inativo        [+]   │    │
│  │  IA conversa livremente — premium             ↑     │    │
│  │                                        bloqueado   │    │
│  │                                        pelo plano  │    │
│  ├─────────────────────────────────────────────────────┤    │
│  │  Resposta por Voz           ● Ativo   [—]   [⚙]   │    │
│  │  TTS OpenAI · voz: shimmer                          │    │
│  ├─────────────────────────────────────────────────────┤    │
│  │  Pipeline de Receita        ○ Inativo        [+]   │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                             │
│  [Sincronizar com plano]                                    │
└─────────────────────────────────────────────────────────────┘
```

**Comportamento:**
- Toggle ativa/desativa `clinic_modules.is_active`
- Se o módulo não está no plano: toggle desabilitado com tooltip "Disponível no plano Rede ou superior"
- Botão `[⚙]` abre modal de configuração do módulo (para módulos com config, como voz)
- `[Sincronizar com plano]` chama `syncModulesForPlan()` — redefine tudo com base no plano atual

**Arquivo:** criar `src/app/(owner)/owner/clinics/[clinicId]/modules/page.tsx`

**Server actions:** criar `src/app/(owner)/owner/clinics/[clinicId]/modules/actions.ts`
- `toggleModule(clinicId, moduleKey, isActive)` — ativa/desativa
- `updateModuleConfig(clinicId, moduleKey, config)` — salva config do módulo

---

## 7. Padrão: como adicionar um novo módulo

Para cada nova feature, seguir este checklist:

```
1. Adicionar a chave em MODULE_KEYS[] em module-catalog.ts
2. Adicionar a definição em MODULE_CATALOG[] (label, description, plans)
3. Se tiver config: adicionar o tipo em ModuleConfigMap em module-configs.ts
4. Na migration SQL: fazer INSERT em clinic_modules para clínicas do plano certo
5. No código da feature: checar com clinicHasModule() antes de renderizar ou executar
6. No owner UI: o módulo aparece automaticamente na lista (derivado do catálogo)
```

**Template de guard em Server Component:**

```tsx
// No topo do page.tsx da feature:
const hasAccess = await clinicHasModule(clinicId, "nome_do_modulo");
if (!hasAccess) {
  return (
    <div className="panel">
      <h2>Módulo não disponível</h2>
      <p>Este recurso não está ativo no plano atual. Fale com o suporte.</p>
    </div>
  );
}
```

**Template de guard em Server Action:**

```ts
// No início da action:
const hasAccess = await clinicHasModule(clinicId, "nome_do_modulo");
if (!hasAccess) throw new Error("Módulo não autorizado");
```

---

## 8. Sequência de implementação

Execute nesta ordem:

1. **Criar `module-catalog.ts`** e `module-configs.ts` — sem tocar no banco ainda
2. **Criar `module-gate.ts`** com as funções helpers
3. **Migration SQL** — criar `clinic_modules`, inserir dados de migração das features existentes, NÃO dropar colunas antigas ainda
4. **Atualizar schema Drizzle** — adicionar `clinicModules` table (sem remover colunas antigas)
5. **Migrar `ConversationOrchestrator.ts`** — substituir leituras de `conversationExperience` e `voiceResponseEnabled` para usar `getClinicModules()`
6. **Migrar `ResponseComposer.ts`** — substituir `voiceResponseEnabled` 
7. **Migrar settings de IA** (`ia-settings-client.tsx`, `page.tsx`, `actions.ts`) — remover toggles que agora são gerenciados pelo owner
8. **Criar `/owner/clinics/[clinicId]/modules/page.tsx`** e actions
9. **Atualizar `syncModulesForPlan()`** — integrar no flow de criação de clínica (`scripts/create-clinic.ts` e action do `/owner/clinics/new`)
10. **Segunda migration SQL** — dropar colunas antigas (`voice_response_enabled`, `tts_voice`, `tts_config`, `conversation_experience`)
11. **Remover do schema Drizzle** as colunas dropadas + o tipo `ConversationExperience`

---

## 9. Relação com o spec de revenue pipeline

O spec `docs/specs/revenue-pipeline-access-control.md` descreve a feature de pipeline de receita. Esta feature usa o módulo `"revenue_pipeline"`.

**Ordem de implementação:**
1. Implementar este spec de módulos PRIMEIRO (session A)
2. Implementar o revenue pipeline referenciando `clinicHasModule(clinicId, "revenue_pipeline")` (session B)

O spec de revenue pipeline **não precisa ser alterado** — basta o agente que o implementar saber que deve usar o module gate em vez de verificar o plano diretamente.

---

## 10. Critérios de validação

Ao final da implementação, verificar:

- [ ] `clinic_modules` table existe e tem dados para a clínica Ximendes (pilot)
- [ ] Ximendes tem `menu_mode` ativo e `voice_tts` ativo com config correta
- [ ] `clinicHasModule("ximendes-id", "concierge_mode")` retorna `false` para plano atual
- [ ] Orchestrator lê `conversationExperience` via módulos — sem ler coluna antiga
- [ ] Coluna `voice_response_enabled` removida do banco e do schema Drizzle
- [ ] Coluna `conversation_experience` removida do banco e do schema Drizzle
- [ ] Painel owner `/owner/clinics/[id]/modules` lista todos os módulos do catálogo
- [ ] Toggle no owner ativa/desativa e persiste corretamente
- [ ] Módulo fora do plano: toggle desabilitado no owner UI
- [ ] `syncModulesForPlan()` chamado ao criar nova clínica popula módulos corretos
- [ ] `npx tsc --noEmit` passa sem erros
- [ ] `npx vitest run` passa (sem quebrar testes existentes de Orchestrator/ResponseComposer)

---

## 11. Notas de produto

**Por que não um enum no banco para `module_key`?**  
Adicionar valor a um enum Postgres requer uma migration. Com chaves como texto livre, novos módulos são adicionados apenas ao catálogo TypeScript — sem tocar no banco. A validação de tipo fica no TypeScript (`ModuleKey`).

**Por que o owner controla e não o admin da clínica?**  
Módulos são funcionalidades contratuais vinculadas ao plano. O admin da clínica configura os parâmetros (qual voz, qual estilo) mas não decide o que está disponível. Isso protege o modelo de negócio — uma clínica no plano Essencial não pode auto-ativar o Modo Concierge.

**`autoReplyEnabled` não é módulo — é toggle operacional.**  
A diferença: módulos são contratos de plano (ativados pelo owner). `autoReplyEnabled` é um controle do dia a dia da clínica (a IA está ligada ou desligada agora). Permanece como coluna em `clinics` e como toggle no painel da clínica.
