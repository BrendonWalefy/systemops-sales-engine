# Conversation Intelligence V2 — Cycle G Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement deterministic dental Catalog, Scheduling and Escalation capabilities with separated authorized reads/writes and evidence-preserving ActionResults.

**Architecture:** Concrete capabilities receive tenant-scoped ports in their constructors. Claims carry a Domain Pack-owned typed payload through the generic core, every selected capability decides before any executes, and a generic V2 plan builder admits only explicitly disclosable evidence-bearing facts.

**Tech Stack:** TypeScript 5.8, Vitest 3.2, existing Conversation Core V2 contracts.

## Global Constraints

- Keep `CapabilityContext` exactly `{ state, policy, now }`.
- Core imports no pack, provider, application config or infrastructure.
- Claim and Understanding perform no I/O; decide performs reads only; execute owns writes.
- Do not modify `src/core/**`, V1, production wiring, Composer, shadow or cutover.
- Use `npm run verify` exactly before the final checkpoint.

---

### Task 1: Evidence-bearing generic contracts and plan

**Files:**

- Modify: `src/conversation-core/capability/contract.ts`
- Modify: `src/conversation-core/decision.ts`
- Create: `src/conversation-core/authorized-response-plan.ts`
- Test: `src/__tests__/V2AuthorizedResponsePlan.test.ts`
- Modify: fixture/dental tests and fixtures for the evolved fact contract

**Interfaces:**

- `CapabilityClaim<TPayload>.payload: Readonly<TPayload>`; payload types belong to the Domain Pack.
- `Fact` gains `subject`, `evidence`, and `disclosure`.
- `buildV2AuthorizedResponsePlan(actionResults): V2AuthorizedResponsePlan`

- [ ] Write a failing test where a scoped disclosable price survives, an internal fact is removed,
      and an unscoped price is rejected.
- [ ] Run `npx vitest run src/__tests__/V2AuthorizedResponsePlan.test.ts` and confirm RED.
- [ ] Implement the smallest generic fact/claim contracts and plan builder.
- [ ] Update existing V2 fixture facts mechanically and run all Conversation Core tests GREEN.
- [ ] Commit `feat(conversation-core): preserve authorization evidence in facts`.

### Task 2: Decide-all-before-execute pipeline

**Files:**

- Modify: `src/conversation-core/turn-pipeline.ts`
- Test: `src/__tests__/PipelineDecisionBarrier.test.ts`

**Interfaces:**

- Pipeline obtains `readonly { capability; decision }[]` before its first `execute()` call.

- [ ] Write a failing test with two selected capabilities where the second `decide()` throws and
      assert the first capability has zero executions.
- [ ] Run the focused test and confirm the current sequential pipeline fails it.
- [ ] Split decision and execution loops without adding domain logic.
- [ ] Run conflict, dependency, fixture and decision-barrier tests GREEN.
- [ ] Commit `fix(conversation-core): decide every claim before effects`.

### Task 3: Dental policy, ports and Catalog capability

**Files:**

- Create: `src/domain-packs/dental/ports.ts`
- Modify: `src/domain-packs/dental/capabilities.ts`
- Modify: `src/domain-packs/dental/index.ts`
- Test: `src/__tests__/DentalCatalogCapability.test.ts`

**Interfaces:**

- `DentalCatalogReadPort.resolveService(query): Promise<ServiceResolution>`
- `createDentalCatalogCapability(readPort): Capability<DentalRequest, DentalPolicy>`
- `DentalPolicy` remains boolean/number-only.

- [ ] Write failing tests for exact price, ambiguous service, unknown service, disabled disclosure,
      read-only decide and price subject binding.
- [ ] Run the focused test and confirm RED.
- [ ] Implement Catalog ownership for `price-of-service` and `service-availability`; resolve only
      through the injected read port and emit evidence-bearing results.
- [ ] Run Catalog, policy type and pack boundary tests GREEN.
- [ ] Commit `feat(dental-pack): implement catalog decisions from authorized reads`.

### Task 4: Scheduling writes and structured escalation

**Files:**

- Modify: `src/domain-packs/dental/ports.ts`
- Modify: `src/domain-packs/dental/capabilities.ts`
- Modify: `src/domain-packs/dental/index.ts`
- Test: `src/__tests__/DentalSchedulingCapability.test.ts`
- Test: `src/__tests__/DentalOperationalPipeline.test.ts`

**Interfaces:**

- `DentalSchedulingReadPort.listSlots(...)` and `resolveOfferedSlot(...)`.
- `DentalSchedulingWritePort.bookSlot(...)` and `confirmAppointment(...)`.
- `createDentalSchedulingCapability(readPort, writePort)`.

- [ ] Write failing tests proving booking requests only read/offer, confirmed slots write once,
      missing pending state writes zero times, and failed writes expose no success fact.
- [ ] Write a failing operational-pipeline test proving Escalation conflicts block every write and
      missing dependencies block execution.
- [ ] Implement the minimum scheduling and escalation decisions for the F-supported requests.
- [ ] Run dental, coordinator and scheduling regression suites GREEN.
- [ ] Commit `feat(dental-pack): execute supported scheduling decisions safely`.

### Task 5: Closure and checkpoint

**Files:**

- Create: `docs/ai-system/cycle-g-capabilities.md`
- Modify: `docs/ai-system/cycle-f-dental-domain-pack.md` only to mark resolved G gaps

**Interfaces:** no runtime interface.

- [ ] Document ports, reads, writes, ActionResults, conflicts, dependencies, scars and H gaps.
- [ ] Run all new G tests and the four canonical scheduling tests.
- [ ] Run `npm run verify` and record complete counts.
- [ ] Confirm zero diff in `src/core/**`, no H/I/J work and a clean tree.
- [ ] Commit `docs(ai): close cycle g capability checkpoint` and stop.
