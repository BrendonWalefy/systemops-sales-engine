# V2 Institutional Knowledge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make V2 answer tenant-scoped address, business-hours and location questions naturally,
with read evidence, no business mutation and a safe missing-data result.

**Architecture:** Extend the existing Dental Understanding with one `business-information` request
and a closed topic entity. Add one read-only `dental-knowledge` capability to the existing Dental
Pack and resolve facts directly from the already-bound `Organization` in the live adapter. Reuse
the current `Decision`, `ActionResult`, authorized response, trace, outbox and sender contracts.

**Tech Stack:** TypeScript 5.8, Vitest, Conversation Intelligence V2, Next.js 16.

**Spec:** `docs/superpowers/specs/2026-09-01-v2-risk-based-conversation-design.md`

## Global Constraints

- V2 remains the only productive runtime; no V1 import, selector or fallback.
- Do not add schema, migration, worker, queue, model call or tenant configuration.
- Reuse `Understanding`, `Decision`, `ActionResult` and `V2AuthorizedResponsePlan`.
- At most one Understanding call and one verbalization call per inbound; no model retry.
- Canonically missing institutional data, including a source value that cannot be represented on
  the authorized response surface, produces a topic-specific unavailable answer. A malformed or
  mismatched port response produces clarification. Neither path invents tenant information.
- Parking, social links and maps URLs remain missing/deferred in this slice.
- Historical V1 snapshots do not gain fabricated institutional reads; their adapter reports the
  new read port unavailable and V2-native fixtures cover the behavior.
- Decision Trace receives only closed metadata, never institutional fact values.
- Every task follows RED -> GREEN -> refactor and ends in a reviewable commit.

---

### Task 1: Extend the closed Understanding contract

**Files:**

- Modify: `src/domain-packs/dental/vocabulary.ts`
- Modify: `src/domain-packs/dental/understanding.ts`
- Modify: `src/domain-packs/dental/understanding-prompt.ts`
- Modify: `src/__tests__/DentalUnderstandingContract.test.ts`
- Modify: `src/__tests__/DentalUnderstandingCoverageMatrix.test.ts`
- Modify: `src/__tests__/DentalUnderstandingProvider.test.ts`
- Modify: `src/__tests__/LiveDentalUnderstanding.test.ts`
- Modify: `src/__tests__/UnderstandingSchemaAgreement.test.ts`
- Modify strict Understanding fixtures in `DentalExplanationCapability.test.ts`,
  `DentalReceptionCoverage.test.ts`, `DentalResponseConversationBrief.test.ts`,
  `V2LiveConversationHandler.test.ts` and `V2OnlyRuntimePerformanceMeasurement.test.ts`.

**Interfaces:**

- Produces `DENTAL_BUSINESS_INFORMATION_TOPICS` and `DentalBusinessInformationTopic`.
- Extends `DENTAL_REQUESTS` with `business-information`.
- Extends `entities` with required nullable `businessInformationTopic`.
- `business-information` requires a non-null topic; every other request uses null.

- [ ] **Step 1: Add a failing contract case**

Add `businessInformationTopic: null` to the test entity helper, then add:

```ts
it("requires a closed topic for business information", () => {
  const valid = {
    ...base,
    request: "business-information",
    entities: {
      ...entities(null),
      businessInformationTopic: "business-hours",
    },
  };
  expect(parseDentalUnderstanding(valid).request).toBe("business-information");
  expect(() => parseDentalUnderstanding({
    ...valid,
    entities: { ...valid.entities, businessInformationTopic: null },
  })).toThrow();
  expect(() => parseDentalUnderstanding({
    ...valid,
    entities: { ...valid.entities, businessInformationTopic: "unknown" },
  })).toThrow();
});
```

- [ ] **Step 2: Run the focused RED**

Run: `npx vitest run src/__tests__/DentalUnderstandingContract.test.ts`

Expected: FAIL because the request and topic are not registered.

- [ ] **Step 3: Add vocabulary and semantic validation**

In `vocabulary.ts` add:

```ts
export const DENTAL_BUSINESS_INFORMATION_TOPICS = [
  "address",
  "business-hours",
  "location-guidance",
  "parking",
  "social",
] as const;

export type DentalBusinessInformationTopic =
  (typeof DENTAL_BUSINESS_INFORMATION_TOPICS)[number];
```

Append `business-information` to `DENTAL_REQUESTS`. Add the required nullable enum field to the Zod
schema and semantic issue `business_information_topic_required`. Bump the prompt version to
`dental-understanding.v2` and describe each topic once with concise examples.

- [ ] **Step 4: Update strict fixtures without weakening the schema**

Add `businessInformationTopic: null` beside existing entity fields in every fixture file listed in
this task. Update exact prompt/schema-version expectations. Do not make the field optional and do
not relax `.strict()`.

- [ ] **Step 5: Run the Understanding group GREEN**

```bash
npx vitest run \
  src/__tests__/DentalUnderstandingContract.test.ts \
  src/__tests__/DentalUnderstandingCoverageMatrix.test.ts \
  src/__tests__/DentalUnderstandingProvider.test.ts \
  src/__tests__/LiveDentalUnderstanding.test.ts \
  src/__tests__/UnderstandingSchemaAgreement.test.ts \
  src/__tests__/DentalExplanationCapability.test.ts \
  src/__tests__/DentalReceptionCoverage.test.ts \
  src/__tests__/DentalResponseConversationBrief.test.ts \
  src/__tests__/V2OnlyRuntimePerformanceMeasurement.test.ts
```

Expected: all execute and pass.

- [ ] **Step 6: Lint, typecheck and commit**

Run ESLint on every changed TypeScript file, then `npm run typecheck` and `git diff --check`.
Commit only the Understanding contract and fixture changes:

```bash
git add src/domain-packs/dental/vocabulary.ts src/domain-packs/dental/understanding.ts \
  src/domain-packs/dental/understanding-prompt.ts \
  src/__tests__/DentalUnderstandingContract.test.ts \
  src/__tests__/DentalUnderstandingCoverageMatrix.test.ts \
  src/__tests__/DentalUnderstandingProvider.test.ts \
  src/__tests__/LiveDentalUnderstanding.test.ts \
  src/__tests__/UnderstandingSchemaAgreement.test.ts \
  src/__tests__/DentalExplanationCapability.test.ts \
  src/__tests__/DentalReceptionCoverage.test.ts \
  src/__tests__/DentalResponseConversationBrief.test.ts \
  src/__tests__/V2LiveConversationHandler.test.ts \
  src/__tests__/V2OnlyRuntimePerformanceMeasurement.test.ts
git commit -m "feat(v2): understand institutional questions"
```

### Task 2: Define one read-only Knowledge authority

**Files:**

- Modify: `src/domain-packs/dental/ports.ts`
- Modify: `src/domain-packs/dental/capabilities.ts`
- Create: `src/domain-packs/dental/knowledge-capability.ts`
- Modify: `src/domain-packs/dental/outcome-provenance.ts`
- Modify: `src/domain-packs/dental/index.ts`
- Create: `src/__tests__/DentalKnowledgeCapability.test.ts`
- Modify: `src/__tests__/DentalOperationalPipeline.test.ts`

**Interfaces:**

- Consumes `DentalBusinessInformationTopic` from Task 1.
- Produces `DentalKnowledgeReadPort.resolveBusinessInformation(topic)`.
- Produces capability ID `dental-knowledge` and outcome `business_information_answered`.

- [ ] **Step 1: Write capability RED tests**

Using a fake read port, prove a resolved topic creates `Decision.answer` and:

```ts
expect(await capability.execute(decision, context)).toMatchObject({
  type: "business_information_answered",
  semanticClass: "information_authorized",
  origin: { capabilityId: "dental-knowledge" },
});
```

Also prove canonical missing data returns a topic-specific `Decision.answer` whose execution yields
`business_information_unavailable`; malformed, mismatched or unsafe reads return
`clarification_required`; emergency/human requests are not claimed; and no decision returned by
this capability has `kind === "execute"`.

- [ ] **Step 2: Run the capability RED**

Run: `npx vitest run src/__tests__/DentalKnowledgeCapability.test.ts`

Expected: FAIL because the port, capability and outcome do not exist.

- [ ] **Step 3: Add the narrow port**

```ts
export type DentalBusinessInformationFact = Readonly<{
  key: "address" | "business_hours" | "location_guidance";
  value: string;
}>;

export type DentalBusinessInformationResolution =
  | Readonly<{
      kind: "resolved";
      topic: DentalBusinessInformationTopic;
      organization: Readonly<{ id: string; displayName: string }>;
      facts: readonly DentalBusinessInformationFact[];
      evidenceRef: string;
    }>
  | Readonly<{
      kind: "missing";
      topic: DentalBusinessInformationTopic;
      organization: Readonly<{ id: string; displayName: string }>;
      evidenceRef: string;
    }>;

export type DentalKnowledgeReadPort = Readonly<{
  resolveBusinessInformation(
    topic: DentalBusinessInformationTopic,
  ): Promise<DentalBusinessInformationResolution>;
}>;
```

- [ ] **Step 4: Implement the minimum capability and provenance**

Add `DentalKnowledgeClaimPayload` to the existing claim union. A resolved read becomes
`Decision.answer` with organization subject, `display_text` facts, read evidence and allowed
disclosure. Reject empty, untrimmed or >240-character values. Register
`business_information_answered` and `business_information_unavailable` with required
subject/evidence and pair `dental-knowledge + answer` in `DENTAL_OUTCOME_PROVENANCE`. Canonical
absence is represented by an authorized topic-specific fact; malformed results fail closed as
`ask`. Add the capability before reception in
`createDentalPack`. Make `knowledgeRead` a required pack port and update the default unavailable
pack plus every direct pack factory in `DentalOperationalPipeline.test.ts`; do not make live and
test packs silently register different capability sets.

- [ ] **Step 5: Run capability/provenance tests GREEN**

```bash
npx vitest run \
  src/__tests__/DentalKnowledgeCapability.test.ts \
  src/__tests__/DentalOperationalPipeline.test.ts \
  src/__tests__/V2AuthorizedResponsePlan.test.ts
```

- [ ] **Step 6: Lint, typecheck and commit**

Run ESLint on changed files, `npm run typecheck`, and `git diff --check`, then:

```bash
git add src/domain-packs/dental src/__tests__/DentalKnowledgeCapability.test.ts
git commit -m "feat(v2): define grounded institutional knowledge"
```

### Task 3: Bind Knowledge to the claimed organization and honest replay

**Files:**

- Modify: `src/application/conversation-v2/dental-live-adapters.ts`
- Modify: `src/application/conversation-v2/dental-captured-read-adapters.ts`
- Modify: `src/__tests__/DentalLiveAdapters.test.ts`
- Modify: `src/__tests__/DentalShadowAdapters.test.ts`
- Modify: `src/__tests__/V2ShadowRunner.test.ts`

**Interfaces:**

- `createDentalLiveAdapters()` returns `knowledgeRead` beside existing ports.
- No knowledge method accepts clinic ID; its closure binds `deps.clinic` once.
- `createDentalCapturedReadAdapters()` returns the same required port but throws the existing
  `CapturedReadUnavailableError`; historical V1 snapshots never contain this new fact surface.

- [ ] **Step 1: Add adapter RED cases**

Assert exact resolution for address, business-hours and location-guidance; assert `missing` for
parking/social, null source values and values over 240 characters:

```ts
await expect(adapters.knowledgeRead.resolveBusinessInformation("address"))
  .resolves.toMatchObject({
    kind: "resolved",
    organization: { id: clinic.id },
    facts: [{ key: "address" }],
    evidenceRef: `organization:${clinic.id}:address`,
  });
```

Keep existing tenant/lead/conversation mismatch tests unchanged.

Add a shadow case classified as `business-information` and prove it returns
`shared_read_unavailable`, rather than producing an answer from absent or unrelated data.

- [ ] **Step 2: Run adapter RED**

Run:

```bash
npx vitest run \
  src/__tests__/DentalLiveAdapters.test.ts \
  src/__tests__/DentalShadowAdapters.test.ts \
  src/__tests__/V2ShadowRunner.test.ts
```

Expected: FAIL because `knowledgeRead` is absent.

- [ ] **Step 3: Implement bounded resolution**

Build text only from `clinic.address`, `clinic.addressComplement`, `clinic.businessHours` and
`clinic.locationMessage`. Trim surrounding whitespace but do not parse editorial prose, generate
defaults or expose `mapsUrl`. Add an unavailable implementation to the captured adapter; do not
change `CapturedV2TurnReads`, V1 observation events or historical fixture manifests.

- [ ] **Step 4: Run adapter tests GREEN**

Run:

```bash
npx vitest run \
  src/__tests__/DentalLiveAdapters.test.ts \
  src/__tests__/DentalShadowAdapters.test.ts \
  src/__tests__/V2ShadowRunner.test.ts
```

- [ ] **Step 5: Lint, typecheck and commit**

Run ESLint on the two files, `npm run typecheck`, and `git diff --check`, then:

```bash
git add src/application/conversation-v2/dental-live-adapters.ts \
  src/application/conversation-v2/dental-captured-read-adapters.ts \
  src/__tests__/DentalLiveAdapters.test.ts \
  src/__tests__/DentalShadowAdapters.test.ts \
  src/__tests__/V2ShadowRunner.test.ts
git commit -m "feat(v2): bind knowledge reads to the claimed tenant"
```

### Task 4: Prove the productive read-only turn

**Files:**

- Modify: `src/__tests__/V2LiveConversationHandler.test.ts`
- Modify: `src/__tests__/DecisionTracePrivacy.test.ts`
- Modify: `src/__tests__/V2OnlyRuntimePerformanceMeasurement.test.ts`

**Interfaces:** No new production interface.

- [ ] **Step 1: Add live-handler RED tests**

Add a harness option returning `business-information/address`. Assert one Understanding call, at
most one verbalization, zero booking/effect calls, one outbox, capability `dental-knowledge`,
outcome `business_information_answered`, and completed-effect count zero. Add a missing-data case
that expects `business_information_unavailable` and relevant topic-specific outbound text.

Use a distinctive address and prove it appears in no trace metadata.

- [ ] **Step 2: Run live RED tests**

```bash
npx vitest run \
  src/__tests__/V2LiveConversationHandler.test.ts \
  src/__tests__/DecisionTracePrivacy.test.ts \
  src/__tests__/V2OnlyRuntimePerformanceMeasurement.test.ts
```

Expected: new assertions fail while existing cases remain executable.

- [ ] **Step 3: Preserve generic handler composition**

`createDentalPack(adapters)` must discover `dental-knowledge` through the existing coordinator. If
the RED requires a knowledge-specific branch in `V2LiveConversationHandler`, stop and revise the
design rather than add that branch.

- [ ] **Step 4: Run the complete slice GREEN**

```bash
npx vitest run \
  src/__tests__/DentalUnderstandingContract.test.ts \
  src/__tests__/DentalUnderstandingCoverageMatrix.test.ts \
  src/__tests__/DentalUnderstandingProvider.test.ts \
  src/__tests__/LiveDentalUnderstanding.test.ts \
  src/__tests__/DentalKnowledgeCapability.test.ts \
  src/__tests__/DentalLiveAdapters.test.ts \
  src/__tests__/DentalOperationalPipeline.test.ts \
  src/__tests__/V2LiveConversationHandler.test.ts \
  src/__tests__/V2AuthorizedResponsePlan.test.ts \
  src/__tests__/V2ResponsePipeline.test.ts \
  src/__tests__/V2VerbalizedResponsePipeline.test.ts \
  src/__tests__/DecisionTracePrivacy.test.ts \
  src/__tests__/V2OnlyRuntimePerformanceMeasurement.test.ts
```

- [ ] **Step 5: Lint, typecheck and commit**

Run ESLint on changed tests, `npm run typecheck`, and `git diff --check`, then:

```bash
git add src/__tests__/V2LiveConversationHandler.test.ts \
  src/__tests__/DecisionTracePrivacy.test.ts \
  src/__tests__/V2OnlyRuntimePerformanceMeasurement.test.ts
git commit -m "test(v2): prove institutional knowledge end to end"
```

### Task 5: Document evidence and run clean-tree gates

**Files:**

- Modify: `docs/architecture/v2-capability-parity.md`
- Modify: `docs/architecture/current.md`

- [ ] **Step 1: Update only proven matrix rows**

Mark address, business-hours and location guidance green. Keep parking/social and every
transactional gap unchanged. Record source precedence, missing behavior, call budget and zero
business effects.

- [ ] **Step 2: Commit documentation**

Run `git diff --check`, then:

```bash
git add docs/architecture/v2-capability-parity.md docs/architecture/current.md
git commit -m "docs(v2): record grounded institutional knowledge"
```

- [ ] **Step 3: Run canonical verification from the clean tree**

Run: `npm run verify`

Expected: exact canonical verification passes.

- [ ] **Step 4: Verify production build in a clean dependency layout**

When the worktree uses external `node_modules`, use a disposable clean clone and run `npm ci`,
`npm run build`, and `npm run verify`. Never copy `.env.local`, `.env.test.local` or credentials.

- [ ] **Step 5: Deliver through normal controls**

Push normally, open a focused PR to `develop`, and wait for Verify, Migration CI and Vercel.
Measure active implementation, local gates, CI and deployment separately. Do not activate a tenant
or write production data as part of this slice.

## Self-review result

- Every first-slice requirement in the spec maps to Tasks 1–5.
- The plan reuses all four existing V2 contracts and creates no router, database object or worker.
- The only new production module is one domain capability; all other changes extend existing
  vocabulary, ports, adapters and registries.
- Productive and historical adapters satisfy the same required pack port; historical replay fails
  explicitly when V1 did not capture the read instead of fabricating parity.
- All type names are defined before later tasks consume them.
- No model output executes an effect and no inline retry is introduced.
- Canonical unavailability is distinguished from a port contract failure: absent or unsafe source
  values receive a grounded, topic-specific unavailable answer, while malformed or mismatched port
  responses remain fail-closed.
- Institutional lock measurements use the approved p95 tolerance of +10% and +5 ms rather than an
  unstable exact comparison between individual samples.
- Parking, social and map links are deferred rather than guessed from prose.
- There are no placeholders or unresolved product decisions.
