# Conversation Intelligence V2 — Internal Lab Live Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** colocar o runtime V2 existente em produção exclusivamente no SystemOps Dental Lab, com authority interna vinculada aos bytes finais, shell live sobre o lifecycle atual, personas multi-turn capturadas com segurança, rollback bidirecional comprovado e evidência honesta ainda pendente de review humano.

**Architecture:** `ProcessMessageJobHandler` continua sendo a entrada única e delega cada turno ao `TenantEngineRouter`, o único componente autorizado a escolher `V1`, `V1+shadow` ou `V2`; o caminho V2 reutiliza persistence, lease, state, `BookingService`, durable outbox e sender existentes e nunca volta à V1 dentro do mesmo turno. Uma authority Ed25519 exclusiva do Lab vincula tenant, canal, configuração, build e evidência; contatos sintéticos atravessam a mesma queue e o mesmo sender, mas um boundary registrado e fail-closed captura a entrega antes de qualquer provider externo.

**Tech Stack:** TypeScript 5.8, Next.js 16, Vitest 3.2, Zod 3.25, Drizzle/PostgreSQL, Ed25519 de `node:crypto`, OpenAI adapter existente, durable jobs/outbox existentes, WhatsApp sender existente e Markdown/JSON para artifacts.

**Specs canônicas:** [`2026-08-17-conversation-v2-internal-lab-live-design.md`](../specs/2026-08-17-conversation-v2-internal-lab-live-design.md), [`current.md`](../../architecture/current.md) e [`change-control.md`](../../operations/change-control.md). Em caso de divergência, a spec aprovada e os documentos canônicos do repositório prevalecem.

## Global Constraints

- Ponto de partida: commit `2df55b37be8a3e4c26eda3cb327499f5a3af4679` na branch `feat/conversation-core-v2`; o commit contém a spec aprovada.
- `TenantEngineRouter` é o único boundary de seleção V1/V2. Nenhuma route, worker, handler, runner, sender ou adapter pode ler `conversation_engine` ou escolher engine.
- O caminho nominal é `ProcessMessageJobHandler -> TenantEngineRouter -> V1 | V2`; shadow também é selecionado pelo router e apenas consumido depois do turno V1.
- Não há fallback `V2 -> V1` no mesmo turno. Erro V2 produz somente seu contrato seguro; a feature flag passa a valer no turno seguinte.
- `INTERNAL_LAB_READY` e `INTERNAL_LAB_SMOKE_AUTHORIZED` pertencem a uma authority Ed25519 separada do Cycle I, autorizam somente um tenant/canal interno e não transformam human/qualitative review em `PASS`.
- Eligibility do Lab exige simultaneamente approval registrada, tenant digest exato, channel digest exato, `isTest = true`, `isDemo = false` e `status = test`; qualquer ausência fecha para V1 sem executar V2.
- A authority local serve somente a integridade, measurement e dogfooding interno. A chave privada nunca entra no repositório, Vercel, artifact, log ou banco.
- V2 reutiliza `ProcessMessageJobHandler`, inbox/persistence, repositories/state, `BookingService`, durable outbox, sender e jobs atuais.
- V2 não grava diretamente em DB, Calendar, WhatsApp ou provider; writes passam por portas existentes e o booking exclusivamente por `BookingService`.
- Personas sintéticas percorrem inbound persistence, queue, conversation, engine, durable outbox, sender e Inbox reais. O boundary de captura existente suprime entrega externa e o sender recusa destino sintético sem autorização registrada.
- O telefone real do owner usa o channel WhatsApp real, sem capture, e é testado em execução separada das personas.
- Rollback deve provar `V2 -> V1 -> V2` entre turnos, preservando conversation state, dedupe, ordering/outbox e unicidade de booking.
- O SystemOps Dental Lab usa somente tabelas/configs existentes, tem configuração idempotente, não consulta nem altera tenant real e contém apenas conteúdo sintético/sanitizado.
- Não criar worker, queue, booking service, outbox, inbox, sender, dashboard, Lab schema, framework de Lab, persona engine genérico, eval framework, capability ou intelligence behavior.
- V1, predicates legacy e Cycle I histórico permanecem honestos e disponíveis. Não fazer refactor/cleanup de V1 além do seam mínimo compartilhado.
- Conteúdo editorial pertence a `playbook_versions`; preços pertencem a `treatments`; configuração operacional pertence a `organizations`; não duplicar fatos entre prompt, código e banco.
- Artifacts permitidos: `evals/systemops-lab/<run-id>/transcript.md`, `evals/systemops-lab/<run-id>/trace.json`, `evals/systemops-lab/<run-id>/evaluation.json` e `evals/systemops-lab/latest-summary.md`. Nenhum outro artifact de Lab é commitado.
- Logs/traces não contêm prompt, mensagem, nome, telefone, e-mail, URL privada, secret, provider payload ou ID opaco. Texto completo só fica nas messages do tenant Lab e nos artifacts sintéticos autorizados.
- O automated eval mede apenas o demonstrável e nunca marca review humano/qualitativo como aprovado. Todo transcript termina com `OWNER REVIEW: PENDING` e instruções de revisão.
- Change control: branch focada -> PR para `develop` -> CI/preview verdes -> aprovação -> merge em `develop` -> promoção aprovada a `main` -> deploy. Nunca push direto em `main`.
- Antes de push, PR, merge ou deploy executar `npm run verify` exatamente, sem `.env.local`. Para agenda executar também `npm test -- src/__tests__/SlotEngine.test.ts src/__tests__/BookingDoubleBooking.test.ts src/__tests__/SlotDayPreference.test.ts src/__tests__/ClinicTimezone.test.ts`.
- Cada Task segue RED -> GREEN -> testes focados -> revisão independente sem `Critical` ou `Important` aberto -> commit pequeno. O executor não inicia a Task seguinte antes desse gate.

---

## Mapa de arquivos e ownership

| Responsabilidade | Arquivo proprietário |
| --- | --- |
| schema, verificação e registro da authority interna | `src/application/conversation-v2/internal-lab-approval.ts` |
| public key configurada e assinatura offline | `src/infrastructure/conversation-v2/configured-internal-lab-authority.ts`, `scripts/sign-internal-lab-approval.ts` |
| única escolha de engine | `src/application/conversation-v2/tenant-engine-router.ts` |
| policy persistida de engine | `src/application/ports/conversation-engine-policy-reader.ts`, `src/infrastructure/repositories/drizzle-conversation-engine-policy-reader.ts` |
| exceção operacional estreita para Lab `status=test` | `src/application/automation/internal-lab-automation-policy-reader.ts` |
| contrato compartilhado do handler | `src/application/ports/conversation-handler.ts` |
| dedupe/registro/lease/state compartilhados | `src/application/conversation/live-turn-lifecycle.ts` |
| adapters live do Dental Pack | `src/application/conversation-v2/dental-live-adapters.ts` |
| execução live V2 e contrato seguro de falha | `src/application/conversation-v2/v2-live-conversation-handler.ts` |
| composition root único | `src/infrastructure/conversation-v2/create-conversation-v2-runtime.ts` |
| configuração declarativa e digest do Lab | `src/application/labs/systemops-dental-lab-config.ts` |
| apply/verify/rollback idempotente da configuração | `scripts/configure-systemops-dental-lab.ts`, `scripts/verify-systemops-lab.ts` |
| identidade de contato sintético e autorização de capture | `src/application/labs/internal-lab-synthetic-delivery.ts` |
| claim exato dos jobs já existentes | `src/application/ports/job-queue.ts`, `src/infrastructure/repositories/drizzle-job-queue.ts` |
| personas declarativas | `evals/systemops-lab/personas/*.json` |
| runner multi-turn do pipeline real | `scripts/run-systemops-lab-personas.ts` |
| renderer/evaluator específico do Lab | `src/application/labs/systemops-lab-evidence.ts` |
| operação e rollback | `docs/operations/systemops-lab-runbook.md` |

## Sequência de dependências

`Task 1 -> Task 2 -> Task 3 -> Task 4 -> Task 5 -> Task 6 -> Task 7`

`Task 1 -> Task 8`; `Task 2 + Task 6 -> Task 9`; `Task 8 + Task 9 -> Task 10`; `Task 5 + Task 10 -> Task 11`; todas convergem na `Task 12`. Os Release Gates só começam depois do commit e da revisão da Task 12.

---

### Task 1: Criar a authority Ed25519 exclusiva do Internal Lab

**Objetivo:** produzir approvals `SMOKE` e `READY` fail-closed, vinculadas ao build/tenant/canal/config/evidência exatos, sem depender do gate Cycle I e sem poder autorizar cliente externo.

**Files:**
- Create: `src/application/conversation-v2/internal-lab-approval.ts`
- Create: `src/infrastructure/conversation-v2/configured-internal-lab-authority.ts`
- Create: `scripts/sign-internal-lab-approval.ts`
- Modify: `.env.example`
- Modify: `package.json`
- Create: `src/__tests__/ConversationV2InternalLabApproval.test.ts`
- Create: `src/__tests__/ConfiguredInternalLabAuthority.test.ts`

**Interfaces:**
- Consumes: `CycleIRuntimeBuildIdentity` de `src/application/conversation-v2/configured-cycle-i-authority.ts` e build attestation de `git-cycle-i-build-attestation.ts`, sem consumir `InternalV2ActivationApproval`.
- Produces:

```ts
export type InternalLabApprovalDecision =
  | "INTERNAL_LAB_SMOKE_AUTHORIZED"
  | "INTERNAL_LAB_READY";

export type InternalLabApprovalClaims = Readonly<{
  schemaVersion: 1;
  decision: InternalLabApprovalDecision;
  authorityDomain: "systemops.conversation-v2.internal-lab-approval.v1";
  commitSha: string;
  treeSha: string;
  sourceDigest: string;
  runtimeDigest: string;
  tenantDigest: string;
  channelDigest: string;
  configDigest: string;
  cycleIGateDigest: string;
  cycleIDecision: "NO_GO";
  qualitativeStatus: "not_measurable" | "pending_human_review";
  criteria: readonly InternalLabApprovalCriterion[];
  evidenceDigests: readonly Readonly<{
    kind: "verification" | "architecture_review" | "production_smoke" | "rollback" | "personas" | "inbox" | "observability";
    digest: string;
  }>[];
  issuedAt: string;
  expiresAt: string | null;
}>;

export type InternalLabApprovalCriterion =
  | "h_safety_entailment_preserved"
  | "tasks_1_7_closed"
  | "architecture_review_clear"
  | "final_build_measurement_recorded"
  | "single_router_boundary"
  | "tenant_flag_fail_closed"
  | "same_turn_fallback_absent"
  | "isolation_dedupe_state_booking_outbox_sender_green"
  | "bidirectional_rollback_green"
  | "verify_green"
  | "single_internal_target"
  | "exact_build_deployed"
  | "real_internal_number_smoke_green"
  | "production_rollback_green"
  | "inbox_persistence_green"
  | "synthetic_personas_captured"
  | "automated_evidence_generated"
  | "observability_green"
  | "lab_final_engine_v2_internal";

export type RegisteredInternalLabApproval = Readonly<{
  claims: InternalLabApprovalClaims;
  signature: string;
}>;

export function parseAndRegisterInternalLabApproval(input: {
  serializedApproval: string;
  authority: ConfiguredInternalLabAuthority;
  runtimeIdentity: CycleIRuntimeBuildIdentity;
  expectedTenantDigest: string;
  expectedChannelDigest: string;
  expectedConfigDigest: string;
  now: Date;
}): RegisteredInternalLabApproval;

export function isRegisteredInternalLabApproval(
  approval: unknown,
  expected: {
    decision: InternalLabApprovalDecision;
    runtimeIdentity: CycleIRuntimeBuildIdentity;
    tenantDigest: string;
    channelDigest: string;
    configDigest: string;
    now: Date;
  },
): approval is RegisteredInternalLabApproval;

export type ConfiguredInternalLabAuthority = Readonly<{
  domain: "systemops.conversation-v2.internal-lab-approval.v1";
  verifyCanonicalPayload(payload: Uint8Array, signature: Uint8Array): boolean;
}>;

export function loadConfiguredInternalLabAuthority(): ConfiguredInternalLabAuthority;
```

- `CONVERSATION_V2_INTERNAL_LAB_AUTHORITY_PUBLIC_KEY` é a única root de trust interna; `CONVERSATION_V2_INTERNAL_LAB_APPROVAL_JSON`, `CONVERSATION_V2_INTERNAL_LAB_TENANT_DIGEST`, `CONVERSATION_V2_INTERNAL_LAB_CHANNEL_DIGEST` e `CONVERSATION_V2_INTERNAL_LAB_CONFIG_DIGEST` carregam o artifact e os bindings protegidos. `ConfiguredInternalLabAuthority` só pode ser construído pelo loader a partir da env e é registrado nominalmente; public key passada por caller não concede authority. O CLI recebe a private key por caminho explícito `--private-key-file`, recusa caminho dentro do worktree e escreve a approval em stdout ou em caminho explícito fora do repo.

- [ ] **Step 1: escrever testes RED do schema, assinatura, binding e separação de authority**

```ts
it("registers only a valid internal approval bound to exact bytes and Lab digests", () => {
  const approval = parseAndRegisterInternalLabApproval(validInput);
  expect(isRegisteredInternalLabApproval(approval, exactExpected)).toBe(true);
});

it.each(["commitSha", "treeSha", "sourceDigest", "runtimeDigest", "tenantDigest", "channelDigest", "configDigest"])(
  "rejects a changed %s",
  (field) => expect(() => parseAndRegisterInternalLabApproval(tampered(field))).toThrow(),
);

it("cannot reinterpret Cycle I or human review as pass", () => {
  expect(() => parseAndRegisterInternalLabApproval(withClaims({ cycleIDecision: "GO" }))).toThrow();
  expect(() => parseAndRegisterInternalLabApproval(withClaims({ qualitativeStatus: "pass" }))).toThrow();
});
```

- [ ] **Step 2: rodar o RED**

Run: `npm test -- src/__tests__/ConversationV2InternalLabApproval.test.ts src/__tests__/ConfiguredInternalLabAuthority.test.ts`

Expected: FAIL porque os módulos e a env dedicada ainda não existem.

- [ ] **Step 3: implementar canonicalização fechada, domain separation, verify/sign e registry nominal**

Use `Reflect.ownKeys`, descriptors próprios enumeráveis, `Object.freeze`, canonical JSON com chaves em ordem fixa, `createPublicKey`, `verify(null, ...)` e `WeakSet`s privados para authority e approval. `SMOKE` exige `expiresAt` futuro, a lista fechada dos critérios pré-smoke e evidence digests de verification/review; `READY` exige `expiresAt = null`, todos os critérios adicionais e digests de smoke/rollback/personas/Inbox/observability. Recuse public key igual a qualquer root do Cycle I e qualquer decisão/enum fora do contrato.

- [ ] **Step 4: rodar GREEN e validar o CLI sem persistir segredo**

Run: `npm test -- src/__tests__/ConversationV2InternalLabApproval.test.ts src/__tests__/ConfiguredInternalLabAuthority.test.ts && npm run typecheck`

Expected: PASS; `git grep -n "PRIVATE KEY" -- . ':!package-lock.json'` não encontra material de chave.

- [ ] **Step 5: obter revisão independente e fechar o commit**

O reviewer compara a diff com as seções 2 e 9 da spec, procura bypass de registry, replay de assinatura, mistura com Cycle I e vazamento de chave. Corrigir todo `Critical`/`Important`, repetir o Step 4 e então:

```bash
git add .env.example package.json src/application/conversation-v2/internal-lab-approval.ts src/infrastructure/conversation-v2/configured-internal-lab-authority.ts scripts/sign-internal-lab-approval.ts src/__tests__/ConversationV2InternalLabApproval.test.ts src/__tests__/ConfiguredInternalLabAuthority.test.ts
git commit -m "feat(conversation-v2): add internal lab authority"
```

---

### Task 2: Tornar `TenantEngineRouter` o único selector e autorizar `status=test` somente no Lab

**Objetivo:** centralizar a bifurcação de engine e abrir automação live para o Lab elegível sem alterar a política default de tenants `test`.

**Files:**
- Create: `src/application/ports/conversation-handler.ts`
- Create: `src/application/ports/internal-lab-eligibility-reader.ts`
- Create: `src/application/conversation-v2/tenant-engine-router.ts`
- Create: `src/application/automation/internal-lab-automation-policy-reader.ts`
- Modify: `src/application/jobs/process-message-job.ts`
- Modify: `src/application/conversation-v2/engine-selection.ts`
- Modify: `src/application/conversation-v2/run-shadow-batch.ts`
- Modify: `src/infrastructure/repositories/drizzle-clinic-automation-policy-reader.ts`
- Create: `src/__tests__/TenantEngineRouter.test.ts`
- Create: `src/__tests__/InternalLabAutomationPolicy.test.ts`
- Modify: `src/__tests__/ConversationV2EngineSelection.test.ts`
- Create: `src/__tests__/arch/TenantEngineRouterBoundary.test.ts`

**Interfaces:**
- Consumes: `ConversationEnginePolicyReader.getConversationEnginePolicy(clinicId)`, `RegisteredInternalLabApproval`, `CycleIRuntimeBuildIdentity`, `ClinicAutomationPolicyReader` e o handler V1 existente.
- Produces:

```ts
export type ConversationHandleInput = {
  clinicId: string;
  phone: string;
  whatsappLid?: string | null;
  messageText: string;
  messageId: string;
  senderName?: string;
  senderPhoto?: string | null;
  timestamp: Date;
  turnId?: string;
  replyEnabled?: boolean;
  observationOnly?: boolean;
  mediaUrl?: string;
  mediaType?: "image" | "video" | "audio" | "document";
  turnObservationSink?: V1TurnObservationSink;
  automationMode: ClinicAutomationMode;
};

export type ConversationHandleResult = { replied: boolean; reason?: string };
export interface ConversationHandler {
  handle(input: ConversationHandleInput): Promise<ConversationHandleResult>;
}

export type EffectiveConversationEngine =
  | { route: "v1"; shadow: false; reason: "configured_v1" | "automation_not_live" | "internal_lab_not_eligible" }
  | { route: "v1"; shadow: true; reason: "configured_shadow" }
  | { route: "v2"; shadow: false; reason: "internal_lab_authorized" };

export class TenantEngineRouter implements ConversationHandler {
  handle(input: ConversationHandleInput): Promise<ConversationHandleResult>;
}

export class V2ShadowSelectionRegistry {
  register(input: { turnId: string; clinicId: string }): void;
  consumeAll(): readonly Readonly<{ turnId: string; clinicId: string }>[];
}

export type InternalLabEligibilityFacts = Readonly<{
  clinicId: string;
  isTest: boolean;
  isDemo: boolean;
  operationalStatus: ClinicOperationalStatus;
  autoReplyEnabled: boolean;
  shadowModeEnabled: boolean;
}>;

export interface InternalLabEligibilityReader {
  getInternalLabEligibilityFacts(clinicId: string): Promise<InternalLabEligibilityFacts | null>;
}
```

`ProcessMessageJobHandler` coloca o `automationMode` resolvido no input; `TenantEngineRouter` lê policy e eligibility uma vez, valida a approval e chama exatamente um handler. O Drizzle automation reader implementa também `InternalLabEligibilityReader` com a mesma row já consultada, sem expor `conversationEngine`. `engine-selection.ts` fica somente com enum/type/canonicalização da configuração; `resolveConversationEngine` é removido e a decisão passa a existir apenas no método privado do router. Para shadow, o router registra o turn id em `V2ShadowSelectionRegistry`; `runConversationV2ShadowBatch` só consome IDs registrados e não lê policy nem engine.

- [ ] **Step 1: escrever testes RED da matriz e do boundary arquitetural**

```ts
it("routes eligible v2_internal to V2 exactly once", async () => {
  await router.handle(turn);
  expect(v2.handle).toHaveBeenCalledOnce();
  expect(v1.handle).not.toHaveBeenCalled();
});

it("never calls V1 after a V2 exception", async () => {
  v2.handle.mockRejectedValue(new Error("v2 failed"));
  await expect(router.handle(turn)).rejects.toThrow("v2 failed");
  expect(v1.handle).not.toHaveBeenCalled();
});

it("keeps status=test disabled unless every Lab predicate and approval matches", async () => {
  expect(await readerWith(missingChannelApproval).getAutomationMode(labId)).toBe("disabled");
  expect(await readerWith(exactApproval).getAutomationMode(labId)).toBe("live");
});
```

O teste arquitetural percorre `src/**/*.ts` e falha se `conversationEngine`, `getConversationEnginePolicy` ou `resolveConversationEngine` aparecerem fora do router, policy reader, schema/config e testes allowlisted.

- [ ] **Step 2: rodar o RED**

Run: `npm test -- src/__tests__/TenantEngineRouter.test.ts src/__tests__/InternalLabAutomationPolicy.test.ts src/__tests__/ConversationV2EngineSelection.test.ts src/__tests__/arch/TenantEngineRouterBoundary.test.ts`

Expected: FAIL por ausência do router e porque `v2_internal` ainda retorna `v2_internal_runtime_unavailable`.

- [ ] **Step 3: extrair o contrato do handler, implementar router/policy wrapper e retirar seleção do shadow batch**

O wrapper de automação preserva precedência de `cancelled`, `observe` e kill switch. Ele retorna `live` para `status=test` apenas com organização exata `{ isTest:true, isDemo:false, status:"test", autoReplyEnabled:true }` e approval registrada. A eligibility não depende da engine, permitindo o turno V1 do rollback. O router rejeita policy cujo `clinicId` difira do input, registra trace sanitizado `engine.selected` e nunca captura exceção do handler V2 para chamar V1.

- [ ] **Step 4: rodar GREEN e provar boundary único**

Run: `npm test -- src/__tests__/TenantEngineRouter.test.ts src/__tests__/InternalLabAutomationPolicy.test.ts src/__tests__/ConversationV2EngineSelection.test.ts src/__tests__/arch/TenantEngineRouterBoundary.test.ts src/__tests__/ProcessMessageJob.test.ts src/__tests__/ConversationV2ShadowBatch.test.ts`

Expected: PASS; os spies mostram um único handler por turno e zero policy read no batch pós-sender.

- [ ] **Step 5: revisão independente e commit**

O reviewer verifica as seções 4, 5 e 8 da spec e tenta encontrar outra bifurcação, fallback por `catch` e abertura de tenants `test`. Corrigir achados, repetir Step 4 e:

```bash
git add src/application/ports/conversation-handler.ts src/application/ports/internal-lab-eligibility-reader.ts src/application/conversation-v2/tenant-engine-router.ts src/application/automation/internal-lab-automation-policy-reader.ts src/application/jobs/process-message-job.ts src/application/conversation-v2/engine-selection.ts src/application/conversation-v2/run-shadow-batch.ts src/infrastructure/repositories/drizzle-clinic-automation-policy-reader.ts src/__tests__/TenantEngineRouter.test.ts src/__tests__/InternalLabAutomationPolicy.test.ts src/__tests__/ConversationV2EngineSelection.test.ts src/__tests__/arch/TenantEngineRouterBoundary.test.ts
git commit -m "feat(conversation-v2): add tenant engine router"
```

---

### Task 3: Extrair o lifecycle live compartilhado sem limpar a V1

**Objetivo:** fazer V1 e V2 usarem os mesmos contratos de dedupe, inbound persistence, conversation lease, state e histórico, preservando o comportamento atual da V1.

**Files:**
- Create: `src/application/conversation/live-turn-lifecycle.ts`
- Create: `src/application/ports/live-conversation-context-reader.ts`
- Create: `src/infrastructure/repositories/drizzle-live-conversation-context-reader.ts`
- Modify: `src/core/pipeline/ConversationOrchestrator.ts`
- Modify: `src/infrastructure/repositories/drizzle-conversation-repository.ts`
- Modify: `src/domain/repositories/conversation-repository.ts`
- Create: `src/__tests__/LiveTurnLifecycle.test.ts`
- Modify: `src/__tests__/DuplicateLeadMessage.test.ts`
- Modify: `src/__tests__/MessageDebounceResolution.test.ts`
- Modify: `src/__tests__/RegisterIncomingMessageRace.test.ts`

**Interfaces:**
- Consumes: `RegisterIncomingMessage`, `ConversationTurnCoordinator`, `ConversationStateMachine`, `LeadRepository`, `ConversationRepository` e a unique index `messages_external_id_idx` existentes.
- Produces:

```ts
export type LiveTurnContext = Readonly<{
  turnId: string;
  clinicId: string;
  leadId: string;
  conversationId: string;
  inboundMessageId: string;
  clinic: Organization;
  lead: Lead;
  conversation: Conversation;
  inboundMessage: Message;
  outboundAddress: string;
  editorial: EditorialConfig | null;
  history: readonly Message[];
  state: Readonly<Record<string, unknown>>;
  releaseLease(): Promise<void>;
}>;

export type BeginLiveTurnResult =
  | { outcome: "duplicate"; reason: "external_id" | "recent_content" }
  | { outcome: "busy"; reason: "conversation_lease" }
  | { outcome: "ready"; context: LiveTurnContext };

export class LiveTurnLifecycle {
  begin(input: ConversationHandleInput): Promise<BeginLiveTurnResult>;
  complete(input: { context: LiveTurnContext; replied: boolean; reason?: string }): Promise<void>;
  fail(input: { context: LiveTurnContext; error: unknown }): Promise<void>;
}

export interface LiveConversationContextReader {
  findOrganization(clinicId: string): Promise<Organization | null>;
  resolveEditorialConfig(clinicId: string): Promise<EditorialConfig | null>;
}
```

- [ ] **Step 1: escrever testes RED de equivalência e concorrência**

```ts
it("returns the same persisted conversation, history and state to either engine", async () => {
  const first = await lifecycle.begin(turn("message-1"));
  expect(first.outcome).toBe("ready");
  await lifecycle.complete({ context: ready(first), replied: true });
  const second = await lifecycle.begin(turn("message-2"));
  expect(ready(second).conversationId).toBe(ready(first).conversationId);
});

it("suppresses concurrent duplicate external ids before any effect", async () => {
  const results = await Promise.all([lifecycle.begin(turn("same-id")), lifecycle.begin(turn("same-id"))]);
  expect(results.filter(({ outcome }) => outcome === "ready")).toHaveLength(1);
});
```

- [ ] **Step 2: rodar RED**

Run: `npm test -- src/__tests__/LiveTurnLifecycle.test.ts src/__tests__/RegisterIncomingMessageRace.test.ts src/__tests__/DuplicateLeadMessage.test.ts src/__tests__/MessageDebounceResolution.test.ts`

Expected: FAIL porque o lifecycle compartilhado ainda não existe.

- [ ] **Step 3: extrair somente o seam comum e delegar a V1 a ele**

Mover, sem reescrever, as regras atuais de external id, janela de conteúdo, `RegisterIncomingMessage`, lease e leitura de state/history para `LiveTurnLifecycle`. O context reader Drizzle limita-se a `organizations` + `buildOrganization` e delega editorial a `resolveActiveEditorialConfig`; o handler V2 recebe o objeto pronto e não importa SQL. Adicionar ao conversation repository apenas a leitura necessária com assinatura explícita; não mover decisão, prompt, scheduling nem composição V1. `releaseLease()` deve ser idempotente e chamado em `finally` pelos dois handlers.

- [ ] **Step 4: rodar GREEN e regressão V1**

Run: `npm test -- src/__tests__/LiveTurnLifecycle.test.ts src/__tests__/RegisterIncomingMessageRace.test.ts src/__tests__/DuplicateLeadMessage.test.ts src/__tests__/MessageDebounceResolution.test.ts src/__tests__/CoordinatorConflict.test.ts`

Expected: PASS e snapshots/expectations V1 permanecem iguais.

- [ ] **Step 5: revisão independente e commit**

O reviewer procura duplicação entre V1 e lifecycle, alteração semântica de V1, lease não liberada e dedupe pós-efeito. Corrigir, repetir Step 4 e:

```bash
git add src/application/conversation/live-turn-lifecycle.ts src/application/ports/live-conversation-context-reader.ts src/infrastructure/repositories/drizzle-live-conversation-context-reader.ts src/core/pipeline/ConversationOrchestrator.ts src/infrastructure/repositories/drizzle-conversation-repository.ts src/domain/repositories/conversation-repository.ts src/__tests__/LiveTurnLifecycle.test.ts src/__tests__/DuplicateLeadMessage.test.ts src/__tests__/MessageDebounceResolution.test.ts src/__tests__/RegisterIncomingMessageRace.test.ts
git commit -m "refactor(conversation): share live turn lifecycle"
```

---

### Task 4: Implementar adapters Dental live sobre catálogo, agenda, state e `BookingService`

**Objetivo:** conectar o Dental Pack às leituras e writes produtivos existentes sem acesso direto do V2 a DB, Google Calendar ou criação de appointments.

**Files:**
- Create: `src/application/conversation-v2/dental-live-adapters.ts`
- Create: `src/__tests__/DentalLiveAdapters.test.ts`
- Modify: `src/__tests__/BookingDoubleBooking.test.ts`

**Interfaces:**
- Consumes: `DentalCatalogReadPort`, `DentalSchedulingReadPort`, `DentalSchedulingWritePort`, `DrizzleTreatmentRepository`, `CalendarGateway`, `ConversationStateMachine`, `ClinicTimezone` e `BookingService`.
- Produces:

```ts
export type DentalLiveAdapterDependencies = {
  treatments: Pick<TreatmentRepository, "listByClinic" | "findByName">;
  calendar: Pick<CalendarGateway, "listAvailableSlots">;
  state: Pick<ConversationStateMachine, "getCurrentState" | "getPendingSlotOffer" | "offerSlots">;
  appointments: Pick<AppointmentRepository, "findByPeriod">;
  booking: Pick<BookingService, "book">;
  clinic: Organization;
  lead: Lead;
  leadId: string;
  conversationId: string;
  turnId: string;
};

export function createDentalLiveAdapters(deps: DentalLiveAdapterDependencies): {
  catalogRead: DentalCatalogReadPort;
  schedulingRead: DentalSchedulingReadPort;
  schedulingWrite: DentalSchedulingWritePort;
};
```

`bookSlot(slotId)` resolve o `DentalSlot.id` para `startsAt/endsAt`, revalida a oferta persistida e procura appointment `scheduled|confirmed` do mesmo tenant/lead/slot. Se já existir, devolve o mesmo success sem write; caso contrário chama `BookingService.book({ clinic, lead, startsAt, endsAt, treatmentName, treatmentId, valueCents, origin:"ai_conversation" })`. Confirmação e slot resolution usam o state persistido. Preço permanece em `DentalService.priceCents`, exatamente como o contrato do pack.

- [ ] **Step 1: escrever testes RED de ports e única write path**

```ts
it("resolves price only from the tenant treatment repository", async () => {
  const service = await adapters.catalogRead.resolveService("clareamento");
  expect(service.kind === "exact" ? service.service.priceCents : null).toBe(90000);
});

it("books only through BookingService after slot revalidation", async () => {
  await adapters.schedulingWrite.bookSlot("slot-15h");
  expect(booking.book).toHaveBeenCalledOnce();
  expect(booking.book).toHaveBeenCalledWith(expect.objectContaining({ origin: "ai_conversation" }));
});

it("returns the existing same-lead appointment on a retry without booking again", async () => {
  appointments.findByPeriod.mockResolvedValue([existingAppointment]);
  const result = await adapters.schedulingWrite.bookSlot("slot-15h");
  expect(result).toMatchObject({ success: true, appointmentId: existingAppointment.id });
  expect(booking.book).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: rodar RED**

Run: `npm test -- src/__tests__/DentalLiveAdapters.test.ts src/__tests__/BookingDoubleBooking.test.ts`

Expected: FAIL porque `createDentalLiveAdapters` não existe.

- [ ] **Step 3: implementar adapters mínimos e determinísticos**

Reutilizar `ClinicTimezone` para datas, rejeitar service/slot de outro tenant, persistir offers via state machine e mapear erros de `BookingService` para outcomes tipados do pack. Não adicionar regra editorial nem preço em código.

- [ ] **Step 4: rodar GREEN com suíte de agenda**

Run: `npm test -- src/__tests__/DentalLiveAdapters.test.ts src/__tests__/BookingDoubleBooking.test.ts src/__tests__/SlotEngine.test.ts src/__tests__/SlotDayPreference.test.ts src/__tests__/ClinicTimezone.test.ts`

Expected: PASS, incluindo double-booking e timezone.

- [ ] **Step 5: revisão independente e commit**

O reviewer rastreia cada write até `BookingService`, procura offsets manuais, preço hardcoded e cross-tenant reads. Corrigir, repetir Step 4 e:

```bash
git add src/application/conversation-v2/dental-live-adapters.ts src/__tests__/DentalLiveAdapters.test.ts src/__tests__/BookingDoubleBooking.test.ts
git commit -m "feat(conversation-v2): add dental live adapters"
```

---

### Task 5: Construir o `V2LiveConversationHandler` com outbox durável e falha segura

**Objetivo:** executar o pipeline V2 real dentro do lifecycle compartilhado, compor uma resposta autorizada e enfileirá-la no outbox existente sem nenhum fallback V1.

**Files:**
- Create: `src/application/conversation-v2/v2-live-conversation-handler.ts`
- Modify: `src/application/jobs/conversation-outbound-payload.ts`
- Modify: `src/core/observability/DecisionTrace.ts`
- Create: `src/__tests__/V2LiveConversationHandler.test.ts`
- Modify: `src/__tests__/V2ResponsePipeline.test.ts`
- Modify: `src/__tests__/DecisionTrace.test.ts`

**Interfaces:**
- Consumes: `LiveTurnLifecycle`, `createDentalPack`, `prepareTurnPipeline`, `completeTurnPipeline`, `DentalUnderstandingProvider`, `DeterministicResponseComposer`, `createDentalLiveAdapters`, `enqueueOutboundMessage`, `ConversationOutboundPayload` e `DecisionTraceSink`.
- Produces:

```ts
export type V2SafeFailureReason =
  | "duplicate"
  | "conversation_busy"
  | "understanding_failed"
  | "decision_failed"
  | "action_failed"
  | "response_validation_failed"
  | "outbox_failed";

export class V2LiveConversationHandler implements ConversationHandler {
  handle(input: ConversationHandleInput): Promise<ConversationHandleResult>;
}
```

O contrato seguro é: `duplicate`/`busy` não respondem; falha antes de write pode enfileirar uma única mensagem técnica/handoff autorizada pelo response fallback existente; falha depois de write nunca inventa sucesso e nunca repete a action. Todo outbound usa dedupe key `conversation-reply:${turnId}` e payload versionado atual.

- [ ] **Step 1: escrever testes RED de jornada e matriz de falhas**

```ts
it("answers price and scheduling in one authorized outbox reply", async () => {
  const result = await handler.handle(turn("Quanto custa o clareamento e tem horário amanhã?"));
  expect(result).toEqual({ replied: true });
  expect(outbox.createOutboundMessageAndEnqueue).toHaveBeenCalledWith(
    expect.objectContaining({ dedupeKey: `conversation-reply:${turnId}` }),
    { turnId },
  );
});

it.each(["understanding", "decision", "action", "validation", "outbox"])(
  "uses only the V2 safe-failure contract when %s fails",
  async (phase) => {
    const harness = handlerWithFailure(phase);
    const result = await harness.handle(turnInput).catch((error) => ({ error }));
    const reasonByPhase = {
      understanding: "understanding_failed",
      decision: "decision_failed",
      action: "action_failed",
      validation: "response_validation_failed",
    } as const;
    if (phase === "outbox") expect(result).toEqual({ error: expect.any(Error) });
    else expect(result).toEqual({ replied: true, reason: reasonByPhase[phase] });
    expect(harness.effectCount).toBeLessThanOrEqual(1);
    expect(harness.unauthorizedOutboundCount).toBe(0);
  },
);
```

Também provar: uma action por prepared token, success/failure não invertido, validator antes do enqueue, lease liberada e mensagem agent persistida pelo sender existente, não pelo handler.

- [ ] **Step 2: rodar RED**

Run: `npm test -- src/__tests__/V2LiveConversationHandler.test.ts src/__tests__/V2ResponsePipeline.test.ts src/__tests__/DecisionTrace.test.ts`

Expected: FAIL porque o live handler e os stages sanitizados ainda não existem.

- [ ] **Step 3: implementar o handler como orquestração fina**

Fluxo exato: `lifecycle.begin -> understanding -> createDentalPack -> prepare -> complete -> validate/composer -> enqueueOutboundMessage -> lifecycle.complete -> finally releaseLease`. Registrar `engine.selected`, `v2.understanding`, `v2.decision`, `v2.action_result`, `v2.outbox` e `turn.failed` apenas com enums, contagens, model id allowlisted, duração e status. Nenhum trace leva texto/evidence ref/telefone.

- [ ] **Step 4: rodar GREEN e regressão do core**

Run: `npm test -- src/__tests__/V2LiveConversationHandler.test.ts src/__tests__/V2ResponsePipeline.test.ts src/__tests__/PipelineDecisionBarrier.test.ts src/__tests__/DecisionTrace.test.ts`

Expected: PASS; cada cenário tem no máximo um intended effect e um outbox record.

- [ ] **Step 5: revisão independente e commit**

O reviewer audita no-fallback, order de persistência, resposta após write, duplicate effects, trace PII e chamadas diretas proibidas. Corrigir, repetir Step 4 e:

```bash
git add src/application/conversation-v2/v2-live-conversation-handler.ts src/application/jobs/conversation-outbound-payload.ts src/core/observability/DecisionTrace.ts src/__tests__/V2LiveConversationHandler.test.ts src/__tests__/V2ResponsePipeline.test.ts src/__tests__/DecisionTrace.test.ts
git commit -m "feat(conversation-v2): add safe live handler"
```

---

### Task 6: Compor o runtime produtivo no worker sem criar infraestrutura paralela

**Objetivo:** instalar router, V1, V2 e shadow no composition root atual, mantendo route, worker, queue e sender únicos.

**Files:**
- Modify: `src/infrastructure/conversation-v2/create-conversation-v2-runtime.ts`
- Modify: `src/app/api/cron/message-worker/route.ts`
- Modify: `src/application/conversation-v2/run-shadow-batch.ts`
- Modify: `src/__tests__/MessageWorkerV2Composition.test.ts`
- Modify: `src/__tests__/arch/ConversationV2RuntimeBoundary.test.ts`
- Modify: `src/__tests__/arch/ConversationV2NoLiveExecution.test.ts`

**Interfaces:**
- Consumes: interfaces das Tasks 1–5 e adapters/repositories/`BookingService`/sender existentes.
- Produces:

```ts
export type ConversationV2Runtime = Readonly<{
  conversationHandler: TenantEngineRouter;
  automationPolicy: ClinicAutomationPolicyReader;
  decisionTraceSink: DecisionTraceSink;
  createTurnObservationSink: ProcessMessageJobDependencies["createTurnObservationSink"];
  runSelectedShadowTurns(): Promise<void>;
  runtimeIdentity: CycleIRuntimeBuildIdentity;
}>;

export function createConversationV2Runtime(): ConversationV2Runtime;
```

- [ ] **Step 1: transformar os testes de composição em RED para o shell live**

```ts
it("injects TenantEngineRouter as the only ProcessMessageJobHandler conversation handler", () => {
  const runtime = createConversationV2RuntimeForTest(deps);
  expect(runtime.conversationHandler).toBeInstanceOf(TenantEngineRouter);
});

it("uses the existing process and send queues without a V2 worker", () => {
  expect(source).not.toMatch(/v2\.process|v2\.send|V2Worker/);
});
```

Substituir o antigo teste “V2 nunca live” por invariantes: somente router referencia o handler live; V2 não importa `db`, sender/channel adapter ou Calendar writer.

- [ ] **Step 2: rodar RED**

Run: `npm test -- src/__tests__/MessageWorkerV2Composition.test.ts src/__tests__/arch/ConversationV2RuntimeBoundary.test.ts src/__tests__/arch/ConversationV2NoLiveExecution.test.ts`

Expected: FAIL porque o runtime ainda retorna somente a composição shadow e a route injeta V1 diretamente.

- [ ] **Step 3: montar dependencies uma vez e manter a route fina**

Carregar approval protegida no composition root, validar build/config/tenant/channel, construir policy wrapper e router, injetar router em `ProcessMessageJobHandler`, executar o sender atual e depois drenar apenas os shadow turns registrados pelo router. Falha ao carregar approval resulta em V1; corrupção estrutural gera trace allowlisted e não ativa V2.

- [ ] **Step 4: rodar GREEN e testes do worker/sender**

Run: `npm test -- src/__tests__/MessageWorkerV2Composition.test.ts src/__tests__/arch/ConversationV2RuntimeBoundary.test.ts src/__tests__/arch/ConversationV2NoLiveExecution.test.ts src/__tests__/ProcessMessageJob.test.ts src/__tests__/SendMessageJob.test.ts src/__tests__/ConversationV2ShadowBatch.test.ts`

Expected: PASS e nenhum novo endpoint/queue/worker aparece na diff.

- [ ] **Step 5: revisão independente e commit**

O reviewer inspeciona composition order, approval fail-closed, boundary único, shadow pós-V1 e ausência de infraestrutura paralela. Corrigir, repetir Step 4 e:

```bash
git add src/infrastructure/conversation-v2/create-conversation-v2-runtime.ts src/app/api/cron/message-worker/route.ts src/application/conversation-v2/run-shadow-batch.ts src/__tests__/MessageWorkerV2Composition.test.ts src/__tests__/arch/ConversationV2RuntimeBoundary.test.ts src/__tests__/arch/ConversationV2NoLiveExecution.test.ts
git commit -m "feat(conversation-v2): compose internal live runtime"
```

---

### Task 7: Provar isolamento, no-fallback e rollback `V2 -> V1 -> V2`

**Objetivo:** instalar testes de integração que rejeitam regressões cross-tenant e comprovam state, dedupe, outbox e booking ao trocar a feature flag entre turnos.

**Files:**
- Create: `src/__tests__/ConversationV2LiveIsolation.test.ts`
- Create: `src/__tests__/ConversationV2BidirectionalRollback.test.ts`
- Modify: `src/__tests__/BookingDoubleBooking.test.ts`
- Modify: `src/__tests__/OutboundMessagePersistence.test.ts`

**Interfaces:**
- Consumes: runtime composto da Task 6, repositories in-memory/DB-test existentes e a policy mutável somente no fixture.
- Produces: nenhum contrato de produção novo; fixa invariantes executáveis para o release.

- [ ] **Step 1: escrever RED para sequência multi-turn exata**

```ts
it("preserves one conversation across V2 -> V1 -> V2", async () => {
  await setEngine(labId, "v2_internal");
  await process(turn1PriceAndSlots);
  await setEngine(labId, "v1");
  await process(turn2Choose15h);
  await setEngine(labId, "v2_internal");
  await process(turn3Confirm);
  expect(await conversationIds(labId)).toEqual([conversationId]);
  expect(await uniqueBookings(conversationId)).toHaveLength(1);
  expect(await outboundSequences(conversationId)).toEqual([0, 1, 2]);
});

it("does not execute V1 in the failed V2 turn; policy change applies to the next turn", async () => {
  await expect(process(failingV2Turn)).rejects.toThrow();
  expect(v1CallsFor(failingV2Turn.turnId)).toBe(0);
  await setEngine(labId, "v1");
  await process(nextTurn);
  expect(v1CallsFor(nextTurn.turnId)).toBe(1);
});
```

Adicionar matriz de tenant/canal/approval alterados, replay do mesmo message id, outbox retry e tentativa de booking duplicado.

- [ ] **Step 2: rodar RED**

Run: `npm test -- src/__tests__/ConversationV2LiveIsolation.test.ts src/__tests__/ConversationV2BidirectionalRollback.test.ts src/__tests__/BookingDoubleBooking.test.ts src/__tests__/OutboundMessagePersistence.test.ts`

Expected: pelo menos um teste falha até que fixtures/composição exponham todos os invariantes.

- [ ] **Step 3: fazer apenas os ajustes mínimos nos contratos das Tasks 2–6**

Corrigir o ponto exato revelado pelo RED sem adicionar fallback ou estado de Lab. A troca de engine ocorre somente no policy reader antes do turno seguinte; não resetar conversation, state, queue nem outbox.

- [ ] **Step 4: rodar GREEN e teste DB intencional quando `.env.test.local` for seguro**

Run: `npm test -- src/__tests__/ConversationV2LiveIsolation.test.ts src/__tests__/ConversationV2BidirectionalRollback.test.ts src/__tests__/BookingDoubleBooking.test.ts src/__tests__/OutboundMessagePersistence.test.ts`

Run opcional controlado: `npm run test:db` somente depois de `scripts/assert-safe-test-database.ts` confirmar branch Neon de teste.

Expected: PASS; o mesmo `conversationId` atravessa os três turnos, a duplicata não cria effect e só o Lab chega ao V2.

- [ ] **Step 5: revisão independente e commit**

O reviewer tenta invalidar os testes com false positives, troca no meio do turno, tenant real e duplicate retry. Corrigir, repetir Step 4 e:

```bash
git add src/__tests__/ConversationV2LiveIsolation.test.ts src/__tests__/ConversationV2BidirectionalRollback.test.ts src/__tests__/BookingDoubleBooking.test.ts src/__tests__/OutboundMessagePersistence.test.ts
git commit -m "test(conversation-v2): prove isolation and rollback"
```

Se o RED exigir correção produtiva, ela pertence ao arquivo proprietário definido nas Tasks 2–6, deve ser adicionada por path individual e descrita no handoff da revisão. Antes de commitar, `git diff --cached --name-only` deve mostrar somente os quatro testes acima e esses paths proprietários explicitamente revisados.

---

### Task 8: Configurar o SystemOps Dental Lab de forma declarativa e idempotente

**Objetivo:** produzir uma configuração sintética completa usando schemas atuais, com dry-run/apply/verify/rollback e digest determinístico para a approval.

**Files:**
- Create: `src/application/labs/systemops-dental-lab-config.ts`
- Create: `scripts/configure-systemops-dental-lab.ts`
- Modify: `scripts/verify-systemops-lab.ts`
- Modify: `src/application/labs/systemops-lab-readiness.ts`
- Modify: `docs/operations/systemops-lab-runbook.md`
- Create: `src/__tests__/SystemOpsDentalLabConfig.test.ts`
- Modify: `src/__tests__/SystemOpsLabReadiness.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: tabelas `organizations`, `treatments`, `professionals`, `playbookVersions` e mechanisms do script de transferência existentes.
- Produces:

```ts
export const SYSTEMOPS_DENTAL_LAB_CONFIG = Object.freeze({
  name: "SystemOps Dental Lab",
  specialty: "Odontologia — ambiente interno sintético",
  city: "São Paulo",
  address: "ENDEREÇO FICTÍCIO — Rua do Laboratório, 100",
  addressComplement: "Sala 2 — ambiente interno",
  locationMessage: "Endereço fictício do SystemOps Dental Lab: Rua do Laboratório, 100, Sala 2, São Paulo/SP.",
  timezone: "America/Sao_Paulo",
  operationalStatus: "test",
  isTest: true,
  isDemo: false,
  calendarMode: "internal",
  businessHours: "segunda a sexta, das 09h às 18h",
  businessSchedule: {
    days: {
      1: [{ startHour: 9, startMinute: 0, endHour: 18, endMinute: 0 }],
      2: [{ startHour: 9, startMinute: 0, endHour: 18, endMinute: 0 }],
      3: [{ startHour: 9, startMinute: 0, endHour: 18, endMinute: 0 }],
      4: [{ startHour: 9, startMinute: 0, endHour: 18, endMinute: 0 }],
      5: [{ startHour: 9, startMinute: 0, endHour: 18, endMinute: 0 }],
    },
  },
  professional: { name: "Dra. Marina Laboratório", specialty: "Odontologia sintética", isActive: true },
  treatments: [
    { name: "Avaliação odontológica", priceCents: 10000, priceKind: "fixed", priceQuotableInChat: true, priceDeductible: true, durationMinutes: 60, requiresEvaluationFirst: false },
    { name: "Lentes/facetas em resina", priceCents: 250000, priceKind: "from", priceQuotableInChat: true, priceDeductible: false, durationMinutes: 180, requiresEvaluationFirst: true },
    { name: "Clareamento dental", priceCents: 90000, priceKind: "fixed", priceQuotableInChat: true, priceDeductible: false, durationMinutes: 90, requiresEvaluationFirst: false },
  ],
  playbook: {
    name: "SystemOps Dental Lab — consultivo v1",
    status: "active",
    toneOfVoice: "acolhedor, claro e consultivo",
    receptionistName: "Marina",
    commercialPolicy: "Apresente somente condições estruturadas nos tratamentos. Não invente desconto, parcelamento, garantia ou prazo. Quando faltar dado, informe que a equipe confirma.",
    notes: "Responda primeiro ao pedido do paciente. Faça no máximo uma pergunta por mensagem. Não invente fatos. Escale quando uma confirmação humana for necessária.",
  },
} as const);

export function digestSystemOpsDentalLabConfig(): string;
export function validateSystemOpsDentalLabSnapshot(snapshot: unknown): ReadonlyArray<string>;
```

O config inclui business hours, agenda interna, profissional fictício, pipeline, endereço explicitamente fictício e playbook consultivo (“responder primeiro, no máximo uma pergunta, não inventar, escalar quando necessário”). Valores de preço aparecem somente nos treatments. O script aceita `--clinic-id`, `--expected-channel-digest` e exatamente um modo `--dry-run | --apply | --verify | --rollback-snapshot <path>`.

- [ ] **Step 1: escrever testes RED de idempotência e ownership**

```ts
it("applies the same desired state twice without duplicate rows", async () => {
  await applyLabConfig(db, exactTarget);
  await applyLabConfig(db, exactTarget);
  expect(await countTreatments(exactTarget.id)).toBe(3);
  expect(await countActivePlaybooks(exactTarget.id)).toBe(1);
});

it("never reads or writes another tenant", async () => {
  await applyLabConfig(db, exactTarget);
  expect(audit.changedClinicIds).toEqual([exactTarget.id]);
});
```

- [ ] **Step 2: rodar RED**

Run: `npm test -- src/__tests__/SystemOpsDentalLabConfig.test.ts src/__tests__/SystemOpsLabReadiness.test.ts`

Expected: FAIL porque desired state e modes ainda não existem.

- [ ] **Step 3: implementar desired state, upserts exatos, snapshot externo e readiness por fase**

O modo apply exige confirmação dupla do ID/digest, salva snapshot em caminho explícito fora do repo antes da primeira write e usa transação. O readiness `preactivation` exige automação off/V1; `smoke` e `ready` exigem status test, Lab predicates, approval adequada, config digest e engine esperada. Não ler tenants de cliente como fonte de conteúdo.

- [ ] **Step 4: rodar GREEN e dry-run sem DB de produção**

Run: `npm test -- src/__tests__/SystemOpsDentalLabConfig.test.ts src/__tests__/SystemOpsLabReadiness.test.ts && npm run typecheck`

Expected: PASS; duas aplicações deixam o mesmo snapshot/digest e nenhum arquivo de snapshot aparece em `git status`.

- [ ] **Step 5: revisão independente e commit**

O reviewer verifica idempotência, transação, alvo exato, rollback, fonte única de preço/editorial, ausência de schema e valores inteiramente fictícios. Corrigir, repetir Step 4 e:

```bash
git add src/application/labs/systemops-dental-lab-config.ts scripts/configure-systemops-dental-lab.ts scripts/verify-systemops-lab.ts src/application/labs/systemops-lab-readiness.ts docs/operations/systemops-lab-runbook.md src/__tests__/SystemOpsDentalLabConfig.test.ts src/__tests__/SystemOpsLabReadiness.test.ts package.json
git commit -m "feat(lab): add idempotent dental lab config"
```

---

### Task 9: Blindar contatos sintéticos e permitir claim exato na queue existente

**Objetivo:** deixar o runner processar somente seus jobs pela infraestrutura atual e tornar tecnicamente impossível enviar WhatsApp a uma persona.

**Files:**
- Create: `src/application/labs/internal-lab-synthetic-delivery.ts`
- Modify: `src/application/ports/job-queue.ts`
- Modify: `src/infrastructure/repositories/drizzle-job-queue.ts`
- Modify: `src/application/ports/outbound-message-store.ts`
- Modify: `src/infrastructure/repositories/drizzle-outbound-message-store.ts`
- Modify: `src/application/jobs/send-message-job.ts`
- Modify: `src/application/replay/replay-outbound-capture.ts`
- Create: `src/__tests__/InternalLabSyntheticDelivery.test.ts`
- Modify: `src/__tests__/DrizzleJobQueue.test.ts`
- Modify: `src/__tests__/SendMessageJob.test.ts`

**Interfaces:**
- Consumes: `ReplayOutboundCapture.createBoundary()`, `SendMessageJobHandler`, `DrizzleJobQueue`, `DrizzleOutboundMessageStore` e approvals registradas.
- Produces:

```ts
export type InternalLabSyntheticRunAuthorization = Readonly<{
  runId: string;
  clinicId: string;
  tenantDigest: string;
  channelDigest: string;
}>;

export function createInternalLabSyntheticAddress(input: {
  runId: string;
  personaId: string;
}): `${string}@lid`;

export function isInternalLabSyntheticAddress(value: string): boolean;

export function registerInternalLabSyntheticRun(input: {
  approval: RegisteredInternalLabApproval;
  clinicId: string;
  runId: string;
  addresses: readonly string[];
}): InternalLabSyntheticRunAuthorization;

export type ClaimNextJobInput = {
  queues: JobQueueName[];
  workerId: string;
  now?: Date;
  dedupeKey?: string;
};

findConversationReplyByTurnId(input: {
  clinicId: string;
  turnId: string;
}): Promise<OutboundMessage | null>;
```

- [ ] **Step 1: escrever testes RED de fail-closed e claim específico**

```ts
it("never calls a provider for a synthetic address without a registered run", async () => {
  await handler.processJob(syntheticJob);
  expect(realBoundary.sendVoiceOrText).not.toHaveBeenCalled();
  expect(store.markOutboundPending).toHaveBeenCalledWith(outboundId, "internal_lab_capture_required");
});

it("captures an authorized synthetic send through SendMessageJobHandler", async () => {
  await capturedHandler.processJob(syntheticJob);
  expect(capture.deliveries).toHaveLength(1);
  expect(realProvider).not.toHaveBeenCalled();
});

it("claims only the requested dedupe key", async () => {
  expect((await queue.claimNextJob({ queues: ["message.process"], workerId, dedupeKey: wanted }))?.dedupeKey).toBe(wanted);
});
```

- [ ] **Step 2: rodar RED**

Run: `npm test -- src/__tests__/InternalLabSyntheticDelivery.test.ts src/__tests__/DrizzleJobQueue.test.ts src/__tests__/SendMessageJob.test.ts`

Expected: FAIL porque o sender ainda não reconhece identidade sintética e a queue não filtra dedupe key.

- [ ] **Step 3: implementar guard antes de `markOutboundProcessing` e filtros atômicos**

Endereços usam `systemops-lab-${runId}-${personaId}@lid`, com charset/length fechados. O sender verifica identidade sintética antes de provider/config; sem token registrado retorna `deferred` e mantém o outbound recuperável. Com token, exige `sandboxCaptureEnabled`, tenant/run/address exatos e usa o capture boundary. `dedupeKey` entra no mesmo `UPDATE ... FOR UPDATE SKIP LOCKED`/claim atômico já usado, não cria fila. O lookup de outbound filtra clinic + payload turnId.

- [ ] **Step 4: rodar GREEN e regressões de sender**

Run: `npm test -- src/__tests__/InternalLabSyntheticDelivery.test.ts src/__tests__/DrizzleJobQueue.test.ts src/__tests__/SendMessageJob.test.ts src/__tests__/OutboundMessagePersistence.test.ts`

Expected: PASS; teste negativo comprova zero chamadas a `resolveChannelConfig`, TTS, media e provider para persona.

- [ ] **Step 5: revisão independente e commit**

O reviewer procura race com o cron, bypass por malformed LID, owner real capturado, autorização reutilizável entre runs e claim amplo. Corrigir, repetir Step 4 e:

```bash
git add src/application/labs/internal-lab-synthetic-delivery.ts src/application/ports/job-queue.ts src/infrastructure/repositories/drizzle-job-queue.ts src/application/ports/outbound-message-store.ts src/infrastructure/repositories/drizzle-outbound-message-store.ts src/application/jobs/send-message-job.ts src/application/replay/replay-outbound-capture.ts src/__tests__/InternalLabSyntheticDelivery.test.ts src/__tests__/DrizzleJobQueue.test.ts src/__tests__/SendMessageJob.test.ts
git commit -m "feat(lab): capture synthetic delivery safely"
```

---

### Task 10: Adicionar personas JSON e runner multi-turn pelo pipeline durável

**Objetivo:** executar cenários sintéticos turno a turno pela inbox persistence, worker, router, V2, outbox e sender reais, usando a resposta persistida como contexto do turno seguinte.

**Files:**
- Create: `evals/systemops-lab/personas/price-scheduling.json`
- Create: `evals/systemops-lab/personas/objection-escalation.json`
- Create: `evals/systemops-lab/personas/booking-revalidation.json`
- Create: `src/application/labs/systemops-lab-persona.ts`
- Create: `scripts/run-systemops-lab-personas.ts`
- Create: `src/__tests__/SystemOpsLabPersonaRunner.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: inbox/webhook persistence existente, `DrizzleJobQueue.claimNextJob({ dedupeKey })`, `ProcessMessageJobHandler`, `findConversationReplyByTurnId`, `SendMessageJobHandler` com capture registrado, `listConversationMessages` e `listClinicConversations`.
- Produces:

```ts
export type SystemOpsLabPersona = Readonly<{
  schemaVersion: 1;
  personaId: string;
  displayName: string;
  scenario: "price_scheduling" | "objection_escalation" | "booking_revalidation";
  turns: readonly Readonly<{
    leadText: string;
    expected: readonly string[];
  }>[];
}>;

export type SystemOpsLabRunResult = Readonly<{
  runId: string;
  personaId: string;
  conversationId: string;
  turns: readonly Readonly<{
    turnId: string;
    leadMessageId: string;
    outboundMessageId: string;
    persistedAgentMessageId: string;
    captured: true;
  }>[];
}>;
```

O CLI exige `--run-id`, `--clinic-id`, `--persona`, `--approval-file` e `--dry-run | --execute`. Ele recusa números E.164/numeric-only, tenants fora da approval e ambiente sem build/config match.

- [ ] **Step 1: escrever teste RED de dois turnos com resposta persistida**

```ts
it("feeds turn N+1 only after the agent reply from turn N exists in messages", async () => {
  const result = await runPersona(twoTurnPersona, harness);
  expect(harness.calls).toEqual([
    "persist-inbound:1", "claim-process:1", "process:1", "claim-send:1", "send-capture:1", "read-messages:1",
    "persist-inbound:2", "claim-process:2", "process:2", "claim-send:2", "send-capture:2", "read-messages:2",
  ]);
  expect(result.turns.every((turn) => turn.captured)).toBe(true);
  expect(await persistedLeads(labId, syntheticAddress)).toHaveLength(1);
  expect(await persistedInboundMessages(result.conversationId)).toHaveLength(2);
  expect(await persistedOutboundMessages(result.conversationId)).toHaveLength(2);
  expect(await persistedMessageOrder(result.conversationId)).toEqual(["lead", "agent", "lead", "agent"]);
  expect((await listClinicConversations({ clinicId: labId, ids: [result.conversationId] })).rows).toHaveLength(1);
  expect((await listClinicConversations({ clinicId: otherTenantId, ids: [result.conversationId] })).rows).toHaveLength(0);
});
```

Testar também abort imediato se capture faltar, outbound não pertencer ao turn, reply não estiver persistida ou provider real for chamado.

- [ ] **Step 2: rodar RED**

Run: `npm test -- src/__tests__/SystemOpsLabPersonaRunner.test.ts src/__tests__/InternalLabSyntheticDelivery.test.ts`

Expected: FAIL por ausência de schemas/personas/runner.

- [ ] **Step 3: implementar parser fechado e orquestração específica do Lab**

Cada turn cria inbound event pelo mecanismo atual, usa dedupe `inbound-event:${eventId}`, claim exato, processa com o handler real, localiza outbox por clinic/turn, claim `outbound-message:${id}`, envia pelo sender real capturado, completa jobs e só então lê `listConversationMessages`. Ao final, usa `listClinicConversations({ clinicId, ids:[conversationId] })`, a mesma query do Inbox atual, para provar visibilidade e isolamento. O runner não chama modelo/core diretamente e não recebe texto do handler como resposta.

- [ ] **Step 4: rodar GREEN e dry-run das três personas**

Run: `npm test -- src/__tests__/SystemOpsLabPersonaRunner.test.ts src/__tests__/InternalLabSyntheticDelivery.test.ts && npm run lab:personas -- --dry-run --run-id dry-run-20260817 --clinic-id 00000000-0000-0000-0000-000000000001 --persona evals/systemops-lab/personas/price-scheduling.json --approval-file /dev/null`

Expected: testes PASS; dry-run valida JSON e imprime somente IDs/digests/contagens, sem tentar DB, model ou channel.

- [ ] **Step 5: revisão independente e commit**

O reviewer rastreia cada etapa ao runtime existente, confirma que a resposta vem de messages e procura qualquer channel call não capturada ou engine chamada direta. Corrigir, repetir Step 4 e:

```bash
git add evals/systemops-lab/personas/price-scheduling.json evals/systemops-lab/personas/objection-escalation.json evals/systemops-lab/personas/booking-revalidation.json src/application/labs/systemops-lab-persona.ts scripts/run-systemops-lab-personas.ts src/__tests__/SystemOpsLabPersonaRunner.test.ts package.json
git commit -m "feat(lab): add durable multi-turn personas"
```

---

### Task 11: Gerar transcripts, traces e automated evals auditáveis

**Objetivo:** renderizar somente os quatro artifacts autorizados, medir apenas afirmações sustentadas por persistence/trace e manter owner/human review explicitamente pendentes.

**Files:**
- Create: `src/application/labs/systemops-lab-evidence.ts`
- Create: `scripts/render-systemops-lab-evidence.ts`
- Create: `src/__tests__/SystemOpsLabEvidence.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `SystemOpsLabRunResult`, `listConversationMessages`, Decision Trace sanitizado, `measureProse` de `src/application/corpus/eval-prose.ts`, authorized plan/validator/outcome existentes.
- Produces:

```ts
export type SystemOpsLabEvaluation = Readonly<{
  schemaVersion: 1;
  runId: string;
  personaId: string;
  automatedStatus: "pass" | "fail" | "not_measurable";
  checks: readonly Readonly<{
    id: "factual_correctness" | "unauthorized_facts" | "price_subject_binding" | "scheduling_correctness" | "outcome_inversion" | "escalation" | "invented_commitment" | "relevance" | "journey_advancement" | "critical_regression" | "safety";
    status: "pass" | "fail" | "not_measurable";
    evidence: readonly string[];
  }>[];
  humanReview: "pending";
  ownerReview: "pending";
}>;

export function writeSystemOpsLabEvidence(input: {
  outputRoot: "evals/systemops-lab";
  run: SystemOpsLabRunResult;
  messages: readonly SanitizedTranscriptMessage[];
  trace: readonly SanitizedLabTraceEvent[];
}): Promise<SystemOpsLabEvaluation>;
```

- [ ] **Step 1: escrever testes RED de allowlist, entailment e review pendente**

```ts
it("writes exactly three run files plus latest-summary", async () => {
  await writeSystemOpsLabEvidence(fixture);
  expect(relativeFiles(outputRoot)).toEqual([
    `${runId}/evaluation.json`, `${runId}/trace.json`, `${runId}/transcript.md`, "latest-summary.md",
  ]);
});

it("never promotes human or owner review", async () => {
  const evaluation = await writeSystemOpsLabEvidence(fixture);
  expect(evaluation.humanReview).toBe("pending");
  expect(evaluation.ownerReview).toBe("pending");
  expect(readTranscript()).toContain("OWNER REVIEW: PENDING");
});
```

Testar secret/PII scanner, unauthorized price, subject binding, booking failure inversion e `not_measurable` sem evidence ref válida.

- [ ] **Step 2: rodar RED**

Run: `npm test -- src/__tests__/SystemOpsLabEvidence.test.ts`

Expected: FAIL porque writer/evaluator ainda não existem.

- [ ] **Step 3: implementar renderer determinístico sem framework genérico**

`transcript.md` lista persona, cenário, mensagens sintéticas reais persistidas, resultado automático, `OWNER REVIEW: PENDING` e comandos/instruções para aprovar, marcar ruim ou criar regressão. `trace.json` usa allowlist da spec; `evaluation.json` usa somente evidence refs verificadas; `latest-summary.md` liga run/persona/status/transcript/review. Escrever arquivos atomicamente e recusar overwrite de run id existente.

- [ ] **Step 4: rodar GREEN e auditoria de fixtures**

Run: `npm test -- src/__tests__/SystemOpsLabEvidence.test.ts src/__tests__/V2AuthorizedResponsePlan.test.ts src/__tests__/V2SemanticDraftValidator.test.ts`

Expected: PASS; o scanner de teste rejeita telefone, e-mail, secret, URL privada e provider payload.

- [ ] **Step 5: revisão independente e commit**

O reviewer confere a seção 15 da spec campo a campo, procura avaliação não sustentada, PII, novos artifacts e qualquer `PASS` humano. Corrigir, repetir Step 4 e:

```bash
git add src/application/labs/systemops-lab-evidence.ts scripts/render-systemops-lab-evidence.ts src/__tests__/SystemOpsLabEvidence.test.ts package.json
git commit -m "feat(lab): generate auditable V2 evidence"
```

---

### Task 12: Fechar verificação, runbook e preparação de release

**Objetivo:** demonstrar que o conjunto está pronto para PR/deploy sem alterar production state e documentar comandos fail-closed para measurement, smoke, rollback e handoff.

**Files:**
- Modify: `docs/operations/systemops-lab-runbook.md`
- Create: `src/__tests__/arch/SystemOpsLabScope.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: todos os contratos anteriores, scripts do Cycle I existentes, `git-cycle-i-build-attestation.ts` e fluxo de change control.
- Produces: runbook executável com preconditions/postconditions e checklist de release; nenhum runtime interface novo.

- [ ] **Step 1: escrever RED de scope/YAGNI e documentação operacional**

```ts
it("keeps Lab additions inside the approved file families", () => {
  expect(unapprovedNewWorkers()).toEqual([]);
  expect(unapprovedSchemaChanges()).toEqual([]);
  expect(unapprovedDashboardsOrInbox()).toEqual([]);
});

it("documents exact stop and rollback commands for every production gate", () => {
  expect(runbook).toContain("V2 -> V1 -> V2");
  expect(runbook).toContain("OWNER REVIEW: PENDING");
  expect(runbook).toContain("npm run verify");
});
```

- [ ] **Step 2: rodar RED**

Run: `npm test -- src/__tests__/arch/SystemOpsLabScope.test.ts`

Expected: FAIL até o runbook conter preconditions, comandos, expected outputs, stop conditions e rollback completo.

- [ ] **Step 3: completar o runbook com a sequência operacional exata**

Documentar sem secrets: gerar chaves fora do repo; obter config/tenant/channel digests; executar Cycle I final nos bytes limpos; emitir approval smoke curta; deploy global V1; confirmar commit/tree/runtime; apply/verify Lab; ativar somente Lab; smoke owner; rollback V2/V1/V2; personas; evidence/Inbox; emitir READY; restaurar V2. Para cada comando registrar expected decision e condição que retorna engine a V1. Explicitar gates HUMAN (`aprovação de PR`, `promoção main`, `owner WhatsApp`, `owner review`) e PLATFORM (`CI`, `Vercel deploy`, `cron`, `DB`, `WhatsApp`).

- [ ] **Step 4: executar verificação local completa em árvore limpa de segredos**

Run:

```bash
npm test -- src/__tests__/TenantEngineRouter.test.ts src/__tests__/ConversationV2InternalLabApproval.test.ts src/__tests__/V2LiveConversationHandler.test.ts src/__tests__/ConversationV2LiveIsolation.test.ts src/__tests__/ConversationV2BidirectionalRollback.test.ts src/__tests__/InternalLabSyntheticDelivery.test.ts src/__tests__/SystemOpsLabPersonaRunner.test.ts src/__tests__/SystemOpsLabEvidence.test.ts src/__tests__/arch/TenantEngineRouterBoundary.test.ts src/__tests__/arch/SystemOpsLabScope.test.ts
npm test -- src/__tests__/SlotEngine.test.ts src/__tests__/BookingDoubleBooking.test.ts src/__tests__/SlotDayPreference.test.ts src/__tests__/ClinicTimezone.test.ts
npm run verify
git diff --check
```

Expected: todos PASS; `npm run verify` roda exatamente sem database de produção. Se algum comando falhar, parar, registrar branch/hash/comando/escopo e corrigir apenas a causa antes de prosseguir.

- [ ] **Step 5: revisão independente final e commit**

Usar `superpowers:requesting-code-review` para revisão integral contra a spec. Nenhum `Critical`/`Important` pode permanecer; corrigir, repetir toda a Step 4 e:

```bash
git add docs/operations/systemops-lab-runbook.md src/__tests__/arch/SystemOpsLabScope.test.ts README.md
git commit -m "docs(lab): finalize V2 activation runbook"
```

Depois do commit, rodar `npm run verify` novamente e guardar somente o resumo sanitizado para a descrição do PR.

---

## Release Gates — executar somente após as 12 Tasks

Estes gates mudam estado compartilhado e dependem de aprovações humanas/plataforma. Eles não são Tasks de código, não criam commits artificiais e não podem ser simulados como concluídos.

### Release Gate A: PR, CI e promoção do build final

- [ ] Confirmar branch, árvore limpa e hashes com `git status --short`, `git rev-parse HEAD`, `git rev-parse HEAD^{tree}`.
- [ ] Rodar `npm run verify` exatamente e os quatro testes focados de agenda.
- [ ] Push da branch e PR para `develop`; aguardar CI/preview verdes e aprovação humana.
- [ ] Merge aprovado em `develop`; validar manualmente; abrir/prometer `develop -> main`; aguardar aprovação e CI.
- [ ] Proibir push direto a `main`. Qualquer novo commit invalida as attestations e reinicia measurement/approval.

### Release Gate B: measurement e approval vinculados aos bytes finais

- [ ] No commit limpo que será deployado, executar `npm run eval:conversation-v2:cycle-i` com manifest/keys dedicadas fora do repo.
- [ ] Confirmar que Cycle I reporta honestamente `NO_GO` e qualitative/human review como `not_measurable` ou `pending_human_review`.
- [ ] Executar config `--dry-run` para obter `tenantDigest`, `channelDigest` e `configDigest` sem write.
- [ ] Emitir `INTERNAL_LAB_SMOKE_AUTHORIZED` com expiração curta, `evidenceDigests` contendo verification/review e binding aos hashes anteriores; registrar somente public key/approval protegidas na plataforma.
- [ ] Se build/config/gate digest divergir, não ativar; emitir nova approval a partir dos bytes reais.

### Release Gate C: deploy global V1, Lab e rollback bidirecional

- [ ] Fazer deploy do `main` aprovado com todos os tenants em V1; confirmar commit/tree/runtime na plataforma.
- [ ] Rodar `configure-systemops-dental-lab --apply` apenas para o ID/digest aprovado, guardar snapshot fora do repo e executar `--verify`.
- [ ] Ativar `v2_internal` apenas no Lab e fazer smoke sintético capturado.
- [ ] Testar o número real do owner separadamente pelo WhatsApp real; confirmar resposta V2 no provider e na Inbox. Não incluir telefone/transcript real nos artifacts.
- [ ] Em três turnos da mesma conversa, definir V2, depois V1, depois V2; confirmar engine trace, mesmo conversation/state, dedupe, outbox ordering e booking único.
- [ ] Falha em qualquer item: trocar o Lab para V1 antes do turno seguinte, manter os demais tenants em V1 e usar snapshot apenas se a configuração estiver corrompida.

### Release Gate D: personas, evidence, Inbox e `INTERNAL_LAB_READY`

- [ ] Para cada persona, escolher run id imutável, registrar capture authorization e executar `npm run lab:personas -- --execute ...`.
- [ ] Confirmar zero provider call, cada inbound/outbound/message persistido no tenant Lab e conversa completa visível no Inbox atual.
- [ ] Renderizar exatamente `transcript.md`, `trace.json`, `evaluation.json` por run e atualizar `latest-summary.md`; executar scanner de PII/secrets antes do commit desses artifacts.
- [ ] Calcular os `evidenceDigests` tipados sobre os bytes finais de smoke/rollback/personas/Inbox/observability e emitir `INTERNAL_LAB_READY` sem expiração, vinculada ao mesmo build/config/tenant/channel.
- [ ] Registrar READY protegida, manter `conversation_engine=v2_internal` somente no Lab e repetir readiness remoto.
- [ ] Entregar ao owner: Inbox atual, conversa do telefone real, transcripts sintéticos, botões/processo `APROVAR | RUIM | CRIAR REGRESSÃO`, rollback seguro e `OWNER REVIEW: PENDING`.
- [ ] Feedback ruim vira corpus/regression test/fix em mudança posterior; não editar a evidência original nem declarar review humano como PASS.

---

## Matriz de rastreabilidade da spec

| Spec | Implementação / prova |
| --- | --- |
| 1. Objetivo | Tasks 5–12; Release Gates A–D |
| 2. Decisão prospectiva e limites de authority | Task 1; Gate B; Global Constraints |
| 3. Ordem de execução | sequência de dependências; Gates A–D |
| 4. Único boundary | Tasks 2 e 6; `TenantEngineRouterBoundary.test.ts` |
| 5. Sem fallback no turno | Tasks 2, 5 e 7 |
| 6. Shell live mínimo | Tasks 3–6 |
| 7. Estado, dedupe e atomicidade | Tasks 3, 5, 7 e 9 |
| 8. Rollback bidirecional | Task 7; Gate C |
| 9. Approval Internal Lab | Task 1; Gates B e D |
| 10. SystemOps Dental Lab | Task 8 |
| 11. Configuração odontológica | Tasks 4 e 8 |
| 12. Personas multi-turn | Task 10 |
| 13. Entrega segura | Tasks 9 e 10; Gate D |
| 14. Número real do owner | Gate C |
| 15. Artifacts e avaliação | Task 11; Gate D |
| 16. Observabilidade e privacidade | Tasks 5, 9 e 11 |
| 17. Change control e deploy | Task 12; Gates A–C |
| 18. Verificação | Tasks 7, 9, 11 e 12; Gates C–D |
| 19. Critério de conclusão | checklist literal abaixo |
| 20. Fora de escopo | Global Constraints; `SystemOpsLabScope.test.ts` |

### Conferência literal do critério de conclusão da seção 19

1. Build aprovado em produção — Release Gate A/C.
2. `INTERNAL_LAB_READY` válido para um único tenant/canal interno — Task 1 e Gate D.
3. Lab configurado idempotentemente — Task 8 e Gate C.
4. Estado final `conversation_engine = v2_internal` — Gate D.
5. Número real do owner recebe resposta V2 — Gate C.
6. Personas atravessam persistence, engine e outbox reais — Tasks 9–10 e Gate D.
7. Nenhuma persona tenta delivery externo — Task 9 e Gate D.
8. Conversas completas aparecem no Inbox atual — Task 10 e Gate D.
9. Rollback `V2 -> V1 -> V2` comprovado — Task 7 e Gate C.
10. Automated evals e artifacts gerados — Task 11 e Gate D.
11. `OWNER REVIEW: PENDING` e instruções presentes — Task 11 e Gate D.
12. Cycle I e human-review reportados honestamente — Task 1, Gate B e Gate D.

## Riscos e blockers explícitos

- **Authority circular:** qualquer commit após measurement muda os bytes. Mitigação: measurement/approval só depois do merge/promoção final; novo byte reinicia Gate B.
- **Cron concorrente com runner:** o worker normal pode ver jobs sintéticos. Mitigação: sender fail-closed antes de provider e claim por dedupe key exata; zero dependência de timing.
- **Status `test` hoje é disabled:** abrir genericamente exporia tenants. Mitigação: wrapper da Task 2 exige todos os predicates e approval exata, independentemente da engine para permitir rollback V1.
- **Dedupe V1 está embutido no orchestrator:** duplicá-lo no V2 criaria divergência. Mitigação: seam restrito da Task 3, com regression tests V1 e unique index existente.
- **Write/action parcialmente concluída:** repetir poderia duplicar booking. Mitigação: prepared token, `BookingService`, dedupe/outbox e failure contract sem fallback.
- **Config real indisponível ou divergente:** approval não pode ser emitida corretamente. Mitigação: dry-run/digest antes de apply; activation para em V1 até target/channel/config exatos estarem disponíveis.
- **Gates HUMAN/PLATFORM:** PR approval, CI, promoção, deploy, credenciais, WhatsApp real e owner review não podem ser fabricados pelo executor. Mitigação: parar no gate, reportar evidência disponível e aguardar a autoridade correta.
- **Cycle I continua NO_GO:** isso é esperado e obrigatório até os dois reviewers calibrados. Mitigação: a authority interna não altera esse resultado nem autoriza tenant externo.

## Self-review do plano

1. **Todos os requisitos da spec -> Task:** as 20 seções estão na matriz de rastreabilidade; cada requisito operacional chega também a um Release Gate.
2. **Requisito sem Task:** nenhum encontrado. Os itens que não são código — PR approval, CI, promoção, deploy, WhatsApp real e owner review — estão marcados como gates HUMAN/PLATFORM, sem bypass.
3. **Task sem requisito:** nenhuma encontrada. Tasks 1–12 rastreiam authority, router, shell/lifecycle/adapters, invariantes, Lab config, capture/personas, evidence e change control previstos nas seções 2–18.
4. **Placeholders:** scan limpo. O plano contém conteúdo, tipos, arquivos, comandos, expected outcomes e stop conditions concretos; `<run-id>`/`${runId}` representam input runtime validado, não trabalho omitido.
5. **Interfaces/type names:** conferidos entre produtores e consumidores; `ConversationHandler`, `RegisteredInternalLabApproval`, `InternalLabEligibilityReader`, `LiveTurnLifecycle`, `createDentalLiveAdapters`, `V2LiveConversationHandler`, queue/outbox lookups e result/evidence types mantêm a mesma grafia.
6. **Dependências e ordem:** authority/router/lifecycle/adapters precedem handler/composição; shell revisado precede measurement; measurement/approval usam os bytes finais; deploy precede smoke/READY.
7. **Escopo mínimo por Task:** cada Task tem um owner claro e um gate de review. Nenhuma cria schema, worker, queue, sender, outbox, BookingService, Inbox, dashboard, capability, intelligence behavior ou framework; o seam V1 limita-se ao lifecycle compartilhado.
8. **Deploy protegido:** nenhuma ação de produção começa antes de review integral, `npm run verify`, PR/CI, promoção aprovada, measurement final e approval smoke vinculada. Qualquer divergência mantém/retorna o Lab a V1 no turno seguinte.
9. **Conclusão literal da seção 19:** os 12 itens aparecem, na mesma ordem e sem redução, na conferência imediatamente anterior; `INTERNAL_LAB_READY` só é emitido após todos e Cycle I/human/owner review continuam honestamente pendentes.
