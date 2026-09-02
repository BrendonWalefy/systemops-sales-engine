import { createHash } from "node:crypto";
import type {
  TreatmentBookingWindow,
  TreatmentQuantityPrice,
} from "@/domain/entities/treatment";

export const RUNTIME_POPULATION_DIGEST_SEMANTICS =
  "ordered-manifest+complete-corpus+normalized-tenant-configs+derived-inputs.v1" as const;
export const RUNTIME_FIXED_NOW_ISO = "2026-08-25T12:00:00.000Z" as const;
export const RUNTIME_DRAIN_NOW_ISO = "2026-08-26T12:00:00.000Z" as const;

type JsonObject = Record<string, unknown>;

export type RuntimeCatalogInput = Readonly<{
  name: string;
  durationMinutes: number;
  description: string | null;
  requiresEvaluationFirst: boolean;
  keywordMatchEnabled: boolean;
  aliases: readonly string[];
  isAesthetic: boolean;
  pipelineSteps: null;
  pipelineSourceTreatmentId: null;
  pipelineEntryBehavior: null;
  priceCents: number | null;
  minPriceCents: number | null;
  maxPriceCents: number | null;
  priceQuotableInChat: boolean;
  priceKind: "from" | "fixed";
  priceUnit: string | null;
  priceDeductible: boolean;
  quantityPrices: TreatmentQuantityPrice[] | null;
  bookingWindows: TreatmentBookingWindow[] | null;
}>;

export type RuntimeFixtureInputs = Readonly<{
  caseId: string;
  organization: Readonly<{
    name: string;
    slug: string;
    specialty: "dental";
    operationalStatus: "active";
    isTest: true;
    isDemo: false;
    autoReplyEnabled: true;
    calendarMode: "internal";
    timezone: string;
    businessHours: string;
    messageDebounceMs: 0;
  }>;
  catalog: readonly RuntimeCatalogInput[];
  lead: Readonly<{ treatmentInterest: string | null }>;
  history: readonly Readonly<{
    author: "lead" | "agent" | "clinic_user";
    body: string;
    minutesBeforeTurn: number;
  }>[];
  requestedState: string | null;
  actionContext:
    | Readonly<{ kind: "none" }>
    | Readonly<{
        kind: "offered_slots";
        treatmentName: string;
        slots: readonly Readonly<{ index: number; startsAt: string; endsAt: string; label: string }>[];
        expiresAt: string;
        durationMinutes: 60;
      }>
    | Readonly<{
        kind: "appointment_confirmation";
        appointmentLabel: string;
        startsAt: string;
        endsAt: string;
      }>
    | Readonly<{
        kind: "active_appointment";
        appointmentLabel: string;
        startsAt: string;
        endsAt: string;
        treatmentName: string;
      }>
    | Readonly<{
        kind: "replacement_offer";
        appointmentLabel: string;
        startsAt: string;
        endsAt: string;
        treatmentName: string;
        slots: readonly Readonly<{ index: number; startsAt: string; endsAt: string; label: string }>[];
        expiresAt: string;
      }>;
  expectedV2Outcome: string;
  turnConfiguration: Readonly<{
    policy: Readonly<{
      priceDisclosureEnabled: true;
      humanEscalationRequired: false;
      schedulingMinimumLeadTimeHours: 2;
      schedulingRequiresEvaluationFirst: false;
    }>;
    style: Readonly<{ tone: "warm"; verbosity: "concise"; greeting: "omit"; emoji: "none" }>;
    speaker: Readonly<{
      agentName: "Runtime";
      organizationName: "Runtime measurement";
      specialty: "dental";
      toneOfVoice: "neutral";
      guidelines: readonly string[];
    }>;
  }>;
}>;

function object(value: unknown, label: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a string`);
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalArray<T>(value: unknown): T[] | null {
  return Array.isArray(value) ? value as T[] : null;
}

function optionalStringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? [...value]
    : null;
}

function serviceKey(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !["de", "da", "das", "do", "dos", "em"].includes(token))
    .join(" ");
}

function serviceQueryMatches(query: string, serviceName: string): boolean {
  const serviceTokens = new Set(serviceKey(serviceName).split(" "));
  const queryTokens = serviceKey(query).split(" ");
  return queryTokens.length > 0 && queryTokens.every((token) => serviceTokens.has(token));
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as JsonObject)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalJson(nested)]));
  }
  return value;
}

function deriveFixtureInputs(
  fixtureValue: unknown,
  configValue: unknown,
  fixtureIndex: number,
): RuntimeFixtureInputs {
  const fixture = object(fixtureValue, "runtime fixture");
  const caseId = string(fixture.caseId, "runtime fixture caseId");
  const input = object(fixture.input, `${caseId} input`);
  const labels = object(fixture.labels, `${caseId} labels`);
  const understanding = object(labels.understanding, `${caseId} understanding`);
  const entities = object(understanding.entities, `${caseId} entities`);
  const expected = object(labels.expectedActionResult, `${caseId} expected action`);
  const expectedType = string(expected.type, `${caseId} expected action type`);
  const request = string(understanding.request, `${caseId} request`);
  const config = object(configValue, `${caseId} tenant config`);
  const services = config.services;
  if (!Array.isArray(services) || services.length === 0) {
    throw new Error(`${caseId} tenant config must have services`);
  }
  const sourceServices = services.map((value, index) => {
    const service = object(value, `${caseId} service ${index}`);
    return { service, name: string(service.name, `${caseId} service ${index} name`) };
  });
  const serviceQuery = optionalString(entities.service);
  const ambiguousMatches = optionalStringArray(expected.ambiguousTreatmentMatches);
  const identified = optionalString(expected.identifiedTreatment);
  const targetNames = ambiguousMatches ?? (identified ? [identified] : []);
  const targets = targetNames.length > 0
    ? sourceServices.filter(({ name }) => targetNames.some((target) => serviceKey(target) === serviceKey(name)))
    : serviceQuery
      ? sourceServices.filter(({ name }) => serviceQueryMatches(serviceQuery, name))
      : [];

  const catalog = sourceServices.map(({ service, name }): RuntimeCatalogInput => {
    const aliases = new Set(optionalStringArray(service.aliases) ?? []);
    if (serviceQuery && targets.some((target) => target.name === name)) aliases.add(serviceQuery);
    const priceCents = optionalNumber(service.priceCents);
    return Object.freeze({
      name,
      durationMinutes: optionalNumber(service.durationMinutes) ?? 60,
      description: optionalString(service.description),
      requiresEvaluationFirst: service.requiresEvaluationFirst === true,
      keywordMatchEnabled: service.keywordMatchEnabled !== false,
      aliases: Object.freeze([...aliases]),
      isAesthetic: service.isAesthetic === true,
      pipelineSteps: null,
      pipelineSourceTreatmentId: null,
      pipelineEntryBehavior: null,
      priceCents,
      minPriceCents: optionalNumber(service.minPriceCents),
      maxPriceCents: optionalNumber(service.maxPriceCents),
      priceQuotableInChat: service.priceQuotableInChat === false ? false : priceCents !== null,
      priceKind: service.priceKind === "from" ? "from" : "fixed",
      priceUnit: optionalString(service.priceUnit),
      priceDeductible: service.priceDeductible === true,
      quantityPrices: optionalArray<TreatmentQuantityPrice>(service.quantityPrices),
      bookingWindows: optionalArray<TreatmentBookingWindow>(service.bookingWindows),
    });
  });

  const expectedV2Outcome = expectedType === "slots_found"
    ? "slots_found"
    : expectedType === "appointment_confirmed"
      ? "appointment_created"
      : expectedType === "appointment_confirmation_accepted"
        ? "appointment_confirmed"
        : targets.length > 1
          ? "service_options_offered"
          : targets.length === 1 && (
            request === "service-availability"
            || targets[0]!.service.priceCents !== null && targets[0]!.service.priceCents !== undefined
          )
            ? "catalog_answered"
            : "clarification_required";

  const treatmentInterest = request === "book-appointment"
    ? targets[0]?.name ?? sourceServices[0]!.name
    : null;
  const historyValues = input.history;
  if (!Array.isArray(historyValues)) throw new Error(`${caseId} history must be an array`);
  const history = historyValues.map((value, index) => {
    const entry = object(value, `${caseId} history ${index}`);
    const sourceAuthor = string(entry.author, `${caseId} history author`);
    if (sourceAuthor !== "lead" && sourceAuthor !== "agent" && sourceAuthor !== "operator") {
      throw new Error(`${caseId} history author is unsupported`);
    }
    return Object.freeze({
      author: sourceAuthor === "operator" ? "clinic_user" as const : sourceAuthor,
      body: string(entry.body, `${caseId} history body`),
      minutesBeforeTurn: historyValues.length - index + 1,
    });
  });

  const alphabeticCatalog = [...catalog].sort((left, right) => left.name.localeCompare(right.name));
  const actionContext: RuntimeFixtureInputs["actionContext"] = expectedType === "appointment_confirmed"
    ? Object.freeze({
        kind: "offered_slots" as const,
        treatmentName: alphabeticCatalog[0]!.name,
        slots: Object.freeze([
          Object.freeze({ index: 1, startsAt: "2026-08-26T17:00:00.000Z", endsAt: "2026-08-26T18:00:00.000Z", label: "quarta às 14h" }),
          Object.freeze({ index: 2, startsAt: "2026-08-26T18:00:00.000Z", endsAt: "2026-08-26T19:00:00.000Z", label: optionalString(expected.slot) ?? "quarta às 15h" }),
        ]),
        expiresAt: "2026-08-26T20:00:00.000Z",
        durationMinutes: 60 as const,
      })
    : expectedType === "appointment_confirmation_accepted"
      ? Object.freeze({
          kind: "appointment_confirmation" as const,
          appointmentLabel: optionalString(expected.appointmentLabel) ?? "horário confirmado",
          startsAt: "2026-08-25T19:00:00.000Z",
          endsAt: "2026-08-25T20:00:00.000Z",
        })
      : Object.freeze({ kind: "none" as const });

  return Object.freeze({
    caseId,
    organization: Object.freeze({
      name: `Runtime measurement ${fixtureIndex + 1}`,
      slug: `runtime-measurement-${fixtureIndex + 1}`,
      specialty: "dental" as const,
      operationalStatus: "active" as const,
      isTest: true as const,
      isDemo: false as const,
      autoReplyEnabled: true as const,
      calendarMode: "internal" as const,
      timezone: optionalString(config.timezone) ?? "America/Sao_Paulo",
      businessHours: optionalString(config.businessHours) ?? "Seg-Sex 08:00-18:00",
      messageDebounceMs: 0 as const,
    }),
    catalog: Object.freeze(catalog),
    lead: Object.freeze({ treatmentInterest }),
    history: Object.freeze(history),
    requestedState: optionalString(input.state),
    actionContext,
    expectedV2Outcome,
    turnConfiguration: Object.freeze({
      policy: Object.freeze({
        priceDisclosureEnabled: true as const,
        humanEscalationRequired: false as const,
        schedulingMinimumLeadTimeHours: 2 as const,
        schedulingRequiresEvaluationFirst: false as const,
      }),
      style: Object.freeze({ tone: "warm" as const, verbosity: "concise" as const, greeting: "omit" as const, emoji: "none" as const }),
      speaker: Object.freeze({
        agentName: "Runtime" as const,
        organizationName: "Runtime measurement" as const,
        specialty: "dental" as const,
        toneOfVoice: "neutral" as const,
        guidelines: Object.freeze([]),
      }),
    }),
  });
}

export function buildRuntimePerformancePopulation(input: Readonly<{
  manifestPath: string;
  manifest: unknown;
  fixtures: readonly unknown[];
  tenantConfigs: ReadonlyMap<string, unknown>;
}>): Readonly<{ populationDigest: string; fixtureInputs: readonly RuntimeFixtureInputs[] }> {
  const manifest = object(input.manifest, "runtime manifest");
  if (!Array.isArray(manifest.cases)) throw new Error("runtime manifest cases must be an array");
  const fixturesById = new Map(input.fixtures.map((fixtureValue) => {
    const fixture = object(fixtureValue, "runtime fixture");
    return [string(fixture.caseId, "runtime fixture caseId"), fixtureValue] as const;
  }));
  const orderedFixtures = manifest.cases.map((entryValue) => {
    const entry = object(entryValue, "runtime manifest case");
    const caseId = string(entry.caseId, "runtime manifest caseId");
    const fixture = fixturesById.get(caseId);
    if (!fixture) throw new Error(`missing runtime fixture ${caseId}`);
    return fixture;
  });
  if (orderedFixtures.length !== input.fixtures.length) {
    throw new Error("runtime fixture selection must exactly match the ordered manifest");
  }
  const referencedConfigs: { ref: string; config: unknown }[] = [];
  const seenConfigRefs = new Set<string>();
  const fixtureInputs = orderedFixtures.map((fixtureValue, index) => {
    const fixture = object(fixtureValue, "runtime fixture");
    const fixtureInput = object(fixture.input, "runtime fixture input");
    const ref = string(fixtureInput.tenantConfigRef, "runtime tenantConfigRef");
    const config = input.tenantConfigs.get(ref);
    if (config === undefined) throw new Error(`missing runtime tenant config ${ref}`);
    if (!seenConfigRefs.has(ref)) {
      seenConfigRefs.add(ref);
      referencedConfigs.push({ ref, config });
    }
    return deriveFixtureInputs(fixtureValue, config, index);
  });
  const digestInput = canonicalJson({
    version: "v2-only-runtime-population.v2",
    semantics: RUNTIME_POPULATION_DIGEST_SEMANTICS,
    manifest: { path: input.manifestPath, contents: input.manifest },
    selectedCorpus: orderedFixtures,
    referencedTenantConfigs: referencedConfigs,
    derivedInputs: {
      fixedNow: RUNTIME_FIXED_NOW_ISO,
      drainNow: RUNTIME_DRAIN_NOW_ISO,
      fixtures: fixtureInputs,
    },
  });
  const populationDigest = `sha256:${createHash("sha256").update(JSON.stringify(digestInput)).digest("hex")}`;
  return Object.freeze({ populationDigest, fixtureInputs: Object.freeze(fixtureInputs) });
}
