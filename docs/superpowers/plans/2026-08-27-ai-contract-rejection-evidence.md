# AI Contract Rejection Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar toda saída de IA rejeitada pelo runtime conversacional V2 explicável por causa estruturada e, por sete dias, por conteúdo bruto criptografado revelável somente ao Owner com auditoria.

**Architecture:** O schema Zod dental passa a ser a única fonte estrutural para OpenAI e parser, enquanto regras relacionais ficam em um validador semântico separado. Callbacks estreitas observam rejeições nos limites de Understanding e verbalização sem inserir raw em outcomes ou erros; um recorder best-effort criptografa com chave dedicada e persiste por statement tenant-scoped. O Decision Trace recebe apenas códigos/status/referência opaca, e a revelação Owner decripta em memória somente depois de validar tenant e antes de registrar um audit obrigatório.

**Tech Stack:** TypeScript 5.8, Next.js 16 Route Handlers, OpenAI SDK 6 `zodResponseFormat`, Zod 3.25, Drizzle ORM/Kit, PostgreSQL 17 via `embedded-postgres`, Node `crypto` AES-256-GCM, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-26-ai-contract-rejection-evidence-design.md`

## Global Constraints

- O runtime V2-only, `conversation_authority.version >= 2`, kill switch, tenant permit, outbox e sender não mudam nesta frente.
- O LLM entende e verbaliza; o sistema decide. Evidência observa e nunca decide, recompõe, reabre ou reenvia um turno.
- Não armazenar prompt, histórico, mensagem do lead, telefone, payload de provider, stack ou mensagens livres de erro.
- Raw rejeitado: AES-256-GCM com `AI_EVIDENCE_ENCRYPTION_KEY`, AAD tenant/evidence/turn/stage, limite UTF-8 de 65.536 bytes e retenção máxima de 7 dias.
- Metadados e audit: retenção máxima de 30 dias; limpeza em lotes de no máximo 500 pelo cron existente.
- Uma saída aceita adiciona zero queries, writes, jobs, outbounds ou chamadas ao modelo.
- Migrations começam em `src/infrastructure/db/schema.ts`, são produzidas somente por `npm run db:generate` e o SQL gerado não é editado.
- Testes PostgreSQL usam apenas o helper embedded autorizado e executam com zero skips; `.env.local`, Neon e produção não participam.
- Nenhum merge, push, deploy, ativação de tenant ou tráfego real faz parte deste plano.
- A estratégia híbrida de uma ou duas chamadas de modelo fica fora deste PR; será especificada com os dados desta evidência.

## File and responsibility map

| Arquivo | Responsabilidade única |
| --- | --- |
| `src/domain-packs/dental/understanding.ts` | Schema estrutural Zod e validador semântico dental, sem OpenAI ou persistência. |
| `src/application/ports/ai-contract-rejection-recorder.ts` | Tipos fechados, contexto tenant/turno e porta best-effort de captura. |
| `src/infrastructure/crypto/ai-evidence-vault.ts` | Envelope AES-256-GCM e AAD, sem banco ou sessão. |
| `src/infrastructure/observability/runtime-ai-contract-rejection-recorder.ts` | Hash/tamanho/status/retention e composição vault + store. |
| `src/infrastructure/repositories/drizzle-ai-contract-rejection-store.ts` | Insert tenant-scoped, dedupe, listas sem ciphertext, reveal row, audit e cleanup bounded. |
| `src/infrastructure/adapters/ai/OpenAIDentalUnderstandingModel.ts` | Chamada OpenAI e retorno do conteúdo bruto em memória. |
| `src/infrastructure/adapters/ai/DentalUnderstandingProvider.ts` | Decode, parse estrutural, regra semântica e callback de rejeição. |
| `src/conversation-core/composer/response-pipeline.ts` | Validação do texto e callback de recusa sem raw no outcome. |
| `src/application/conversation-v2/v2-live-conversation-handler.ts` | Acrescenta contexto exato e correlação sanitizada ao recorder/trace. |
| `src/app/api/conversations/[conversationId]/decision-trace/route.ts` | Anexa resumo somente para sessão Owner, sem ciphertext/hash. |
| `src/app/api/owner/clinics/[clinicId]/ai-contract-rejections/[rejectionId]/route.ts` | Revelação individual Owner, tenant-scoped, auditada e `no-store`. |
| `src/app/api/cron/decision-trace-cleanup/route.ts` | Reusa o cron para expiração/deleção bounded. |
| `docs/operations/ai-contract-rejection-evidence.md` | Chave, retenção, diagnóstico, rollout e rollback operacional. |

---

### Task 1: Canonical Understanding contract and semantic boundary

**Files:**
- Modify: `src/domain-packs/dental/understanding.ts`
- Modify: `src/infrastructure/adapters/ai/OpenAIDentalUnderstandingModel.ts`
- Modify: `src/infrastructure/adapters/ai/DentalUnderstandingProvider.ts`
- Test: `src/__tests__/DentalUnderstandingContract.test.ts`
- Test: `src/__tests__/DentalUnderstandingProvider.test.ts`
- Test: `src/__tests__/UnderstandingSchemaAgreement.test.ts`
- Test: `src/__tests__/DentalReceptionCoverage.test.ts`
- Test: `src/__tests__/DentalUnderstandingCoverageMatrix.test.ts`

**Interfaces:**
- Produces: `dentalUnderstandingStructureSchema`, `parseDentalUnderstandingStructure(value)`, `validateDentalUnderstandingSemantics(value)` and compatibility function `parseDentalUnderstanding(value)`.
- Produces: `DentalUnderstandingSemanticIssue = { path: readonly string[]; code: "service_required_for_request" }`.
- Produces: `DentalUnderstandingModel.generate(...): Promise<string | null>`; no adapter-level `JSON.parse`.
- Consumes later: Tasks 4 and 5 use the structural/semantic issue vocabulary; the OpenAI request uses `zodResponseFormat(dentalUnderstandingStructureSchema, "dental_understanding_v1")`.

- [ ] **Step 1: Write the RED contract tests**

Add exact assertions that `price-of-service` with `service:null` passes `dentalUnderstandingStructureSchema.safeParse`, fails `validateDentalUnderstandingSemantics` with only:

```ts
[{ path: ["entities", "service"], code: "service_required_for_request" }]
```

Assert a valid value survives `parseDentalUnderstanding`, unknown keys fail structurally, and provider JSON Schema is no longer a handwritten `responseSchema` constant.

- [ ] **Step 2: Run RED**

Run:

```bash
npx vitest run src/__tests__/DentalUnderstandingContract.test.ts src/__tests__/DentalUnderstandingProvider.test.ts src/__tests__/UnderstandingSchemaAgreement.test.ts src/__tests__/DentalReceptionCoverage.test.ts src/__tests__/DentalUnderstandingCoverageMatrix.test.ts
```

Expected: failure because semantic parsing is still hidden in `superRefine`, model output is `unknown`, and the adapter still owns a manual schema.

- [ ] **Step 3: Implement the structural schema and semantic result**

Use this public result shape:

```ts
export type DentalUnderstandingSemanticValidation =
  | Readonly<{ valid: true }>
  | Readonly<{ valid: false; issues: readonly DentalUnderstandingSemanticIssue[] }>;
```

The structural schema must exactly own `version`, request enum, dialogue move, the seven entity keys, four signal keys, three safety keys, confidence and nullable ambiguity. `parseDentalUnderstanding` composes structure then semantics and throws a typed error containing issue codes/paths only.

- [ ] **Step 4: Generate OpenAI format from the same schema**

Import `zodResponseFormat` from `openai/helpers/zod`; pass its return value directly as `response_format`. `OpenAIDentalUnderstandingModel.generate` returns `content` or `null` without parsing and preserves abort behavior.

- [ ] **Step 5: Run GREEN and refactor**

Run the command from Step 2, then:

```bash
npx eslint src/domain-packs/dental/understanding.ts src/infrastructure/adapters/ai/OpenAIDentalUnderstandingModel.ts src/infrastructure/adapters/ai/DentalUnderstandingProvider.ts src/__tests__/DentalUnderstandingContract.test.ts src/__tests__/DentalUnderstandingProvider.test.ts src/__tests__/UnderstandingSchemaAgreement.test.ts
npm run typecheck
```

Expected: all selected tests, lint and typecheck pass. Confirm `rg -n "const responseSchema|json_schema:.*schema:" src/infrastructure/adapters/ai/OpenAIDentalUnderstandingModel.ts` returns no manual schema.

- [ ] **Step 6: Commit**

```bash
git add src/domain-packs/dental/understanding.ts src/infrastructure/adapters/ai/OpenAIDentalUnderstandingModel.ts src/infrastructure/adapters/ai/DentalUnderstandingProvider.ts src/__tests__/DentalUnderstandingContract.test.ts src/__tests__/DentalUnderstandingProvider.test.ts src/__tests__/UnderstandingSchemaAgreement.test.ts src/__tests__/DentalReceptionCoverage.test.ts src/__tests__/DentalUnderstandingCoverageMatrix.test.ts
git commit -m "refactor(v2): unify dental understanding contract"
```

### Task 2: Rejection recorder contract and dedicated evidence vault

**Files:**
- Create: `src/application/ports/ai-contract-rejection-recorder.ts`
- Create: `src/infrastructure/crypto/ai-evidence-vault.ts`
- Create: `src/infrastructure/observability/runtime-ai-contract-rejection-recorder.ts`
- Test: `src/__tests__/AiContractRejectionRecorder.test.ts`
- Test: `src/__tests__/AiEvidenceVault.test.ts`

**Interfaces:**
- Produces: `AiContractRejectionStage`, `AiContractRejectionIssueCode`, `CaptureAiContractRejectionInput`, `AiContractRejectionCaptureResult`, `AiContractRejectionRecorder` and `captureAiContractRejectionBestEffort`.
- Produces: `sealAiEvidence(rawOutput, aad, keyHex?)` and `openAiEvidence(envelope, aad, keyHex?)` with prefix `aiev:v1:`.
- Produces: `RuntimeAiContractRejectionRecorder` consuming `AiContractRejectionStore` and `AiEvidenceVault` ports.
- Consumes later: Drizzle store in Task 3; runtime callbacks in Tasks 4 and 5; reveal service in Task 6.

- [ ] **Step 1: Write RED port/crypto tests**

The port contract is:

```ts
export type CaptureAiContractRejectionInput = Readonly<{
  organizationId: string;
  conversationId: string;
  inboundEventId: string;
  turnId: string;
  stage: "understanding_structural" | "understanding_semantic" | "response_verbalization";
  modelId: string;
  promptVersion: string;
  contractVersion: string;
  attempt: number;
  rawOutput: string | null;
  issues: readonly Readonly<{ path: readonly string[]; code: AiContractRejectionIssueCode }>[];
  occurredAt: Date;
}>;

export type AiContractRejectionCaptureResult = Readonly<{
  status: "stored" | "deduplicated" | "oversized" | "no_raw_output" |
    "encryption_unavailable" | "persistence_failed";
  evidenceRef?: string;
}>;
```

Test 65.536 bytes stored, 65.537 bytes oversized, null output `no_raw_output`, same plaintext has stable SHA-256, and identical input uses a stable dedupe tuple. Test that `captureAiContractRejectionBestEffort` converts any throw to `persistence_failed`.

For the vault, assert round trip, random IVs, wrong organization/evidence/turn/stage AAD rejection, malformed envelope rejection, missing/invalid dedicated key rejection, and absence of plaintext in the envelope.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/__tests__/AiContractRejectionRecorder.test.ts src/__tests__/AiEvidenceVault.test.ts
```

Expected: module-not-found failures only.

- [ ] **Step 3: Implement minimal pure contracts and vault**

`AiEvidenceAad` has exactly `version`, `organizationId`, `rejectionId`, `turnId`, `stage`; canonicalize with a fixed-key JSON tuple, use 12-byte IV and 16-byte GCM tag, and read only `AI_EVIDENCE_ENCRYPTION_KEY` when no test key is injected.

`RuntimeAiContractRejectionRecorder.capture` generates the rejection UUID before sealing, computes UTF-8 bytes/hash, chooses one capture status, and calls one store insertion. Encryption failure still asks the store to persist sanitized metadata with `encryptedOutput:null`; persistence failure returns `persistence_failed`. It never logs or throws.

- [ ] **Step 4: Run GREEN, benchmark and refactor**

```bash
npx vitest run src/__tests__/AiContractRejectionRecorder.test.ts src/__tests__/AiEvidenceVault.test.ts
npx eslint src/application/ports/ai-contract-rejection-recorder.ts src/infrastructure/crypto/ai-evidence-vault.ts src/infrastructure/observability/runtime-ai-contract-rejection-recorder.ts src/__tests__/AiContractRejectionRecorder.test.ts src/__tests__/AiEvidenceVault.test.ts
npm run typecheck
```

Add a deterministic 200-iteration test around 64 KiB seal operations and require p95 <= 5 ms without printing key/plaintext.

- [ ] **Step 5: Commit**

```bash
git add src/application/ports/ai-contract-rejection-recorder.ts src/infrastructure/crypto/ai-evidence-vault.ts src/infrastructure/observability/runtime-ai-contract-rejection-recorder.ts src/__tests__/AiContractRejectionRecorder.test.ts src/__tests__/AiEvidenceVault.test.ts
git commit -m "feat(v2): define encrypted rejection evidence boundary"
```

### Task 3: Durable schema, generated migration and tenant-scoped store

**Files:**
- Modify: `src/infrastructure/db/schema.ts`
- Create: Drizzle-generated migration `0104` for the prerequisite
  `inbound_events_id_org_unique`
- Create: Drizzle-generated migration `0105` for evidence enums, tables,
  constraints and indexes
- Modify: `drizzle/meta/_journal.json`
- Create: the Drizzle-generated `drizzle/meta/0104_snapshot.json`
- Create: the Drizzle-generated `drizzle/meta/0105_snapshot.json`
- Create: `src/infrastructure/repositories/drizzle-ai-contract-rejection-store.ts`
- Create: `src/__tests__/AiContractRejectionDatabase.test.ts`
- Modify: `src/__tests__/DatabaseTestCommandIsolation.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: recorder/store input from Task 2.
- Produces: tables `ai_contract_rejections`, `ai_contract_rejection_access_audits`; composite inbound unique `inbound_events_id_org_unique`.
- Produces store methods: `insert`, `listByConversation`, `findRevealable`, `recordRevealAudit`, `expireRaw`, `deleteExpiredMetadata`.
- Produces persisted statuses: `stored`, `oversized`, `no_raw_output`, `encryption_unavailable`, `expired`.

- [ ] **Step 1: Add RED embedded PostgreSQL tests**

Use `startEmbeddedAuthorityDatabase()` and `drizzle-orm/node-postgres`. Cover:

1. valid active stream/inbound/conversation inserts one row;
2. retry of organization/turn/stage/hash deduplicates;
3. different raw hash creates a second row;
4. wrong organization, conversation, inbound or inactive/mismatched stream inserts nothing and returns `persistence_failed` at recorder boundary;
5. list excludes `encrypted_output` and `output_sha256`;
6. access audit requires matching `(rejection_id, organization_id)`;
7. accepted path fake recorder receives zero store calls;
8. warm capture p95 <= 250 ms and one insert round trip.

- [ ] **Step 2: Register and run the RED database suite**

Append `src/__tests__/AiContractRejectionDatabase.test.ts` to `test:db:authority`, exclude it from normal `test`, and add its source to `DatabaseTestCommandIsolation.test.ts` no-skip inspection. Run:

```bash
npm run test:db:authority
```

Expected: existing database tests pass; the new file executes and fails because schema/store are absent, with zero skips and no credential/network/setup error.

- [ ] **Step 3: Add schema constraints**

Define closed pg enums for rejection stage, capture status and access action. Add checks for attempt >= 1, nonempty issue array, SHA-256 hex, nonnegative bytes, `turn_id = inbound_event_id::text`, `raw_expires_at <= metadata_expires_at`, and status/ciphertext consistency. Add composite FKs to organization-scoped conversation/inbound/rejection and the indexes/unique key from the spec.

- [ ] **Step 4: Generate and review migration**

```bash
npm run db:generate
git diff -- src/infrastructure/db/schema.ts drizzle
rg -n "DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|ALTER COLUMN.*TYPE" drizzle/0104_*.sql drizzle/0105_*.sql
```

Expected: two additive generated migrations. `0104` must establish the composite
inbound key before `0105` creates the FK that references it. This split is required
because PostgreSQL validates the referenced uniqueness when the FK statement runs,
while Drizzle may order a newly generated table/FK before an unrelated constraint in
one migration. The destructive scan has no matches. Do not edit generated SQL or
snapshots.

- [ ] **Step 5: Implement the bounded store**

`insert` must be one `INSERT ... SELECT` joining exact inbound, exact organization and active stream whose `conversation_id` equals the supplied conversation. It uses generated `rejectionId`, `ON CONFLICT (organization_id, turn_id, stage, output_sha256) DO NOTHING`, then an indexed exact-key read only to distinguish `stored` from `deduplicated`. No application read validates tenant before insert.

Lists select an explicit allowlist. Cleanup first selects at most 500 indexed IDs, then updates/deletes only those IDs. `recordRevealAudit` inserts with expiry copied from the parent row by `INSERT ... SELECT` and fails closed when no parent matches.

- [ ] **Step 6: Run GREEN and migration gates**

```bash
npm run test:db:authority
npm run test:db:schema
npm run db:check
npx vitest run src/__tests__/DatabaseTestCommandIsolation.test.ts
npx eslint src/infrastructure/db/schema.ts src/infrastructure/repositories/drizzle-ai-contract-rejection-store.ts src/__tests__/AiContractRejectionDatabase.test.ts src/__tests__/DatabaseTestCommandIsolation.test.ts
npm run typecheck
git diff --check
```

Expected: all authority tests execute with zero skips; migration metadata and schema suite are green.

- [ ] **Step 7: Commit schema separately**

```bash
git add src/infrastructure/db/schema.ts drizzle package.json src/__tests__/DatabaseTestCommandIsolation.test.ts src/infrastructure/repositories/drizzle-ai-contract-rejection-store.ts src/__tests__/AiContractRejectionDatabase.test.ts
git commit -m "feat(v2): persist tenant-scoped rejection evidence"
```

### Task 4: Understanding rejection capture and sanitized correlation

**Files:**
- Modify: `src/infrastructure/adapters/ai/DentalUnderstandingProvider.ts`
- Modify: `src/infrastructure/adapters/ai/live-dental-understanding.ts`
- Modify: `src/application/conversation-v2/v2-live-conversation-handler.ts`
- Modify: `src/application/conversation-v2/understanding-failure-code.ts`
- Modify: `src/core/observability/DecisionTrace.ts`
- Modify: `src/infrastructure/conversation-v2/create-conversation-v2-runtime.ts`
- Test: `src/__tests__/DentalUnderstandingProvider.test.ts`
- Test: `src/__tests__/UnderstandingFailureCode.test.ts`
- Test: `src/__tests__/V2LiveConversationHandler.test.ts`
- Test: `src/__tests__/DecisionTracePrivacy.test.ts`

**Interfaces:**
- Produces provider callback `onContractRejection(rejection): void | Promise<void>` where rejection contains stage/model/prompt/contract/raw/issues but no tenant data.
- Consumes recorder from Task 2; handler adds exact organization/conversation/inbound/turn and `attempt:1`.
- Produces only sanitized trace metadata: `rejectionStage`, `rejectionCodes`, `evidenceCaptureStatus`, `evidenceRef`.

- [ ] **Step 1: Write RED provider and handler tests**

Cover invalid JSON, missing output, structural type/key/enum/range errors and service-required semantic error. Assert callback sees raw only in memory, typed thrown errors expose stage/codes/paths but not raw/value, `classifyUnderstandingFailure` maps them to `output_invalid` or `output_missing`, and safe fallback remains exactly once.

Handler tests inject a fake recorder and assert exact tenant/inbound context, no capture for accepted output/provider HTTP failure, and `persistence_failed` does not change lifecycle/outbox result.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/__tests__/DentalUnderstandingProvider.test.ts src/__tests__/UnderstandingFailureCode.test.ts src/__tests__/V2LiveConversationHandler.test.ts src/__tests__/DecisionTracePrivacy.test.ts
```

Expected: rejection callback/types and trace metadata do not exist.

- [ ] **Step 3: Implement provider boundary**

Decode raw with `JSON.parse`, sanitize Zod issues by mapping only path segments and closed codes, run semantic validation second, await callback before throwing typed metadata-only errors, and leave provider HTTP/abort errors unchanged. `LiveDentalUnderstanding.understand` forwards the optional callback/signal without acquiring tenant responsibility.

- [ ] **Step 4: Compose runtime recorder and trace**

Instantiate `RuntimeAiContractRejectionRecorder` in `create-conversation-v2-runtime.ts`; pass it as an optional handler dependency. The handler closes over exact `LiveTurnContext`, captures best-effort and records the sanitized result in the existing `v2.understanding` trace event. Do not add a Decision Trace stage carrying content.

- [ ] **Step 5: Run GREEN/refactor**

```bash
npx vitest run src/__tests__/DentalUnderstandingProvider.test.ts src/__tests__/UnderstandingFailureCode.test.ts src/__tests__/V2LiveConversationHandler.test.ts src/__tests__/DecisionTracePrivacy.test.ts src/__tests__/RuntimeDecisionTrace.test.ts
npx eslint src/infrastructure/adapters/ai/DentalUnderstandingProvider.ts src/infrastructure/adapters/ai/live-dental-understanding.ts src/application/conversation-v2/v2-live-conversation-handler.ts src/application/conversation-v2/understanding-failure-code.ts src/core/observability/DecisionTrace.ts src/infrastructure/conversation-v2/create-conversation-v2-runtime.ts
npm run typecheck
```

Search for sentinels and assert raw is absent from error strings and serialized traces.

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/adapters/ai/DentalUnderstandingProvider.ts src/infrastructure/adapters/ai/live-dental-understanding.ts src/application/conversation-v2/v2-live-conversation-handler.ts src/application/conversation-v2/understanding-failure-code.ts src/core/observability/DecisionTrace.ts src/infrastructure/conversation-v2/create-conversation-v2-runtime.ts src/__tests__/DentalUnderstandingProvider.test.ts src/__tests__/UnderstandingFailureCode.test.ts src/__tests__/V2LiveConversationHandler.test.ts src/__tests__/DecisionTracePrivacy.test.ts
git commit -m "feat(v2): capture rejected understanding outputs"
```

### Task 5: Verbalization rejection capture without changing fallback

**Files:**
- Modify: `src/conversation-core/composer/verbalization.ts`
- Modify: `src/conversation-core/composer/response-pipeline.ts`
- Modify: `src/conversation-core/turn-pipeline.ts`
- Modify: `src/application/conversation-v2/v2-live-conversation-handler.ts`
- Test: `src/__tests__/V2VerbalizedResponsePipeline.test.ts`
- Test: `src/__tests__/V2LiveConversationHandler.test.ts`
- Test: `src/__tests__/ValidationViolationTrace.test.ts`

**Interfaces:**
- Produces `VerbalizationRejectionObserver(input)` on `ResponseStageInput.verbalization`, with `rawOutput:string`, model, latency and closed `VerbalizationViolationCode[]`.
- Preserves `VerbalizationOutcome` unchanged; raw never appears in outcome/audit/trace.
- Consumes handler recorder context from Task 4 with stage `response_verbalization` and the live verbalizer prompt version.

- [ ] **Step 1: Write RED rejection-observer tests**

Force unauthorized number, money, link, promise, question count, missing value, empty and overlong text. Assert observer is awaited once only for model text rejected by `validateVerbalizedText`; accepted text, timeout/provider failure and deterministic fallback are not captured. Make observer throw and prove the exact deterministic response and existing `VerbalizationOutcome` remain unchanged.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/__tests__/V2VerbalizedResponsePipeline.test.ts src/__tests__/V2LiveConversationHandler.test.ts src/__tests__/ValidationViolationTrace.test.ts
```

Expected: callback contract absent.

- [ ] **Step 3: Implement callback at validator boundary**

Call it only after a string candidate fails `validateVerbalizedText`; catch observer failures locally; do not return raw. Forward the callback through `completeTurnPipeline`. The handler captures with `contractVersion:"response-verbalization.v1"`, `attempt:1` and stores only capture status/ref/codes for its existing `response.validated` trace.

- [ ] **Step 4: Run GREEN/refactor**

```bash
npx vitest run src/__tests__/V2VerbalizedResponsePipeline.test.ts src/__tests__/V2LiveConversationHandler.test.ts src/__tests__/ValidationViolationTrace.test.ts src/__tests__/V2VerbalizationValidator.test.ts src/__tests__/V2ResponsePipeline.test.ts
npx eslint src/conversation-core/composer/verbalization.ts src/conversation-core/composer/response-pipeline.ts src/conversation-core/turn-pipeline.ts src/application/conversation-v2/v2-live-conversation-handler.ts src/__tests__/V2VerbalizedResponsePipeline.test.ts src/__tests__/ValidationViolationTrace.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/conversation-core/composer/verbalization.ts src/conversation-core/composer/response-pipeline.ts src/conversation-core/turn-pipeline.ts src/application/conversation-v2/v2-live-conversation-handler.ts src/__tests__/V2VerbalizedResponsePipeline.test.ts src/__tests__/V2LiveConversationHandler.test.ts src/__tests__/ValidationViolationTrace.test.ts
git commit -m "feat(v2): capture rejected verbalizations"
```

### Task 6: Owner-only summary and audited reveal

**Files:**
- Create: `src/application/observability/reveal-ai-contract-rejection.ts`
- Modify: `src/app/api/conversations/[conversationId]/decision-trace/route.ts`
- Create: `src/app/api/owner/clinics/[clinicId]/ai-contract-rejections/[rejectionId]/route.ts`
- Create: `src/__tests__/AiContractRejectionReveal.test.ts`
- Modify: `src/__tests__/ConversationDecisionTraceRoute.test.ts`

**Interfaces:**
- Produces `revealAiContractRejection({organizationId,rejectionId,ownerSubject,now}, deps)` returning `{status:"revealed", rawOutput}` or `{status:"not_found"}`.
- Consumes store `findRevealable`/`recordRevealAudit` and vault `openAiEvidence`.
- Summary response contains evidence ref, stage, versions, issues, capture status, bytes, timestamps and raw availability only; never hash/ciphertext.

- [ ] **Step 1: Write RED authorization/reveal tests**

Test Owner exact tenant list/reveal, staff and no session rejection, cross-tenant indistinguishable 404, expired/oversized/no-key no reveal, wrong AAD no reveal, and audit failure suppressing plaintext. Assert successful response has `Cache-Control: no-store, max-age=0`; raw sentinel is absent from all list/trace responses.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/__tests__/AiContractRejectionReveal.test.ts src/__tests__/ConversationDecisionTraceRoute.test.ts
```

Expected: service/route and owner-only summaries absent.

- [ ] **Step 3: Implement reveal service**

Load by exact `(organizationId,rejectionId)`, require `stored`, ciphertext present and `rawExpiresAt > now`, decrypt with the persisted row's AAD, then persist `raw_output_revealed` audit with `expiresAt=metadataExpiresAt`. Return plaintext only after the audit succeeds. Catch cryptographic details and return `not_found`.

- [ ] **Step 4: Implement routes**

Read the canonical session with `readSession()`. The normal conversation trace route lists sanitized rejections only when `session.role === "owner"`; staff behavior remains unchanged. The reveal route requires Owner, explicit clinic/rejection parameters, emits no logs, and returns uniform 404 for all denied/not-found states.

- [ ] **Step 5: Run GREEN/refactor**

```bash
npx vitest run src/__tests__/AiContractRejectionReveal.test.ts src/__tests__/ConversationDecisionTraceRoute.test.ts
npx eslint src/application/observability/reveal-ai-contract-rejection.ts 'src/app/api/conversations/[conversationId]/decision-trace/route.ts' 'src/app/api/owner/clinics/[clinicId]/ai-contract-rejections/[rejectionId]/route.ts' src/__tests__/AiContractRejectionReveal.test.ts src/__tests__/ConversationDecisionTraceRoute.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/application/observability/reveal-ai-contract-rejection.ts 'src/app/api/conversations/[conversationId]/decision-trace/route.ts' 'src/app/api/owner/clinics/[clinicId]/ai-contract-rejections/[rejectionId]/route.ts' src/__tests__/AiContractRejectionReveal.test.ts src/__tests__/ConversationDecisionTraceRoute.test.ts
git commit -m "feat(owner): reveal rejected AI output with audit"
```

### Task 7: Retention, purge, operations and measurable safety

**Files:**
- Modify: `src/app/api/cron/decision-trace-cleanup/route.ts`
- Modify: `src/app/api/owner/clinics/[clinicId]/purge/route.ts`
- Modify: `src/__tests__/DecisionTraceCleanupRoute.test.ts`
- Modify: `src/__tests__/AiContractRejectionDatabase.test.ts`
- Create: `src/__tests__/AiContractRejectionArchitecture.test.ts`
- Create: `docs/operations/ai-contract-rejection-evidence.md`
- Modify: `docs/architecture/current.md`
- Modify: `.env.example`

**Interfaces:**
- Consumes store cleanup methods from Task 3.
- Produces cron result counts `aiContractRejectionRawExpired` and `aiContractRejectionMetadataDeleted`.
- Produces operational readiness contract for `AI_EVIDENCE_ENCRYPTION_KEY` without exposing its value.

- [ ] **Step 1: Write RED cleanup/purge/architecture tests**

At controlled clocks assert: raw present at 7 days minus 1 ms; nulled/status expired at 7 days; metadata/audit present at 30 days minus 1 ms; both deleted at 30 days. Seed another tenant plus message/inbound/job/outbound and prove cleanup does not mutate them. Prove purge of a cancelled test tenant removes evidence/audits while leaving another tenant.

Architecture source scans must reject plaintext logging, Sentry capture of raw, new cron route, polling/heartbeat/worker, reuse of `CREDENTIAL_ENCRYPTION_KEY`, raw fields in `DecisionTrace`/`VerbalizationOutcome`, and model/provider calls added by the recorder.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/__tests__/DecisionTraceCleanupRoute.test.ts src/__tests__/AiContractRejectionArchitecture.test.ts
npm run test:db:authority
```

Expected: cleanup and purge integration absent; all database tests execute with zero skips.

- [ ] **Step 3: Extend existing cleanup and purge**

Call both bounded evidence cleanup operations from the existing cron with the same fail-visible `Promise.allSettled` policy. Keep no new schedule. Add child-first purge deletes only if generated FK delete rules require them; otherwise document and test the exact cascade path. Run purge coverage only against embedded PostgreSQL, never `.env.local`.

- [ ] **Step 4: Write the operational runbook**

Document 64-hex key generation/publication through owner secrets, presence-only readiness, migration-before-build order, no backfill, metadata-only diagnosis, individual reveal/audit, 7/30-day retention, key-loss behavior, capture disable rollback, and the rule that rollback never changes V2 authority/tenant/sender.

- [ ] **Step 5: Run GREEN and performance gates**

```bash
npx vitest run src/__tests__/DecisionTraceCleanupRoute.test.ts src/__tests__/AiContractRejectionArchitecture.test.ts
npm run test:db:authority
npm run test:db:schema
npm run db:check
npx eslint src/app/api/cron/decision-trace-cleanup/route.ts 'src/app/api/owner/clinics/[clinicId]/purge/route.ts' src/__tests__/DecisionTraceCleanupRoute.test.ts src/__tests__/AiContractRejectionArchitecture.test.ts
npm run typecheck
git diff --check
```

Record from tests: accepted turn store calls = 0, rejected turn insert/dedupe = 1, crypto p95 <= 5 ms, warm persisted p95 <= 250 ms, cleanup batch sizes <= 500. Confirm source scan shows no cron/worker/polling addition.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/cron/decision-trace-cleanup/route.ts 'src/app/api/owner/clinics/[clinicId]/purge/route.ts' src/__tests__/DecisionTraceCleanupRoute.test.ts src/__tests__/AiContractRejectionDatabase.test.ts src/__tests__/AiContractRejectionArchitecture.test.ts docs/operations/ai-contract-rejection-evidence.md docs/architecture/current.md .env.example
git commit -m "chore(v2): operate rejection evidence retention safely"
```

### Task 8: Clean-tree verification and delivery evidence

**Files:**
- Modify only if evidence is missing: `docs/operations/ai-contract-rejection-evidence.md`

**Interfaces:**
- Consumes every prior task; produces no runtime interface.
- Produces a clean local branch ready for human review, not a push/merge/deploy.

- [ ] **Step 1: Verify commit/tree integrity**

```bash
git status --short
git log --oneline --decorate -10
git diff origin/develop...HEAD --check
```

Expected: clean tree and only this feature/spec/plan commits.

- [ ] **Step 2: Run focused AI and trace suites**

```bash
npx vitest run src/__tests__/DentalUnderstandingContract.test.ts src/__tests__/DentalUnderstandingProvider.test.ts src/__tests__/UnderstandingSchemaAgreement.test.ts src/__tests__/UnderstandingFailureCode.test.ts src/__tests__/V2VerbalizationValidator.test.ts src/__tests__/V2VerbalizedResponsePipeline.test.ts src/__tests__/V2LiveConversationHandler.test.ts src/__tests__/DecisionTracePrivacy.test.ts src/__tests__/ValidationViolationTrace.test.ts src/__tests__/ConversationDecisionTraceRoute.test.ts src/__tests__/AiContractRejectionRecorder.test.ts src/__tests__/AiEvidenceVault.test.ts src/__tests__/AiContractRejectionReveal.test.ts src/__tests__/AiContractRejectionArchitecture.test.ts
```

- [ ] **Step 3: Run PostgreSQL and migration gates**

```bash
npm run test:db:authority
npm run test:db:schema
npm run db:check
```

Expected: zero skipped database tests and additive migrations from an empty embedded
database. Re-run the migration suite over a disposable database initialized through
migration `0103` to prove the ordered upgrade through `0104` and `0105` with existing
tenant/inbound/conversation rows.

- [ ] **Step 4: Run canonical verification on a clean tree**

```bash
npm run verify
git status --short
```

Expected: db check, lint, typecheck and all normal Vitest files green; tree remains clean.

- [ ] **Step 5: Verify production build in a disposable clean clone**

Create `/private/tmp/systemops-ai-evidence-verify.XXXXXX`, clone the local repository, checkout detached at the exact feature HEAD, run `npm ci`, `npm run build`, and `npm run verify` without copying any env file. Confirm tracked files remain clean, validate the resolved temp path starts with `/private/tmp/systemops-ai-evidence-verify.`, then remove only that directory.

- [ ] **Step 6: Final self-review**

Map all 21 mandatory tests in the spec to passing test names. Search for raw field names across logger, Sentry, Decision Trace, API serializers and snapshots. Review generated migration and rollback: capture composition can be disabled without schema rollback; retained encrypted rows expire normally; no authority/tenant/outbox behavior changed.

- [ ] **Step 7: Stop at human checkpoint**

Report commits, migration filename, test totals/skips, build/verify results, performance measurements, clean HEAD/status and deployment prerequisites. Do not push, open/merge PR, publish key, migrate or deploy until the user explicitly authorizes that external step.

## Self-review against the specification

| Spec requirement | Plan coverage |
| --- | --- |
| Only rejected outputs; accepted path zero cost | Tasks 2, 3, 4, 5 and performance assertions in Task 7 |
| Structural/semantic distinction and service-null incident | Tasks 1 and 4 |
| Single Zod source and no manual OpenAI schema | Task 1 |
| Raw AES-256-GCM, dedicated key, AAD, 64 KiB | Task 2 |
| Tenant/inbound/conversation proof and dedupe | Task 3 |
| Understanding raw capture without raw errors | Task 4 |
| Verbalization capture without changing fallback | Task 5 |
| Sanitized Decision Trace | Tasks 4 and 5 |
| Owner-only summary, individual reveal and mandatory audit | Task 6 |
| Cross-tenant indistinguishability | Tasks 3 and 6 |
| Raw 7 days, metadata/audit 30, batches 500 | Task 7 |
| Purge and no plaintext in logs/Sentry/exports | Task 7 |
| No model/job/outbound/retry/polling change | Tasks 4, 5 and architecture scan in Task 7 |
| Generated additive migration and no backfill | Tasks 3, 7 and 8 |
| Disposable PostgreSQL, full verify and clean build | Task 8 |
| No tenant activation or production access | Global constraints and Task 8 stop gate |

Placeholder scan: no deferred implementation, unnamed function or unassigned test remains. Type consistency: capture stage/status names, recorder input, store methods, trace metadata and reveal result are identical across producing and consuming tasks.
