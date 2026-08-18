import { createHash } from "node:crypto";

import { stableSerialize } from "@/application/replay/fingerprint-replay-config";
import {
  composePlaybookText,
  composePriceSection,
} from "@/application/config/editorial-config";
import {
  INTERNAL_LAB_RUNTIME_ARTIFACT_SCHEMA,
  type InternalLabRuntimeArtifact,
} from "@/application/conversation-v2/internal-lab-runtime-bindings";
import type { PipelineStep } from "@/domain/entities/treatment";

export const SYSTEMOPS_DENTAL_LAB_CONFIG_SCHEMA =
  "systemops-dental-lab-config.v1" as const;
export const SYSTEMOPS_DENTAL_LAB_SNAPSHOT_SCHEMA =
  "systemops-dental-lab-config-snapshot.v1" as const;

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

export const SYSTEMOPS_DENTAL_LAB_CONFIG = deepFreeze({
  name: "SystemOps Dental Lab",
  specialty: "Odontologia — ambiente interno sintético",
  city: "São Paulo",
  address: "ENDEREÇO FICTÍCIO — Rua do Laboratório, 100",
  addressComplement: "Sala 2 — ambiente interno",
  locationMessage:
    "Endereço fictício do SystemOps Dental Lab: Rua do Laboratório, 100, Sala 2, São Paulo/SP.",
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
  professional: {
    name: "Dra. Marina Laboratório",
    specialty: "Odontologia sintética",
    isActive: true,
  },
  treatments: [
    {
      name: "Avaliação odontológica",
      priceCents: 10_000,
      priceKind: "fixed",
      priceQuotableInChat: true,
      priceDeductible: true,
      durationMinutes: 60,
      requiresEvaluationFirst: false,
      pipelineSteps: [
        { type: "ask_availability", label: "Perguntar disponibilidade" },
        { type: "offer_slots", label: "Oferecer horários reais" },
        { type: "book", label: "Confirmar agendamento" },
      ],
      pipelineEntryBehavior: "immediate",
    },
    {
      name: "Lentes/facetas em resina",
      priceCents: 250_000,
      priceKind: "from",
      priceQuotableInChat: true,
      priceDeductible: false,
      durationMinutes: 180,
      requiresEvaluationFirst: true,
      pipelineSteps: [
        {
          type: "qa",
          label: "Entender objetivo estético",
          instruction: "Identifique o procedimento estético de interesse e o objetivo principal relatado pelo paciente.",
          maxTurns: 3,
        },
        { type: "ask_availability", label: "Convidar para avaliação" },
        { type: "offer_slots", label: "Oferecer horários reais" },
        { type: "book", label: "Confirmar avaliação" },
      ],
      pipelineEntryBehavior: "qualify_then_present",
    },
    {
      name: "Clareamento dental",
      priceCents: 90_000,
      priceKind: "fixed",
      priceQuotableInChat: true,
      priceDeductible: false,
      durationMinutes: 90,
      requiresEvaluationFirst: false,
      pipelineSteps: [
        { type: "ask_availability", label: "Perguntar disponibilidade" },
        { type: "offer_slots", label: "Oferecer horários reais" },
        { type: "book", label: "Confirmar agendamento" },
      ],
      pipelineEntryBehavior: "immediate",
    },
  ],
  playbook: {
    name: "SystemOps Dental Lab — consultivo v1",
    status: "active",
    specialty: "Odontologia — ambiente interno sintético",
    toneOfVoice: "acolhedor, claro e consultivo",
    receptionistName: "Marina",
    commercialPolicy:
      "Apresente somente condições estruturadas nos tratamentos. Não invente desconto, parcelamento, garantia ou prazo. Quando faltar dado, informe que a equipe confirma.",
    notes:
      "Responda primeiro ao pedido do paciente. Faça no máximo uma pergunta por mensagem. Não invente fatos. Escale quando uma confirmação humana for necessária.",
  },
} as const);

export type SystemOpsDentalLabOrganizationSnapshot = {
  id: string;
  name: string;
  specialty: string;
  city: string | null;
  address: string | null;
  addressComplement: string | null;
  locationMessage: string | null;
  timezone: string;
  businessHours: string | null;
  businessSchedule: unknown;
  operationalStatus: string;
  isTest: boolean;
  isDemo: boolean;
  calendarMode: string | null;
  autoReplyEnabled: boolean;
  shadowModeEnabled: boolean;
  updatedAt: string;
};

export type SystemOpsDentalLabProfessionalSnapshot = {
  id: string;
  clinicId: string;
  name: string;
  specialty: string | null;
  isActive: boolean;
  color?: string;
  workSchedule?: unknown;
  googleCalendarId?: string | null;
  updatedAt: string;
};

export type SystemOpsDentalLabTreatmentSnapshot = {
  id: string;
  clinicId: string;
  name: string;
  priceCents: number | null;
  priceKind: string;
  priceQuotableInChat: boolean;
  priceDeductible: boolean;
  durationMinutes: number;
  requiresEvaluationFirst: boolean;
  description?: string | null;
  keywordMatchEnabled?: boolean;
  aliases?: string[];
  isAesthetic?: boolean;
  pipelineSteps?: PipelineStep[] | null;
  pipelineSourceTreatmentId?: string | null;
  pipelineEntryBehavior?: string | null;
  minPriceCents?: number | null;
  maxPriceCents?: number | null;
  priceUnit?: string | null;
  quantityPrices?: unknown;
  bookingWindows?: unknown;
  updatedAt: string;
};

export type SystemOpsDentalLabPlaybookSnapshot = {
  id: string;
  clinicId: string;
  name: string;
  status: string;
  specialty: string | null;
  toneOfVoice: string;
  receptionistName: string;
  commercialPolicy: string | null;
  notes: string | null;
  differentials?: string[];
  objections?: unknown[];
  warrantyPolicy?: unknown;
  mediaAssetIds?: string[];
  mediaLibrary?: unknown[];
  updatedAt: string;
};

export type SystemOpsDentalLabConfigSnapshot = {
  schemaVersion: typeof SYSTEMOPS_DENTAL_LAB_SNAPSHOT_SCHEMA;
  clinicId: string;
  channelDigest: string;
  hasOwnerMembership: boolean;
  ownerMembershipDigest: string;
  hasActivePriceCampaigns: boolean;
  organization: SystemOpsDentalLabOrganizationSnapshot;
  professionals: SystemOpsDentalLabProfessionalSnapshot[];
  treatments: SystemOpsDentalLabTreatmentSnapshot[];
  playbooks: SystemOpsDentalLabPlaybookSnapshot[];
};

type DesiredOrganization = Omit<
  SystemOpsDentalLabOrganizationSnapshot,
  "id" | "autoReplyEnabled" | "shadowModeEnabled" | "updatedAt"
>;
type DesiredProfessional = Omit<SystemOpsDentalLabProfessionalSnapshot, "id" | "clinicId" | "updatedAt">;
type DesiredTreatment = Omit<SystemOpsDentalLabTreatmentSnapshot, "id" | "clinicId" | "updatedAt">;
type DesiredPlaybook = Omit<SystemOpsDentalLabPlaybookSnapshot, "id" | "clinicId" | "updatedAt">;

export interface SystemOpsDentalLabConfigTransaction {
  readSnapshotForUpdate(clinicId: string): Promise<SystemOpsDentalLabConfigSnapshot | null>;
  writeOrganization(clinicId: string, organization: DesiredOrganization): Promise<void>;
  upsertProfessional(clinicId: string, professional: DesiredProfessional): Promise<void>;
  upsertTreatment(clinicId: string, treatment: DesiredTreatment): Promise<void>;
  publishPlaybook(clinicId: string, playbook: DesiredPlaybook): Promise<void>;
  readSnapshot(clinicId: string): Promise<SystemOpsDentalLabConfigSnapshot>;
  restoreSnapshot(snapshot: SystemOpsDentalLabConfigSnapshot): Promise<void>;
}

export interface SystemOpsDentalLabConfigStore {
  readSnapshot(clinicId: string): Promise<SystemOpsDentalLabConfigSnapshot | null>;
  transaction<T>(
    clinicId: string,
    operation: (transaction: SystemOpsDentalLabConfigTransaction) => Promise<T>,
  ): Promise<T>;
}

export type SystemOpsDentalLabExactTarget = Readonly<{
  clinicId: string;
  expectedChannelDigest: string;
  expectedOwnerMembershipDigest: string;
  expectedSnapshotDigest?: string;
}>;

function digest(domain: string, value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(`${SYSTEMOPS_DENTAL_LAB_CONFIG_SCHEMA}\0${domain}\0`)
    .update(stableSerialize(value))
    .digest("hex")}`;
}

export function digestSystemOpsDentalLabConfig(): string {
  return digest("desired-config", SYSTEMOPS_DENTAL_LAB_CONFIG);
}

export function digestSystemOpsDentalLabOwnerMembership(
  members: readonly Readonly<{ id: string; email: string; role: string }>[],
): string {
  return digest("owner-membership", [...members]
    .map(({ id, email, role }) => ({ id, email: email.trim().toLowerCase(), role }))
    .sort((left, right) => left.id.localeCompare(right.id)));
}

export function deterministicSystemOpsDentalLabEntityId(
  entity: "professional" | "treatment" | "playbook",
  clinicId: string,
  name: string,
): string {
  const bytes = createHash("sha256")
    .update(`${SYSTEMOPS_DENTAL_LAB_CONFIG_SCHEMA}\0${entity}\0${clinicId}\0${name}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Produz os fatos que o runtime verá depois do apply sem tocar no banco. IDs de
 * linhas existentes são preservados; linhas novas usam IDs determinísticos que
 * o adapter de apply também grava. O signer continua recalculando os bindings
 * pelo contrato do Task 6 — este helper não cria uma segunda função de digest.
 */
export function projectSystemOpsDentalLabRuntimeArtifact(input: {
  current: InternalLabRuntimeArtifact;
  snapshot: SystemOpsDentalLabConfigSnapshot;
}): InternalLabRuntimeArtifact {
  if (input.current.schemaVersion !== INTERNAL_LAB_RUNTIME_ARTIFACT_SCHEMA) {
    throw new Error("SystemOps Dental Lab runtime artifact schema mismatch");
  }
  if (input.snapshot.clinicId !== input.current.clinic.id) {
    throw new Error("SystemOps Dental Lab projected artifact tenant mismatch");
  }
  const clinicId = input.snapshot.clinicId;
  const existingTreatments = new Map(input.current.treatments.map((treatment) => [
    String(treatment.name ?? ""),
    treatment,
  ]));
  const desiredNames = new Set(SYSTEMOPS_DENTAL_LAB_CONFIG.treatments.map(({ name }) => name));
  const projectedTreatments = [
    ...input.current.treatments.filter((treatment) =>
      !desiredNames.has(String(treatment.name ?? "") as typeof SYSTEMOPS_DENTAL_LAB_CONFIG.treatments[number]["name"])),
    ...SYSTEMOPS_DENTAL_LAB_CONFIG.treatments.map((treatment) => {
      const existing = existingTreatments.get(treatment.name);
      return {
        ...(existing ?? {}),
        id: existing?.id ?? deterministicSystemOpsDentalLabEntityId(
          "treatment", clinicId, treatment.name,
        ),
        clinicId,
        name: treatment.name,
        durationMinutes: treatment.durationMinutes,
        description: null,
        requiresEvaluationFirst: treatment.requiresEvaluationFirst,
        keywordMatchEnabled: true,
        aliases: [],
        isAesthetic: treatment.name !== "Avaliação odontológica",
        pipelineSteps: treatment.pipelineSteps,
        pipelineSourceTreatmentId: null,
        pipelineEntryBehavior: treatment.pipelineEntryBehavior,
        priceCents: treatment.priceCents,
        minPriceCents: null,
        maxPriceCents: null,
        priceQuotableInChat: treatment.priceQuotableInChat,
        priceKind: treatment.priceKind,
        priceUnit: null,
        priceDeductible: treatment.priceDeductible,
        quantityPrices: null,
        bookingWindows: null,
      };
    }),
  ].sort((left, right) => String(left.name ?? "").localeCompare(String(right.name ?? "")));
  const procedures = projectedTreatments.map((treatment) => ({
    name: String(treatment.name ?? ""),
    description: typeof treatment.description === "string" ? treatment.description : null,
  }));
  const prices = projectedTreatments.map((treatment) => ({
    name: String(treatment.name ?? ""),
    priceCents: typeof treatment.priceCents === "number" ? treatment.priceCents : null,
    minPriceCents: typeof treatment.minPriceCents === "number" ? treatment.minPriceCents : null,
    priceQuotableInChat: treatment.priceQuotableInChat === true,
    priceKind: treatment.priceKind === "fixed" ? "fixed" as const : "from" as const,
    priceUnit: typeof treatment.priceUnit === "string" ? treatment.priceUnit : null,
    priceDeductible: treatment.priceDeductible === true,
    quantityPrices: Array.isArray(treatment.quantityPrices)
      ? treatment.quantityPrices as import("@/domain/entities/treatment").TreatmentQuantityPrice[]
      : null,
  }));
  const priceSection = composePriceSection(prices);
  const commercialPolicy = [priceSection, SYSTEMOPS_DENTAL_LAB_CONFIG.playbook.commercialPolicy]
    .filter(Boolean)
    .join("\n\n");
  const playbookVersion = input.snapshot.playbooks.find((entry) =>
    entry.name === SYSTEMOPS_DENTAL_LAB_CONFIG.playbook.name);
  const editorial = {
    versionId: playbookVersion?.id ?? deterministicSystemOpsDentalLabEntityId(
      "playbook", clinicId, SYSTEMOPS_DENTAL_LAB_CONFIG.playbook.name,
    ),
    specialty: SYSTEMOPS_DENTAL_LAB_CONFIG.playbook.specialty,
    toneOfVoice: SYSTEMOPS_DENTAL_LAB_CONFIG.playbook.toneOfVoice,
    commercialPolicy,
    receptionistName: SYSTEMOPS_DENTAL_LAB_CONFIG.playbook.receptionistName,
    procedures,
    differentials: [],
    objections: [],
    warrantyPolicy: null,
    mediaLibrary: [],
    playbookText: composePlaybookText({
      procedures,
      notes: SYSTEMOPS_DENTAL_LAB_CONFIG.playbook.notes,
      differentials: [],
      objections: [],
      warrantyPolicy: null,
      mediaLibrary: [],
    }),
  };
  return Object.freeze({
    schemaVersion: INTERNAL_LAB_RUNTIME_ARTIFACT_SCHEMA,
    clinic: {
      ...input.current.clinic,
      ...expectedOrganization(),
    },
    editorial,
    modules: input.current.modules,
    treatments: Object.freeze(projectedTreatments),
  });
}

export function digestSystemOpsDentalLabSnapshot(
  snapshot: SystemOpsDentalLabConfigSnapshot,
): string {
  return digest("managed-snapshot", {
    ...snapshot,
    professionals: [...snapshot.professionals].sort((left, right) => left.id.localeCompare(right.id)),
    treatments: [...snapshot.treatments].sort((left, right) => left.id.localeCompare(right.id)),
    playbooks: [...snapshot.playbooks].sort((left, right) => left.id.localeCompare(right.id)),
  });
}

export function orderSystemOpsDentalLabPlaybooksForRollback(
  playbooks: readonly SystemOpsDentalLabPlaybookSnapshot[],
): readonly SystemOpsDentalLabPlaybookSnapshot[] {
  return [...playbooks].sort((left, right) => {
    const leftActive = left.status === "active" ? 1 : 0;
    const rightActive = right.status === "active" ? 1 : 0;
    return leftActive - rightActive || left.id.localeCompare(right.id);
  });
}

function same(left: unknown, right: unknown): boolean {
  return stableSerialize(left) === stableSerialize(right);
}

function targetErrors(
  snapshot: SystemOpsDentalLabConfigSnapshot | null,
  target: SystemOpsDentalLabExactTarget,
): string[] {
  if (!snapshot || snapshot.clinicId !== target.clinicId || snapshot.organization.id !== target.clinicId) {
    return ["target_not_found_or_mismatch"];
  }
  const errors: string[] = [];
  if (!snapshot.organization.isTest) errors.push("target_not_test");
  if (snapshot.organization.isDemo) errors.push("target_is_demo");
  if (snapshot.organization.operationalStatus !== "test") errors.push("status_not_test");
  if (snapshot.channelDigest !== target.expectedChannelDigest) errors.push("channel_digest_mismatch");
  if (!snapshot.hasOwnerMembership) errors.push("owner_membership_missing");
  if (snapshot.ownerMembershipDigest !== target.expectedOwnerMembershipDigest) {
    errors.push("owner_membership_digest_mismatch");
  }
  if (snapshot.hasActivePriceCampaigns) errors.push("active_price_campaign_present");
  return errors;
}

function expectedOrganization(): DesiredOrganization {
  const config = SYSTEMOPS_DENTAL_LAB_CONFIG;
  return {
    name: config.name,
    specialty: config.specialty,
    city: config.city,
    address: config.address,
    addressComplement: config.addressComplement,
    locationMessage: config.locationMessage,
    timezone: config.timezone,
    businessHours: config.businessHours,
    businessSchedule: config.businessSchedule,
    operationalStatus: config.operationalStatus,
    isTest: config.isTest,
    isDemo: config.isDemo,
    calendarMode: config.calendarMode,
  };
}

export function validateSystemOpsDentalLabSnapshot(snapshot: unknown): ReadonlyArray<string> {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return Object.freeze(["snapshot_invalid"]);
  }
  const value = snapshot as Partial<SystemOpsDentalLabConfigSnapshot>;
  if (
    value.schemaVersion !== SYSTEMOPS_DENTAL_LAB_SNAPSHOT_SCHEMA
    || typeof value.clinicId !== "string"
    || !value.organization
    || !Array.isArray(value.professionals)
    || !Array.isArray(value.treatments)
    || !Array.isArray(value.playbooks)
  ) return Object.freeze(["snapshot_invalid"]);

  const errors: string[] = [];
  const organization = value.organization;
  if (organization.id !== value.clinicId) errors.push("organization_tenant_mismatch");
  for (const [key, expected] of Object.entries(expectedOrganization())) {
    if (!same(organization[key as keyof DesiredOrganization], expected)) {
      errors.push(`organization_${key}_mismatch`);
    }
  }

  const professionalMatches = value.professionals.filter((entry) =>
    entry.clinicId === value.clinicId
    && entry.name === SYSTEMOPS_DENTAL_LAB_CONFIG.professional.name);
  if (professionalMatches.length !== 1) errors.push("professional_count_mismatch");
  else if (!same({
    name: professionalMatches[0].name,
    specialty: professionalMatches[0].specialty,
    isActive: professionalMatches[0].isActive,
  }, SYSTEMOPS_DENTAL_LAB_CONFIG.professional)) errors.push("professional_config_mismatch");

  for (const expected of SYSTEMOPS_DENTAL_LAB_CONFIG.treatments) {
    const matches = value.treatments.filter((entry) =>
      entry.clinicId === value.clinicId && entry.name === expected.name);
    if (matches.length !== 1) {
      errors.push(`treatment_${expected.name}_count_mismatch`);
      continue;
    }
    const actual = matches[0];
    if (!same({
      name: actual.name,
      priceCents: actual.priceCents,
      priceKind: actual.priceKind,
      priceQuotableInChat: actual.priceQuotableInChat,
      priceDeductible: actual.priceDeductible,
      durationMinutes: actual.durationMinutes,
      requiresEvaluationFirst: actual.requiresEvaluationFirst,
      pipelineSteps: actual.pipelineSteps,
      pipelineEntryBehavior: actual.pipelineEntryBehavior,
    }, expected)) errors.push(`treatment_${expected.name}_config_mismatch`);
  }

  const activePlaybooks = value.playbooks.filter((entry) =>
    entry.clinicId === value.clinicId && entry.status === "active");
  if (activePlaybooks.length !== 1) errors.push("active_playbook_count_mismatch");
  else if (!same({
    name: activePlaybooks[0].name,
    status: activePlaybooks[0].status,
    specialty: activePlaybooks[0].specialty,
    toneOfVoice: activePlaybooks[0].toneOfVoice,
    receptionistName: activePlaybooks[0].receptionistName,
    commercialPolicy: activePlaybooks[0].commercialPolicy,
    notes: activePlaybooks[0].notes,
  }, SYSTEMOPS_DENTAL_LAB_CONFIG.playbook)) errors.push("active_playbook_config_mismatch");

  return Object.freeze(errors);
}

function assertExactTarget(
  snapshot: SystemOpsDentalLabConfigSnapshot | null,
  target: SystemOpsDentalLabExactTarget,
): asserts snapshot is SystemOpsDentalLabConfigSnapshot {
  const errors = targetErrors(snapshot, target);
  if (errors.length > 0) {
    throw new Error(`SystemOps Dental Lab target is not eligible: ${errors.join(",")}`);
  }
}

export async function applySystemOpsDentalLabConfig(
  store: SystemOpsDentalLabConfigStore,
  target: SystemOpsDentalLabExactTarget,
): Promise<SystemOpsDentalLabConfigSnapshot> {
  const inspected = await store.readSnapshot(target.clinicId);
  assertExactTarget(inspected, target);
  const inspectedDigest = digestSystemOpsDentalLabSnapshot(inspected);
  if (target.expectedSnapshotDigest && inspectedDigest !== target.expectedSnapshotDigest) {
    throw new Error("SystemOps Dental Lab saved snapshot changed before apply");
  }
  if (validateSystemOpsDentalLabSnapshot(inspected).length === 0) {
    return inspected;
  }
  const expectedSnapshotDigest = target.expectedSnapshotDigest ?? inspectedDigest;

  return store.transaction(target.clinicId, async (transaction) => {
    const locked = await transaction.readSnapshotForUpdate(target.clinicId);
    assertExactTarget(locked, target);
    if (digestSystemOpsDentalLabSnapshot(locked) !== expectedSnapshotDigest) {
      throw new Error("SystemOps Dental Lab changed after inspection");
    }

    await transaction.writeOrganization(target.clinicId, expectedOrganization());
    await transaction.upsertProfessional(
      target.clinicId,
      SYSTEMOPS_DENTAL_LAB_CONFIG.professional,
    );
    for (const treatment of SYSTEMOPS_DENTAL_LAB_CONFIG.treatments) {
      await transaction.upsertTreatment(target.clinicId, {
        ...treatment,
        pipelineSteps: [...treatment.pipelineSteps],
      });
    }
    await transaction.publishPlaybook(target.clinicId, SYSTEMOPS_DENTAL_LAB_CONFIG.playbook);

    const applied = await transaction.readSnapshot(target.clinicId);
    const errors = validateSystemOpsDentalLabSnapshot(applied);
    if (errors.length > 0) {
      throw new Error(`SystemOps Dental Lab apply postcondition failed: ${errors.join(",")}`);
    }
    return applied;
  });
}

export async function rollbackSystemOpsDentalLabConfig(
  store: SystemOpsDentalLabConfigStore,
  target: SystemOpsDentalLabExactTarget,
  snapshot: SystemOpsDentalLabConfigSnapshot,
): Promise<SystemOpsDentalLabConfigSnapshot> {
  if (snapshot.clinicId !== target.clinicId || snapshot.channelDigest !== target.expectedChannelDigest) {
    throw new Error("SystemOps Dental Lab rollback snapshot binding mismatch");
  }
  const current = await store.readSnapshot(target.clinicId);
  assertExactTarget(current, target);
  const currentErrors = validateSystemOpsDentalLabSnapshot(current);
  if (currentErrors.length > 0) {
    throw new Error(`SystemOps Dental Lab rollback current state drifted: ${currentErrors.join(",")}`);
  }
  const currentDigest = digestSystemOpsDentalLabSnapshot(current);

  return store.transaction(target.clinicId, async (transaction) => {
    const locked = await transaction.readSnapshotForUpdate(target.clinicId);
    assertExactTarget(locked, target);
    if (digestSystemOpsDentalLabSnapshot(locked) !== currentDigest) {
      throw new Error("SystemOps Dental Lab changed before rollback lock");
    }
    await transaction.restoreSnapshot(snapshot);
    const restored = await transaction.readSnapshot(target.clinicId);
    if (digestSystemOpsDentalLabSnapshot(restored) !== digestSystemOpsDentalLabSnapshot(snapshot)) {
      throw new Error("SystemOps Dental Lab rollback postcondition failed");
    }
    return restored;
  });
}
