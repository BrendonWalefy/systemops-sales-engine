# Dental Resin Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a resin-journey clinic installable from a versioned manifest instead of code written specifically for it.

**Architecture:** A typed manifest lives in code. A pure planner resolves it against a clinic's data and returns either an install plan or named blockers — it never writes. A separate executor applies the plan, writing only to the canonical owner of each piece of information, and records what it installed. An activation gate extends the existing readiness machinery with veto power over `autoReplyEnabled`.

**Tech Stack:** TypeScript, Drizzle ORM on Neon Postgres (`neon-http`, no interactive transactions), Vitest, Next.js App Router.

## Global Constraints

From `docs/superpowers/specs/2026-08-10-dental-resin-template-design.md`:

- **The runtime never reads the manifest.** It reads `organizations`, `treatments`, `playbook_versions` and modules. The manifest is an installation artifact, not a second source of truth.
- **The plan writes only to canonical owners**, per this table verified against the current schema:

| Informação | Dono canônico |
| --- | --- |
| Preço estruturado | `treatments.priceCents`, `minPriceCents`, `maxPriceCents`, `priceKind`, `priceQuotableInChat` |
| Política comercial em prosa | `playbook_versions.commercialPolicy` (`text`) |
| Tom, recepcionista, diferenciais | `playbook_versions` |
| Objeções | `playbook_versions.objections` (`jsonb<{objection, response}[]>`) |
| Garantia | `playbook_versions.warrantyPolicy` |
| Aliases, pipeline, duração, gatilhos | `treatments` |
| Mídia | `playbook_versions.mediaLibrary` / `mediaAssetIds` |
| Horários, timezone, limites, canal | `organizations` |

- **Variants carry a stable internal slug** (`base`, `enhanced`) with a clinic-supplied display name. Never hardcode "Simplificada", "Estratificada", "Premium" or "Slim" as universal taxonomy — spec mestre §19 forbids it.
- **Two placeholder categories only:** `blocking` and `defaulted`. There is no "optional without default".
- **Delivery channel maps onto existing columns**, no new schema: `text` → `priceQuotableInChat: true`; `media` → `true` plus a required asset; `human` → `false`.
- **The manifest contains no clinical rule, no result claim, no warranty coverage promise.**
- Every query and every plan operation is scoped by `clinicId`.
- `npm run verify` exits 0 before every commit. Run `npm run build` in the final task — `verify` does not.
- Comments in this codebase are written in Portuguese.

## Scope

**In:** the manifest contract, the `dental-resin-v1` manifest with authorized objection content, the validator, the pure planner, the executor, the installation record, and the activation gate.

**Out:** the 12 replay families (separate spec), a database-editable template catalogue (spec mestre §7.2 defers it), pipelines for treatments outside the resin journey, automatic update of an active clinic, and migrating the 16 existing per-clinic scripts.

## A warning this plan inherits

The previous phase on this codebase produced eight review failures for tests that looked like verification but asserted nothing — a stub ignoring its input, a body with no `expect()`, a "regression test" that still passed with the bug reintroduced, and a "parallelisation" that only moved where a lazy Drizzle query builder was constructed rather than where it executed.

It also hit the same design failure four times: **bounding or changing a read broke something that quietly depended on the previous shape.** This plan's equivalent risk is the executor writing to a field some other code already owns. Task 6's canonical-owner test is the guard, and it must be made to fail on purpose before it earns trust.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/application/templates/contract.ts` | Types only: `TemplateManifest`, `Placeholder`, `InstallPlan`, `InstallOperation`, `Blocker` |
| `src/application/templates/validate-manifest.ts` | Checks a manifest against its own contract |
| `src/application/templates/dental-resin-v1/manifest.ts` | The template — data, no logic |
| `src/application/templates/dental-resin-v1/objections.ts` | Authorized objection answers |
| `src/application/templates/plan-install.ts` | `planTemplateInstall()` — pure |
| `src/application/templates/execute-install.ts` | `executeInstallPlan()` — the only writer |
| `src/application/templates/installation-record.ts` | Records template, version, digest, custom fields, actor |
| `src/application/templates/activation-gate.ts` | The four blockers; extends the existing blueprint |
| `src/infrastructure/db/schema.ts` | New `template_installations` table |

---

### Task 1: The manifest contract

**Files:**
- Create: `src/application/templates/contract.ts`
- Test: `src/__tests__/TemplateContract.test.ts`

**Interfaces:**
- Produces: `TemplateManifest`, `TemplateVariant`, `Placeholder`, `PlaceholderKind`, `PriceChannel`, `InstallOperation`, `InstallPlan`, `Blocker`. Every later task consumes these names.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  PLACEHOLDER_KINDS,
  PRICE_CHANNELS,
  CANONICAL_OWNERS,
} from "@/application/templates/contract";

describe("template contract", () => {
  it("allows exactly two placeholder kinds", () => {
    expect([...PLACEHOLDER_KINDS].sort()).toEqual(["blocking", "defaulted"]);
  });

  it("models the three price delivery channels", () => {
    expect([...PRICE_CHANNELS].sort()).toEqual(["human", "media", "text"]);
  });

  it("restricts install operations to the canonical owners", () => {
    expect([...CANONICAL_OWNERS].sort()).toEqual([
      "organizations",
      "playbook_versions",
      "treatments",
    ]);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- src/__tests__/TemplateContract.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the contract**

```ts
export const PLACEHOLDER_KINDS = ["blocking", "defaulted"] as const;
export type PlaceholderKind = typeof PLACEHOLDER_KINDS[number];

export const PRICE_CHANNELS = ["text", "media", "human"] as const;
export type PriceChannel = typeof PRICE_CHANNELS[number];

// Os únicos destinos que um plano pode escrever. Qualquer outro é defeito de
// contrato: o runtime lê destas tabelas, e uma segunda dona da mesma
// informação é exatamente o que sources-of-truth.md proíbe.
export const CANONICAL_OWNERS = [
  "organizations",
  "treatments",
  "playbook_versions",
] as const;
export type CanonicalOwner = typeof CANONICAL_OWNERS[number];

export type Placeholder = {
  key: string;
  kind: PlaceholderKind;
  label: string;
  /** Presente somente quando kind === "defaulted". */
  defaultValue?: unknown;
};

export type TemplateVariant = {
  /** Slug interno estável. NUNCA o nome comercial da clínica. */
  slug: "base" | "enhanced";
  displayNamePlaceholder: string;
  priceChannel: PriceChannel;
  priceKind: "fixed" | "from";
  /** Obrigatório quando priceChannel === "media". */
  mediaAssetPlaceholder?: string;
};

export type TemplateManifest = {
  id: string;
  version: string;
  segment: string;
  variants: TemplateVariant[];
  placeholders: Placeholder[];
  objections: Array<{ objection: string; response: string; appliesToVariant?: "base" | "enhanced" }>;
  qualificationQuestions: string[];
  handoffReasons: string[];
};

export type InstallOperation = {
  owner: CanonicalOwner;
  clinicId: string;
  description: string;
  values: Record<string, unknown>;
};

export type InstallPlan = {
  templateId: string;
  templateVersion: string;
  clinicId: string;
  operations: InstallOperation[];
  customFields: string[];
};

export type Blocker = {
  placeholderKey: string;
  reason: string;
};
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm test -- src/__tests__/TemplateContract.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Verify and commit**

Run: `npm run verify`

```bash
git add src/application/templates/contract.ts src/__tests__/TemplateContract.test.ts
git commit -m "feat(templates): define the install contract"
```

---

### Task 2: The manifest validator

**Files:**
- Create: `src/application/templates/validate-manifest.ts`
- Test: `src/__tests__/TemplateManifestValidation.test.ts`

**Interfaces:**
- Consumes: everything from Task 1.
- Produces: `validateManifest(manifest: TemplateManifest): string[]` — an array of problem descriptions, empty when valid. Task 3's manifest test consumes it.

The validator catches authoring mistakes before they reach a clinic. Each rule below exists because its absence produces a silent runtime failure rather than an error.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { validateManifest } from "@/application/templates/validate-manifest";
import type { TemplateManifest } from "@/application/templates/contract";

function baseManifest(): TemplateManifest {
  return {
    id: "dental-resin",
    version: "1.0.0",
    segment: "odontologia-estetica",
    variants: [
      { slug: "base", displayNamePlaceholder: "variant.base.name", priceChannel: "text", priceKind: "from" },
    ],
    placeholders: [
      { key: "variant.base.name", kind: "blocking", label: "Nome da variante de entrada" },
    ],
    objections: [],
    qualificationQuestions: [],
    handoffReasons: [],
  };
}

describe("manifest validation", () => {
  it("accepts a coherent manifest", () => {
    expect(validateManifest(baseManifest())).toEqual([]);
  });

  it("rejects a variant whose display name placeholder is not declared", () => {
    const m = baseManifest();
    m.variants[0].displayNamePlaceholder = "nao.declarado";
    expect(validateManifest(m)).toContainEqual(
      expect.stringContaining("nao.declarado"),
    );
  });

  it("rejects a declared placeholder nobody uses", () => {
    const m = baseManifest();
    m.placeholders.push({ key: "orfao", kind: "blocking", label: "Órfão" });
    expect(validateManifest(m)).toContainEqual(expect.stringContaining("orfao"));
  });

  it("requires a media asset placeholder when the channel is media", () => {
    const m = baseManifest();
    m.variants[0].priceChannel = "media";
    expect(validateManifest(m)).toContainEqual(
      expect.stringContaining("media"),
    );
  });

  it("rejects an objection pointing at a variant the manifest does not define", () => {
    const m = baseManifest();
    m.objections.push({ objection: "caro", response: "…", appliesToVariant: "enhanced" });
    expect(validateManifest(m)).toContainEqual(
      expect.stringContaining("enhanced"),
    );
  });

  it("rejects a defaulted placeholder with no default value", () => {
    const m = baseManifest();
    m.placeholders.push({ key: "tom", kind: "defaulted", label: "Tom" });
    m.qualificationQuestions.push("{{tom}}");
    expect(validateManifest(m)).toContainEqual(expect.stringContaining("tom"));
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- src/__tests__/TemplateManifestValidation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the validator**

Implement `validateManifest` so each of the six cases above produces a message naming the offending key. Collect every problem rather than returning on the first — an author fixing one issue at a time is the slow path this whole phase exists to remove.

The "placeholder nobody uses" rule needs a usage scan: a placeholder counts as used when its key appears as a variant's `displayNamePlaceholder` or `mediaAssetPlaceholder`, or as `{{key}}` inside any objection response, qualification question or handoff reason.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm test -- src/__tests__/TemplateManifestValidation.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Verify and commit**

```bash
git add src/application/templates/validate-manifest.ts src/__tests__/TemplateManifestValidation.test.ts
git commit -m "feat(templates): validate manifests against the contract"
```

---

### Task 3: The dental-resin-v1 manifest and its authorized content

**Files:**
- Create: `src/application/templates/dental-resin-v1/manifest.ts`
- Create: `src/application/templates/dental-resin-v1/objections.ts`
- Test: `src/__tests__/DentalResinManifest.test.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: `dentalResinV1: TemplateManifest`, `DENTAL_RESIN_OBJECTIONS`. Tasks 4 and 5 install it.

**Source the objection content from these already-sanitized documents, not from raw message exports** — the exports contain patient PII:

- `docs/product/auditoria-conversacao-2026-07.md`
- `docs/product/mapa-comportamento-conversas-vitalli.md`
- `docs/product/objetividade-conversacional-diagnostico.md`

Read all three before writing content. They record what the human team actually said and where the assistant actually failed.

**Content rules, each with a failure behind it:**

- No clinical claim, no result promise, no warranty coverage statement. The assistant previously asserted coverage it had no data for.
- Never present a commercial difference between `base` and `enhanced` as clinical superiority.
- Answer the question before pitching. The audit records the assistant ignoring the lead's question to deliver a pitch.
- One main idea per response, at most one question per turn.
- Never state a price, condition, quantity or deadline absent from the active configuration.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { dentalResinV1 } from "@/application/templates/dental-resin-v1/manifest";
import { validateManifest } from "@/application/templates/validate-manifest";

const FORBIDDEN_CLINICAL_CLAIMS = [
  "não amarela", "nunca mancha", "dura para sempre", "garantia de",
  "melhor que", "superior", "indolor", "sem risco",
];

const CLINIC_SPECIFIC_VOCABULARY = ["simplificada", "estratificada", "premium", "slim"];

describe("dental resin v1 manifest", () => {
  it("passes its own validator", () => {
    expect(validateManifest(dentalResinV1)).toEqual([]);
  });

  it("defines both variants by stable slug", () => {
    expect(dentalResinV1.variants.map((v) => v.slug).sort()).toEqual(["base", "enhanced"]);
  });

  it("never hardcodes a clinic's commercial vocabulary", () => {
    const text = JSON.stringify(dentalResinV1).toLowerCase();
    for (const word of CLINIC_SPECIFIC_VOCABULARY) {
      expect(text).not.toContain(word);
    }
  });

  it("makes no clinical or warranty claim in any authorized response", () => {
    const responses = dentalResinV1.objections.map((o) => o.response.toLowerCase());
    for (const response of responses) {
      for (const claim of FORBIDDEN_CLINICAL_CLAIMS) {
        expect(response).not.toContain(claim);
      }
    }
  });

  it("asks at most one question per authorized response", () => {
    for (const { response } of dentalResinV1.objections) {
      expect((response.match(/\?/g) ?? []).length).toBeLessThanOrEqual(1);
    }
  });

  it("covers the objections the real conversations produced", () => {
    const keys = dentalResinV1.objections.map((o) => o.objection.toLowerCase()).join("|");
    for (const topic of ["preço", "durabilidade", "prazo", "parcel"]) {
      expect(keys).toContain(topic);
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- src/__tests__/DentalResinManifest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the objection content**

Create `objections.ts` exporting `DENTAL_RESIN_OBJECTIONS`. Cover at minimum: price ("achei caro"), durability, treatment duration, instalments, and comparison between the two variants. Reference variants only by slug and by `{{placeholder}}` for the display name.

- [ ] **Step 4: Write the manifest**

Create `manifest.ts` importing the objections. Declare both variants, every placeholder they reference, the qualification questions, and the handoff reasons.

The blocking placeholders must be exactly the four gates: channel and tenant, price, agenda, media and reception phone. Everything else is `defaulted` and ships with a value.

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npm test -- src/__tests__/DentalResinManifest.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Verify and commit**

```bash
git add src/application/templates/dental-resin-v1 src/__tests__/DentalResinManifest.test.ts
git commit -m "feat(templates): add the dental resin v1 manifest"
```

---

### Task 4: The pure planner

**Files:**
- Create: `src/application/templates/plan-install.ts`
- Test: `src/__tests__/TemplateInstallPlanner.test.ts`

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: `planTemplateInstall(input): { plan: InstallPlan } | { blockers: Blocker[] }` where `input` is `{ manifest, clinicId, values: Record<string, unknown> }`. Task 5 executes the plan; Task 7 reuses the blocker shape.

**This function must not import `db` and must not be `async`.** That is the property that makes it testable without a database, and the property a reviewer should check first.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { planTemplateInstall } from "@/application/templates/plan-install";
import { dentalResinV1 } from "@/application/templates/dental-resin-v1/manifest";
import { CANONICAL_OWNERS } from "@/application/templates/contract";

const CLINIC = "11111111-1111-1111-1111-111111111111";

function completeValues(): Record<string, unknown> {
  // Preenchido no Step 3 com as chaves reais do manifest.
  return {};
}

describe("template install planner", () => {
  it("returns named blockers when a blocking placeholder is missing", () => {
    const result = planTemplateInstall({ manifest: dentalResinV1, clinicId: CLINIC, values: {} });
    expect("blockers" in result).toBe(true);
    if (!("blockers" in result)) return;
    expect(result.blockers.length).toBeGreaterThan(0);
    for (const blocker of result.blockers) {
      expect(blocker.placeholderKey).toBeTruthy();
      expect(blocker.reason).toBeTruthy();
    }
  });

  it("produces no plan at all when blocked", () => {
    const result = planTemplateInstall({ manifest: dentalResinV1, clinicId: CLINIC, values: {} });
    expect("plan" in result).toBe(false);
  });

  it("writes only to canonical owners", () => {
    const result = planTemplateInstall({ manifest: dentalResinV1, clinicId: CLINIC, values: completeValues() });
    expect("plan" in result).toBe(true);
    if (!("plan" in result)) return;
    for (const op of result.plan.operations) {
      expect(CANONICAL_OWNERS).toContain(op.owner);
    }
  });

  it("never emits an operation for another clinic", () => {
    const result = planTemplateInstall({ manifest: dentalResinV1, clinicId: CLINIC, values: completeValues() });
    if (!("plan" in result)) throw new Error("esperava um plano");
    for (const op of result.plan.operations) {
      expect(op.clinicId).toBe(CLINIC);
    }
  });

  it("records an overridden default as a custom field", () => {
    const values = { ...completeValues(), "playbook.tone": "objetivo e direto" };
    const result = planTemplateInstall({ manifest: dentalResinV1, clinicId: CLINIC, values });
    if (!("plan" in result)) throw new Error("esperava um plano");
    expect(result.plan.customFields).toContain("playbook.tone");
  });

  it("does not record an untouched default as a custom field", () => {
    const result = planTemplateInstall({ manifest: dentalResinV1, clinicId: CLINIC, values: completeValues() });
    if (!("plan" in result)) throw new Error("esperava um plano");
    expect(result.plan.customFields).toEqual([]);
  });

  it("maps the media price channel onto a quotable price plus a required asset", () => {
    const values = completeValues();
    const result = planTemplateInstall({ manifest: dentalResinV1, clinicId: CLINIC, values });
    if (!("plan" in result)) throw new Error("esperava um plano");
    const treatmentOps = result.plan.operations.filter((o) => o.owner === "treatments");
    expect(treatmentOps.length).toBeGreaterThan(0);
    for (const op of treatmentOps) {
      expect(typeof op.values.priceQuotableInChat).toBe("boolean");
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- src/__tests__/TemplateInstallPlanner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Fill `completeValues()` and implement the planner**

Fill the helper with every blocking placeholder key the manifest declares, so the "complete clinic" cases actually exercise the success path. Then implement `planTemplateInstall`:

1. Collect blockers: every `blocking` placeholder with no value in `values`.
2. If any blocker exists, return `{ blockers }` and build nothing.
3. Otherwise resolve each placeholder (supplied value, else the default), build the operations, and record as `customFields` every `defaulted` key whose supplied value differs from the default.

Map the delivery channel per the constraint table: `text` → `priceQuotableInChat: true`; `media` → `true` plus the asset; `human` → `false`.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm test -- src/__tests__/TemplateInstallPlanner.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Prove the planner is pure**

```bash
grep -n "from \"@/infrastructure/db\|async function planTemplateInstall" src/application/templates/plan-install.ts
```

Expected: no output. Record that in your report.

- [ ] **Step 6: Verify and commit**

```bash
git add src/application/templates/plan-install.ts src/__tests__/TemplateInstallPlanner.test.ts
git commit -m "feat(templates): plan installs without touching the database"
```

---

### Task 5: The installation record table

**Files:**
- Modify: `src/infrastructure/db/schema.ts`
- Generated: `drizzle/` migration
- Create: `src/application/templates/installation-record.ts`
- Test: `src/__tests__/TemplateInstallationRecord.test.ts`

**Interfaces:**
- Produces: table `template_installations` (`id`, `organization_id`, `template_id`, `template_version`, `manifest_digest`, `custom_fields jsonb`, `installed_by`, `installed_at`), plus `recordInstallation()` and `findInstallation(clinicId, templateId)`. Task 6 writes the record; Task 8 reads it to detect a reinstall.

The `organization_id` FK must be `onDelete: "cascade"`. A derived installation record has no meaning without its clinic, and the previous phase shipped a defect where exactly this omission made clinics undeletable.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { templateInstallations } from "@/infrastructure/db/schema";

describe("template installations table", () => {
  it("records which manifest produced the install", () => {
    const names = getTableConfig(templateInstallations).columns.map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "organization_id", "template_id", "template_version",
        "manifest_digest", "custom_fields", "installed_by", "installed_at",
      ]),
    );
  });

  it("cascades with its clinic", () => {
    const fk = getTableConfig(templateInstallations).foreignKeys[0];
    expect(fk?.onDelete).toBe("cascade");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- src/__tests__/TemplateInstallationRecord.test.ts`
Expected: FAIL — `templateInstallations` is not exported.

- [ ] **Step 3: Add the table and generate the migration**

Declare the table in `schema.ts` following the style of its neighbours, with `.references(() => organizations.id, { onDelete: "cascade" })`.

Run: `npm run db:generate && npm run db:check`
Expected: one new migration with exactly one `CREATE TABLE`. If `db:check` fails on the known CLI-vs-API key-ordering quirk, repair it with `npx tsx scripts/check-drizzle-meta.ts --fix` and say so in your report. Never hand-edit a migration.

- [ ] **Step 4: Implement the accessors**

`recordInstallation()` computes the digest from the manifest content — a stable hash of its JSON — so a later version can tell whether a clinic was installed from the manifest the code currently says.

- [ ] **Step 5: Run the test and verify**

Run: `npm test -- src/__tests__/TemplateInstallationRecord.test.ts && npm run verify`

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/db/schema.ts drizzle src/application/templates/installation-record.ts src/__tests__/TemplateInstallationRecord.test.ts
git commit -m "feat(db): record template installations"
```

---

### Task 6: The executor

**Files:**
- Create: `src/application/templates/execute-install.ts`
- Test: `src/__tests__/TemplateInstallExecutor.test.ts`

**Interfaces:**
- Consumes: Tasks 1-5.
- Produces: `executeInstallPlan(plan, actor): Promise<void>`.

This is the only file in the feature that writes. Neon `neon-http` has **no interactive transactions**, so atomicity across statements is not available — the executor must therefore write the installation record **last**, so a partial failure leaves no record and the install is re-runnable.

- [ ] **Step 1: Write the failing test**

Test with a mocked `db` following the pattern in `src/__tests__/ListClinicConversations.test.ts`. Assert:

- every write targets a table named in `CANONICAL_OWNERS` and no other;
- every write carries the plan's `clinicId`;
- the installation record is written after the last canonical write;
- when a canonical write rejects, no installation record is written and the rejection propagates.

Make the first assertion fail on purpose before trusting it: temporarily add an operation targeting an unrelated table and confirm the test goes red. This plan's largest risk is the executor writing somewhere a different component already owns, and that assertion is the only thing guarding it.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- src/__tests__/TemplateInstallExecutor.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the executor**

Iterate the plan's operations, dispatching on `owner`. Reject any operation whose `clinicId` differs from the plan's — a mismatch is a contract violation, not something to coerce.

- [ ] **Step 4: Run the test and confirm it passes, including the deliberate failure check**

Run: `npm test -- src/__tests__/TemplateInstallExecutor.test.ts`
Expected: PASS. Record both the red and the green runs in your report.

- [ ] **Step 5: Verify and commit**

```bash
git add src/application/templates/execute-install.ts src/__tests__/TemplateInstallExecutor.test.ts
git commit -m "feat(templates): execute install plans against canonical owners"
```

---

### Task 7: The activation gate

**Files:**
- Create: `src/application/templates/activation-gate.ts`
- Test: `src/__tests__/TemplateActivationGate.test.ts`

**Interfaces:**
- Consumes: `Blocker` from Task 1; `buildClinicBlueprint` and `ClinicBlueprintInput` from `src/application/onboarding/clinic-blueprint.ts`.
- Produces: `evaluateActivationGate(input): { allowed: true } | { allowed: false; blockers: Blocker[] }`.

Read `src/application/onboarding/clinic-blueprint.ts` before starting. It already computes `readinessPercent` and `criticalMissing`. **Extend that machinery; do not build a second readiness mechanism.** The change in nature is that the blueprint informs, while this gate forbids.

The four blockers, each with a real failure behind it:

| Blocker | Check | The failure it prevents |
| --- | --- | --- |
| Channel and tenant | `zapiInstanceId` present and resolvable; webhook secret configured | Maycon's `clinic_not_resolved` during onboarding |
| Price | Every installed variant has a price kind; every `media` variant has its asset | Quoting a service 10× wrong; the R$ 4.000 vs R$ 2.000 ambiguity |
| Agenda | `calendarMode` set and, for `google_calendar`, `googleCalendarId` present | Offering slots the agenda never returned |
| Media and reception | Pipeline assets present; `mapsUrl` is a Maps link, not `share.google`; `receptionistPhone` is not a SystemOps number | Ximendes' location link opening search instead of a map; lead photos landing on the operator's phone |

- [ ] **Step 1: Write the failing test**

Cover each blocker in isolation: present allows, absent forbids, and the returned reason names which one failed. Then one test asserting that a clinic missing all four gets four blockers rather than the first one only — an operator fixing one per round trip is the slow setup this phase exists to remove.

Include the two specific string checks: a `mapsUrl` of `https://share.google/abc` must be rejected while `https://maps.app.goo.gl/abc` passes.

- [ ] **Step 2: Run it and confirm it fails**

Run: `npm test -- src/__tests__/TemplateActivationGate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the gate**

- [ ] **Step 4: Run the test and confirm it passes**

- [ ] **Step 5: Verify and commit**

```bash
git add src/application/templates/activation-gate.ts src/__tests__/TemplateActivationGate.test.ts
git commit -m "feat(templates): gate activation on the four blockers"
```

---

### Task 8: Reinstall produces a diff and requires confirmation

**Files:**
- Modify: `src/application/templates/plan-install.ts`
- Test: `src/__tests__/TemplateReinstallDiff.test.ts`

**Interfaces:**
- Consumes: `findInstallation` from Task 5.
- Produces: `planTemplateInstall` accepts an optional `existingInstallation` and, when present, returns `{ diff, requiresConfirmation: true }` instead of a directly-executable plan.

Spec mestre §7.2: an update generates a reviewable diff and never automatically alters an active clinic.

- [ ] **Step 1: Write the failing test**

Assert that with an existing installation the result requires confirmation, that the diff names the fields that would change, and that a plan produced this way cannot be handed to `executeInstallPlan` without the caller acknowledging the diff. Assert an unchanged reinstall produces an empty diff rather than a spurious one.

- [ ] **Step 2-5: Run red, implement, run green, verify and commit**

```bash
git add src/application/templates/plan-install.ts src/__tests__/TemplateReinstallDiff.test.ts
git commit -m "feat(templates): require confirmation to reinstall over a clinic"
```

---

### Task 9: Verification and handoff

**Files:**
- Create: `.superpowers/sdd/2026-08-10-dental-resin-template/task-9-report.md` (commit with `git add -f`; `.superpowers/` is gitignored and only handoff reports are tracked)

- [ ] **Step 1: Verify at the branch tip**

Run `npm run verify` and `npm run build`. Record exact counts and exit codes; `verify` does not run the build, and the previous phase found that gap the hard way.

- [ ] **Step 2: Confirm the gates**

```bash
git diff --name-only origin/main...HEAD -- src/infrastructure/db/schema.ts drizzle migrations
git diff --check origin/main...HEAD
```

One migration is expected, from Task 5.

- [ ] **Step 3: Prove the runtime does not read the manifest**

```bash
grep -rn "templates/dental-resin-v1\|templates/contract" src/core src/infrastructure/adapters 2>/dev/null
```

Expected: no output. This is the constraint that keeps the manifest from becoming a second source of truth; state the command and its result in the report.

- [ ] **Step 4: Write the handoff**

State plainly what was **not** proven:

- No clinic was installed. The planner and executor are covered by unit tests with a mocked database; no end-to-end install against a real database was run.
- The authorized objection content has not been validated in conversation. That is the next spec's 12 replay families.
- The activation gate's channel check does not dial Z-API; it verifies configuration presence, not a live handshake.
- Unit green is not Lab green, and nothing here authorises operating any clinic. All four clients remain paused per spec mestre §1.

- [ ] **Step 5: Commit and finish**

```bash
git add -f .superpowers/sdd/2026-08-10-dental-resin-template/task-9-report.md
git commit -m "docs(templates): hand off the dental resin template"
```

Then use `superpowers:finishing-a-development-branch`, targeting `develop`.

---

## Self-Review

**Spec coverage.** Design §3.1 plan/execute split → Tasks 4 and 6. §3.2 file structure → the File Structure table, one task each. §3.3 canonical owners → Global Constraints table, enforced by Task 4's and Task 6's tests. §4.1 stable slug → Task 1's `TemplateVariant` and Task 3's vocabulary test. §4.2 two placeholder kinds → Task 1 and Task 4's custom-field tests. §4.3 price channels → Task 1, mapped in Task 4. §4.4 forbidden content → Task 3's claim test. §5 activation gate → Task 7. §6 failures → Task 4 (blockers, no partial plan), Task 6 (no record on failure), Task 8 (reinstall diff). §7 tests → distributed. §9 definition of done → Task 9.

**Placeholder scan.** Tasks 7 and 8 describe their tests rather than pasting complete bodies, because both depend on structures the implementer must read first — `clinic-blueprint.ts` for the gate, and the planner's own shape for the diff. Their assertions are named precisely. Task 4's `completeValues()` is deliberately empty in the test skeleton and filled in Step 3, because its keys come from the manifest written in Task 3; the step says so explicitly rather than leaving a silent stub.

**Type consistency.** `TemplateManifest`, `TemplateVariant`, `Placeholder`, `PlaceholderKind`, `PriceChannel`, `CanonicalOwner`, `InstallOperation`, `InstallPlan`, `Blocker`, `validateManifest`, `dentalResinV1`, `planTemplateInstall`, `executeInstallPlan`, `recordInstallation`, `findInstallation`, `evaluateActivationGate` are each defined once and referenced under the same name thereafter. Variant slugs are `base` and `enhanced` throughout. They were deliberately chosen not to collide with any clinic's commercial vocabulary: an earlier draft used `premium`, which Task 3's own vocabulary test forbids, so the manifest would have failed its own suite by construction.

**Known risk carried into execution.** Task 3 is content authoring, and its tests can only check for forbidden patterns and structural properties — they cannot judge whether an objection answer actually sells. The reviewer should read the content as a person, not only run the suite, and the next spec's replay families are what will genuinely test it.
