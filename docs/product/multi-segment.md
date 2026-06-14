# Plano Multi-Segmento

**Status:** Planejado — iniciar quando surgir o primeiro cliente fora de odontologia  
**Última revisão:** 2026-06-14  
**Estimativa de implementação:** 2–3 dias de desenvolvimento

---

## Diagnóstico: Onde estamos hoje

A infraestrutura do SystemOps é **segment-agnostic em ~80%**. O que bloqueia multi-segmento hoje está concentrado na **camada de IA** — especificamente em exemplos, keywords e identidade hardcoded para odontologia nos prompts do LLM. A lógica de negócio (agendamento, inbox, follow-up, billing, media) não precisa de nenhuma mudança.

### O que está pronto (não requer mudança)

| Camada | Detalhe |
|--------|---------|
| Schema | `clinicId` em todas as tabelas; `treatments`, `appointments`, `playbook_versions`, `media_library` são neutros |
| Multi-tenancy | Resolução por credencial (zapiInstanceId / Meta phone_number_id); nenhum fallback hardcoded desde migration 0026 |
| Tratamentos | Tabela genérica — `name`, `durationMinutes`, `requiresEvaluationFirst`, `isAesthetic` |
| Pipeline steps | `PipelineStep[]` genérico — funciona para qualquer fluxo de vendas |
| Editorial config | `playbook_versions.specialty`, `toneOfVoice`, `commercialPolicy` são free text por clínica |
| Agenda/Calendar | Agnóstico — profissional + horário + tratamento |
| Inbox / Human takeover | Agnóstico — `needs_human`, `unclear`, TTL configurável |
| Follow-up / Recovery | `specialty` já é injetado dinamicamente via `editorial?.specialty ?? clinic.specialty` |
| Billing | Planos por clínica, sem acoplamento com segmento |
| Media library | Agnóstico — qualquer tipo de mídia |
| Notificações push | Agnósticas |

### O que está hardcoded para odontologia (requer mudança)

#### 1. Schema — `src/infrastructure/db/schema.ts:107`
```ts
// HOJE:
specialty: text("specialty").notNull().default("odontology"),

// DEVE SER:
specialty: text("specialty").notNull(),  // obrigatório no onboarding
```

#### 2. Entidade Clínica — `src/domain/entities/clinic.ts:29`
```ts
// HOJE — CONCIERGE_MENU_ITEMS[0]:
{ label: "Transformar meu sorriso / lentes", intent: "procedures", treatmentKeyword: "lentes" }

// DEVE SER (dinâmico, lido do banco por clínica):
{ label: clinic.conciergeMenuLabel ?? "Conheça nossos serviços", intent: "procedures", treatmentKeyword: null }
```

#### 3. IntentClassifier — `src/core/intelligence/IntentClassifier.ts`
- **Linha ~45:** identidade `"recepcionista virtual de clínica odontológica"` → deve usar `clinic.specialty`  
- **Linhas 55–62:** exemplos de urgência (`"dor"`, `"sangramento"`) e tratamentos (`"lentes"`, `"implante"`) são dental-specific — precisam de variantes por segmento  
- **Linhas 91–95:** exemplos de `needs_human` com `"dentista"`, `"doutor"`, `"lentes"` — precisam ser parametrizados

#### 4. ResponseComposer — `src/core/intelligence/ResponseComposer.ts`
- **Linha 386:** `"sugira a avaliação presencial para que o dentista avalie"` — assume dental  
- **Linha 387 e 483:** `"O Dr. Gregorie tem agenda..."` — nome hardcoded  
- **Linha 484:** `"sobre as lentes?"` — tratamento hardcoded  
- **Linha 240:** `"lentes ou tratamento"` em exemplo de contexto  

#### 5. ConversationOrchestrator — `src/core/pipeline/ConversationOrchestrator.ts`
- **Linha 160:** `"lentes, avaliação, valores ou algum tratamento específico"` — dental-specific  
- **Linhas 593–599:** `AESTHETIC_TREATMENT_KEYWORDS = ["lente", "faceta", "clareamento", "harmonização", "gengivoplastia", "botox", "sorriso"]` — array hardcoded; deve ser configurável por clínica  
- **Linha 235:** keyword `"dentista"` em `resolveMenuSelection()` — deve ser genérico (`"especialista"`)  
- **Linha 294:** keywords `"dentista"`, `"doutor"` em `isHumanRequestText()` — deve ler de config  

#### 6. Recovery Actions — `src/app/(clinic)/app/inbox/recovery-actions.ts:26`
```ts
// HOJE:
const specialty = editorial?.specialty ?? clinic.specialty ?? "odontologia estética"

// DEVE SER:
const specialty = editorial?.specialty ?? clinic.specialty ?? "nosso serviço"
```

---

## Plano de Implementação

### Fase 1 — Easy Wins (sem schema change) — ~4h

Mudanças seguras que melhoram imediatamente sem quebrar nada existente.

| # | Arquivo | Mudança | Risco |
|---|---------|---------|-------|
| 1 | `recovery-actions.ts:26` | Fallback `"odontologia estética"` → `"nosso serviço"` | Zero |
| 2 | `ConversationOrchestrator.ts:160` | `"lentes, avaliação..."` → `"valores ou algum serviço específico"` | Zero |
| 3 | `ResponseComposer.ts:387,483` | Remover `"Dr. Gregorie"` — usar `professionals[0]?.name ?? "nossa equipe"` | Zero |
| 4 | `IntentClassifier.ts` | Substituir `"clínica odontológica"` por `${clinic.specialty ?? "clínica"}` no system prompt | Zero |

### Fase 2 — Onboarding forçado + default removido — ~4h

| # | Arquivo | Mudança | Observação |
|---|---------|---------|------------|
| 5 | `schema.ts:107` | Remover `default("odontology")` | Requer migration + garantir que todas as clínicas existentes tenham `specialty` preenchido |
| 6 | `domain/entities/clinic.ts:29` | Remover label `"lentes"` de `CONCIERGE_MENU_ITEMS[0]` | Label vira genérico; customização fica por playbook |
| 7 | `/owner/clinics/:id` UI | Tornar campo `specialty` obrigatório no form de criação/edição de clínica | UX change |

### Fase 3 — Keywords configuráveis por clínica — ~1 dia

Mover `AESTHETIC_TREATMENT_KEYWORDS` e keywords de urgência do código para configuração por clínica.

**Opção A (simples):** campo `aesthetic_keywords: text[]` e `urgent_keywords: text[]` em `clinic_settings` (nova tabela ou campos em `clinics`)

**Opção B (via playbook):** adicionar `aestheticKeywords` e `urgentKeywords` ao schema de `playbook_versions` — mesma fonte de verdade que `toneOfVoice`

**Recomendação:** Opção B — sem tabela nova, mesma fonte editorial, configurável pela UI de playbook.

Mudanças de código:
- `ConversationOrchestrator.ts`: substituir `AESTHETIC_TREATMENT_KEYWORDS` por `editorial.aestheticKeywords ?? DEFAULT_AESTHETIC_KEYWORDS`
- `IntentClassifier.ts`: injetar `urgentKeywords` no system prompt via `editorial.urgentKeywords ?? DEFAULT_URGENT_KEYWORDS`
- `editorialConfig.ts`: adicionar campos ao schema de `publishablePlaybookSchema`
- UI de playbook: nova seção "Palavras-chave" (avançado / opcional)

### Fase 4 — Templates de prompt por segmento — ~1 dia (opcional)

Para segmentos muito diferentes de clínica de saúde (ex: salão de beleza, imobiliária), os exemplos dentro dos prompts do IntentClassifier e ResponseComposer deixam de fazer sentido. A solução é criar templates de prompt que são selecionados pelo `clinic.specialty` ou por um enum de segmento.

**Abordagem sugerida:**

```ts
// src/core/intelligence/prompt-templates/
//   health-clinic.ts     ← dental, médica, veterinária, estética
//   beauty-salon.ts      ← salão, barbearia
//   generic.ts           ← fallback para qualquer segmento

function selectPromptTemplate(specialty: string): PromptTemplate {
  if (HEALTH_SEGMENTS.includes(specialty)) return healthClinicTemplate;
  if (BEAUTY_SEGMENTS.includes(specialty)) return beautySalonTemplate;
  return genericTemplate;
}
```

Cada template define:
- Identidade da IA ("recepcionista de clínica de saúde" / "atendente de salão")
- Exemplos de `clinical_urgency` / `urgent_issue` adequados ao segmento
- Exemplos de `needs_human` adequados
- Tom padrão para `ResponseComposer`

---

## Mapa de Segmentos Alvo

### Segmentos com agendamento (core flow idêntico ao dental)

| Segmento | Adaptações necessárias | Estimativa |
|----------|------------------------|------------|
| Clínica médica | Trocar "dentista" por "médico/especialista"; urgência = "febre alta", "dor forte"; avaliação = "consulta" | Fase 1+2 resolve 90% |
| Clínica veterinária | "paciente" = animal; urgência = "vômito", "convulsão"; "tutor" em vez de "paciente" | Fase 1+2+3 |
| Clínica estética | "lentes" → qualquer tratamento; urgência = "alergia", "reação"; profissional = "esteticista" | Fase 1 resolve quase tudo |
| Salão de beleza | Sem "avaliação"; agendamento direto; urgência = "alergia"; profissional = "cabeleireiro" | Fase 1+4 |
| Barbearia | Similar ao salão; sem "avaliação"; horários rápidos | Fase 1+4 |

### Segmentos sem agendamento (requer novo flow)

| Segmento | O que muda | Esforço |
|----------|------------|---------|
| Imobiliária | Sem `appointment` como produto; "lead qualificado" → humano; sem pipeline de tratamentos | Médio — novo intent "qualify_lead" |
| Contabilidade | FAQ + escalonamento humano; sem agendamento | Baixo — só playbook |
| Administradora de condomínio | Triagem + escalonamento; sem scheduling | Baixo — só playbook |
| Gestão de energia (ex: Libra) | 200 clientes com dúvidas de faturamento; FAQ estruturado + escalonamento | Médio — `knowledge_base` por clínica |

**Nota sobre segmentos sem agendamento:** A infraestrutura de agendamento simplesmente não é acionada. O `IntentClassifier` mapeia para `general_question` ou `needs_human`. Não precisa de código novo — só playbook bem configurado.

---

## Checklist de Onboarding para Nova Clínica (Qualquer Segmento)

```
[ ] Criar clínica com slug único no /owner/clinics
[ ] Preencher clinic.specialty (ex: "clínica médica", "salão de beleza")
[ ] Configurar Z-API instance (ou Meta phone_number_id) vinculada à clínica
[ ] Criar senha de login para o clinic_member admin
[ ] Criar profissionais com nome e especialidade
[ ] Cadastrar tratamentos/serviços oferecidos (com duração, pipeline steps)
[ ] Publicar playbook: toneOfVoice, commercialPolicy, FAQ, saudação
[ ] Testar via /playbook/simulate antes de ir ao ar
[ ] Configurar receptionist_phone para takeover humano
[ ] Revisar TTL de pausa da IA (padrão: 60min)
```

---

## Riscos e Mitigações

| Risco | Probabilidade | Mitigação |
|-------|--------------|-----------|
| Regressão na Ximendes ao mudar prompts | Média | Rodar simulações antes; usar `/playbook/simulate` |
| `specialty` NULL em clínica existente após remover default | Alta | Migration que popula `"odontologia"` nas clínicas existentes antes do DROP DEFAULT |
| Keywords de urgência inadequadas para novo segmento | Alta (sem Fase 3) | Fase 3 resolve; Fase 1+2 é safe para clínicas de saúde em geral |
| Template de prompt errado para segmento incomum | Baixa (Fase 4) | Fallback para `generic.ts`; ajuste por playbook |

---

## Decisão Arquitetural: Quando Iniciar

**Não iniciar antes de ter um prospect real em outro segmento.**

Motivo: dois casos reais de segmentos diferentes revelam mais decisões de design do que qualquer especulação. Especialmente sobre:
- O que varia só no playbook vs. o que precisa de código
- Quais campos de `clinic_settings` são realmente necessários
- Se templates de prompt por segmento (Fase 4) são necessários ou se playbook bem escrito resolve

**Condição de gatilho:** primeira ligação de interesse de clínica fora de odontologia.  
**Tempo até estar funcional:** 2–3 dias a partir do gatilho (Fases 1+2+3 resolvem 95% dos casos de saúde/beleza).

---

## Referências

- [Arquitetura atual](architecture/current.md)
- [Regras de core vs. playbook](../../../.claude/projects/-Users-brendonwalefy-Dev-Projetos-systemops-core/memory/feedback-core-vs-playbook.md) — melhorias universais no core; específicas no playbook
- [Visão de expansão de plataforma](../../.claude/projects/-Users-brendonwalefy-Dev-Projetos-systemops-core/memory/vision-platform-expansion.md) — segmentos mapeados com dor real
