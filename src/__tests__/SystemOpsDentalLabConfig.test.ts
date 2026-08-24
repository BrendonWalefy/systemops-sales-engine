import { describe, expect, it, vi } from "vitest";

import {
  SYSTEMOPS_DENTAL_LAB_CONFIG,
  applySystemOpsDentalLabConfig,
  digestSystemOpsDentalLabConfig,
  digestSystemOpsDentalLabSnapshot,
  orderSystemOpsDentalLabPlaybooksForRollback,
  projectSystemOpsDentalLabRuntimeArtifact,
  rollbackSystemOpsDentalLabConfig,
  validateSystemOpsDentalLabSnapshot,
  type SystemOpsDentalLabConfigSnapshot,
  type SystemOpsDentalLabConfigStore,
  type SystemOpsDentalLabConfigTransaction,
} from "@/application/labs/systemops-dental-lab-config";
import {
  computeInternalLabRuntimeBindings,
  INTERNAL_LAB_RUNTIME_ARTIFACT_SCHEMA,
} from "@/application/conversation-v2/internal-lab-runtime-bindings";
import {
  parseSystemOpsDentalLabCommandArgs,
  runSystemOpsDentalLabConfigCommand,
} from "../../scripts/configure-systemops-dental-lab";

const labId = "00000000-0000-0000-0000-000000000001";
const otherId = "00000000-0000-0000-0000-000000000002";
const channelDigest = `sha256:${"a".repeat(64)}`;
const ownerMembershipDigest = `sha256:${"c".repeat(64)}`;
const timestamp = "2026-08-17T20:00:00.000Z";

function emptySnapshot(clinicId = labId): SystemOpsDentalLabConfigSnapshot {
  return {
    schemaVersion: "systemops-dental-lab-config-snapshot.v1",
    clinicId,
    channelDigest,
    hasOwnerMembership: true,
    ownerMembershipDigest,
    hasActivePriceCampaigns: false,
    organization: {
      id: clinicId,
      name: "Old Lab",
      specialty: "Odontologia",
      city: null,
      address: null,
      addressComplement: null,
      locationMessage: null,
      timezone: "America/Sao_Paulo",
      businessHours: null,
      businessSchedule: null,
      operationalStatus: "test",
      isTest: true,
      isDemo: false,
      calendarMode: "internal",
      autoReplyEnabled: false,
      shadowModeEnabled: false,
      updatedAt: timestamp,
    },
    professionals: [],
    treatments: [],
    playbooks: [],
  };
}

function configuredSnapshot(): SystemOpsDentalLabConfigSnapshot {
  const snapshot = emptySnapshot();
  snapshot.organization = {
    ...snapshot.organization,
    name: "SystemOps Dental Lab",
    specialty: "Odontologia — ambiente interno sintético",
    city: "São Paulo",
    address: "ENDEREÇO FICTÍCIO — Rua do Laboratório, 100",
    addressComplement: "Sala 2 — ambiente interno",
    locationMessage: "Endereço fictício do SystemOps Dental Lab: Rua do Laboratório, 100, Sala 2, São Paulo/SP.",
    businessHours: "segunda a sexta, das 09h às 18h",
    businessSchedule: {
      days: Object.fromEntries([1, 2, 3, 4, 5].map((day) => [day, [
        { startHour: 9, startMinute: 0, endHour: 18, endMinute: 0 },
      ]])),
    },
  };
  snapshot.professionals = [{
    id: "professional-lab",
    clinicId: labId,
    name: "Dra. Marina Laboratório",
    specialty: "Odontologia sintética",
    isActive: true,
    updatedAt: timestamp,
  }];
  snapshot.treatments = [
    ["Avaliação odontológica", 10_000, "fixed", true, 60, false],
    ["Lentes/facetas em resina", 250_000, "from", false, 180, true],
    ["Clareamento dental", 90_000, "fixed", false, 90, false],
  ].map(([name, priceCents, priceKind, priceDeductible, durationMinutes, requiresEvaluationFirst], index) => ({
    id: `treatment-${index}`,
    clinicId: labId,
    name: name as string,
    // Apelido e descrição vêm do próprio config: repetir o texto aqui deixaria a
    // fixture passar enquanto a configuração real ficasse vazia.
    aliases: [...SYSTEMOPS_DENTAL_LAB_CONFIG.treatments.find((entry) => entry.name === name)!.aliases],
    description: SYSTEMOPS_DENTAL_LAB_CONFIG.treatments.find((entry) => entry.name === name)!.description,
    priceCents: priceCents as number,
    priceKind: priceKind as string,
    priceQuotableInChat: true,
    priceDeductible: priceDeductible as boolean,
    durationMinutes: durationMinutes as number,
    requiresEvaluationFirst: requiresEvaluationFirst as boolean,
    pipelineSteps: index === 1
      ? [
          { type: "qa" as const, label: "Entender objetivo estético", instruction: "Identifique o procedimento estético de interesse e o objetivo principal relatado pelo paciente.", maxTurns: 3 },
          { type: "ask_availability" as const, label: "Convidar para avaliação" },
          { type: "offer_slots" as const, label: "Oferecer horários reais" },
          { type: "book" as const, label: "Confirmar avaliação" },
        ]
      : [
          { type: "ask_availability" as const, label: "Perguntar disponibilidade" },
          { type: "offer_slots" as const, label: "Oferecer horários reais" },
          { type: "book" as const, label: "Confirmar agendamento" },
        ],
    pipelineEntryBehavior: index === 1 ? "qualify_then_present" : "immediate",
    updatedAt: timestamp,
  }));
  snapshot.playbooks = [{
    id: "playbook-lab",
    clinicId: labId,
    name: "SystemOps Dental Lab — consultivo v1",
    status: "active",
    specialty: "Odontologia — ambiente interno sintético",
    toneOfVoice: "acolhedor, claro e consultivo",
    receptionistName: "Marina",
    commercialPolicy: "Apresente somente condições estruturadas nos tratamentos. Não invente desconto, parcelamento, garantia ou prazo. Quando faltar dado, informe que a equipe confirma.",
    notes: "Responda primeiro ao pedido do paciente. Faça no máximo uma pergunta por mensagem. Não invente fatos. Escale quando uma confirmação humana for necessária.",
    updatedAt: timestamp,
  }];
  return snapshot;
}

function createMemoryStore(initial: readonly SystemOpsDentalLabConfigSnapshot[]): {
  store: SystemOpsDentalLabConfigStore;
  changedClinicIds: string[];
  snapshot(clinicId: string): SystemOpsDentalLabConfigSnapshot;
} {
  const states = new Map(initial.map((entry) => [entry.clinicId, structuredClone(entry)]));
  const changedClinicIds: string[] = [];

  const transaction = (clinicId: string): SystemOpsDentalLabConfigTransaction => ({
    async readSnapshotForUpdate() {
      return structuredClone(states.get(clinicId) ?? null);
    },
    async writeOrganization(_targetId, organization) {
      const current = states.get(clinicId);
      if (!current) throw new Error("missing target");
      current.organization = { ...current.organization, ...structuredClone(organization) };
      changedClinicIds.push(clinicId);
    },
    async upsertProfessional(_targetId, professional) {
      const current = states.get(clinicId)!;
      const index = current.professionals.findIndex((entry) => entry.name === professional.name);
      const next = { id: index >= 0 ? current.professionals[index].id : `professional-${clinicId}`, clinicId, ...structuredClone(professional), updatedAt: timestamp };
      if (index >= 0) current.professionals[index] = next;
      else current.professionals.push(next);
    },
    async upsertTreatment(_targetId, treatment) {
      const current = states.get(clinicId)!;
      const index = current.treatments.findIndex((entry) => entry.name === treatment.name);
      const next = { id: index >= 0 ? current.treatments[index].id : `treatment-${current.treatments.length}-${clinicId}`, clinicId, ...structuredClone(treatment), updatedAt: timestamp };
      if (index >= 0) current.treatments[index] = next;
      else current.treatments.push(next);
    },
    async publishPlaybook(_targetId, playbook) {
      const current = states.get(clinicId)!;
      current.playbooks = current.playbooks.map((entry) => ({ ...entry, status: "historical" }));
      const index = current.playbooks.findIndex((entry) => entry.name === playbook.name);
      const next = { id: index >= 0 ? current.playbooks[index].id : `playbook-${clinicId}`, clinicId, ...structuredClone(playbook), updatedAt: timestamp };
      if (index >= 0) current.playbooks[index] = next;
      else current.playbooks.push(next);
    },
    async readSnapshot() {
      return structuredClone(states.get(clinicId)!);
    },
    async restoreSnapshot(snapshot) {
      states.set(clinicId, structuredClone(snapshot));
      changedClinicIds.push(clinicId);
    },
  });

  return {
    changedClinicIds,
    store: {
      async readSnapshot(clinicId) {
        return structuredClone(states.get(clinicId) ?? null);
      },
      async transaction(clinicId, operation) {
        const before = structuredClone(states.get(clinicId));
        try {
          return await operation(transaction(clinicId));
        } catch (error) {
          if (before) states.set(clinicId, before);
          throw error;
        }
      },
    },
    snapshot(clinicId) {
      return structuredClone(states.get(clinicId)!);
    },
  };
}

describe("SystemOps Dental Lab declarative config", () => {
  it("keeps prices only in treatment facts and marks every operational value as synthetic", () => {
    expect(SYSTEMOPS_DENTAL_LAB_CONFIG.address).toMatch(/^ENDEREÇO FICTÍCIO/);
    expect(SYSTEMOPS_DENTAL_LAB_CONFIG.specialty).toContain("sintético");
    expect(SYSTEMOPS_DENTAL_LAB_CONFIG.playbook.commercialPolicy).not.toMatch(/R\$|\b\d+[.,]\d{2}\b/);
    expect(SYSTEMOPS_DENTAL_LAB_CONFIG.treatments.map((entry) => entry.priceCents)).toEqual([
      10000, 250000, 90000,
    ]);
    expect(SYSTEMOPS_DENTAL_LAB_CONFIG.treatments.every((entry) => entry.pipelineSteps.length > 0)).toBe(true);
    expect(SYSTEMOPS_DENTAL_LAB_CONFIG.treatments[1].pipelineSteps[0].instruction).toBe(
      "Identifique o procedimento estético de interesse e o objetivo principal relatado pelo paciente.",
    );
  });

  it("declara apelido e descrição em todo tratamento, senão o modelo adivinha", () => {
    for (const entry of SYSTEMOPS_DENTAL_LAB_CONFIG.treatments) {
      expect(entry.aliases.length, `${entry.name} sem apelido`).toBeGreaterThan(0);
      expect(entry.description, `${entry.name} sem descrição`).toBeTruthy();
    }
  });

  it("mantém toda descrição dentro do teto de fato divulgável", () => {
    for (const entry of SYSTEMOPS_DENTAL_LAB_CONFIG.treatments) {
      expect(entry.description.length, `${entry.name} passa de 240`).toBeLessThanOrEqual(240);
      expect(entry.description.trim()).toBe(entry.description);
    }
  });

  it("não deixa a descrição afirmar preço, prazo ou garantia", () => {
    for (const entry of SYSTEMOPS_DENTAL_LAB_CONFIG.treatments) {
      expect(entry.description, `${entry.name}`).not.toMatch(/R\$|\breais\b/i);
      expect(entry.description, `${entry.name}`).not.toMatch(/garant|promet|assegur/i);
    }
  });

  it("persiste apelido e descrição em vez de apagá-los a cada apply", async () => {
    const memory = createMemoryStore([emptySnapshot()]);

    await applySystemOpsDentalLabConfig(memory.store, {
      clinicId: labId,
      expectedChannelDigest: channelDigest,
      expectedOwnerMembershipDigest: ownerMembershipDigest,
    });

    const persisted = memory.snapshot(labId).treatments;
    for (const declared of SYSTEMOPS_DENTAL_LAB_CONFIG.treatments) {
      const row = persisted.find((entry) => entry.name === declared.name)!;
      expect(row.aliases, `${declared.name}`).toEqual([...declared.aliases]);
      expect(row.description, `${declared.name}`).toBe(declared.description);
    }
  });

  it("produces the same domain-separated digest regardless of object mutation attempts", () => {
    const first = digestSystemOpsDentalLabConfig();
    expect(() => {
      (SYSTEMOPS_DENTAL_LAB_CONFIG.treatments as unknown as Array<unknown>).push({});
    }).toThrow();
    expect(digestSystemOpsDentalLabConfig()).toBe(first);
    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("applies the same desired state twice without duplicate rows", async () => {
    const memory = createMemoryStore([emptySnapshot()]);
    const target = { clinicId: labId, expectedChannelDigest: channelDigest, expectedOwnerMembershipDigest: ownerMembershipDigest };

    await applySystemOpsDentalLabConfig(memory.store, target);
    await applySystemOpsDentalLabConfig(memory.store, target);

    const state = memory.snapshot(labId);
    expect(state.treatments).toHaveLength(3);
    expect(state.professionals.filter((entry) => entry.name === SYSTEMOPS_DENTAL_LAB_CONFIG.professional.name)).toHaveLength(1);
    expect(state.playbooks.filter((entry) => entry.status === "active")).toHaveLength(1);
    expect(validateSystemOpsDentalLabSnapshot(state)).toEqual([]);
  });

  it("never reads or writes another tenant", async () => {
    const memory = createMemoryStore([emptySnapshot(), emptySnapshot(otherId)]);

    await applySystemOpsDentalLabConfig(memory.store, {
      clinicId: labId,
      expectedChannelDigest: channelDigest,
      expectedOwnerMembershipDigest: ownerMembershipDigest,
    });

    expect([...new Set(memory.changedClinicIds)]).toEqual([labId]);
    expect(memory.snapshot(otherId)).toEqual(emptySnapshot(otherId));
  });

  it("fails closed before transaction when target predicates or channel binding differ", async () => {
    const unsafe = emptySnapshot();
    unsafe.organization.isDemo = true;
    const memory = createMemoryStore([unsafe]);

    await expect(applySystemOpsDentalLabConfig(memory.store, {
      clinicId: labId,
      expectedChannelDigest: channelDigest,
      expectedOwnerMembershipDigest: ownerMembershipDigest,
    })).rejects.toThrow(/eligible|target/i);
    await expect(applySystemOpsDentalLabConfig(createMemoryStore([emptySnapshot()]).store, {
      clinicId: labId,
      expectedChannelDigest: `sha256:${"b".repeat(64)}`,
      expectedOwnerMembershipDigest: ownerMembershipDigest,
    })).rejects.toThrow(/channel/i);
    expect(memory.changedClinicIds).toEqual([]);
  });

  it("rolls the managed state back to the exact pre-apply snapshot", async () => {
    const before = emptySnapshot();
    const memory = createMemoryStore([before]);
    const target = { clinicId: labId, expectedChannelDigest: channelDigest, expectedOwnerMembershipDigest: ownerMembershipDigest };

    await applySystemOpsDentalLabConfig(memory.store, target);
    const restored = await rollbackSystemOpsDentalLabConfig(memory.store, target, before);

    expect(restored).toEqual(before);
    expect(memory.snapshot(labId)).toEqual(before);
  });

  it("rejects apply when the locked snapshot differs from the externally saved one", async () => {
    const inspected = emptySnapshot();
    const locked = structuredClone(inspected);
    locked.organization.city = "changed-after-snapshot";
    const transaction = {
      readSnapshotForUpdate: async () => locked,
      writeOrganization: vi.fn(),
      upsertProfessional: vi.fn(),
      upsertTreatment: vi.fn(),
      publishPlaybook: vi.fn(),
      readSnapshot: async () => locked,
      restoreSnapshot: vi.fn(),
    } satisfies SystemOpsDentalLabConfigTransaction;
    const store: SystemOpsDentalLabConfigStore = {
      readSnapshot: async () => inspected,
      transaction: async (_clinicId, operation) => operation(transaction),
    };

    await expect(applySystemOpsDentalLabConfig(store, {
      clinicId: labId,
      expectedChannelDigest: channelDigest,
      expectedOwnerMembershipDigest: ownerMembershipDigest,
      expectedSnapshotDigest: digestSystemOpsDentalLabSnapshot(inspected),
    })).rejects.toThrow(/changed after inspection/i);
    expect(transaction.writeOrganization).not.toHaveBeenCalled();
  });

  it("refuses rollback over managed state that drifted after apply", async () => {
    const before = emptySnapshot();
    const drifted = configuredSnapshot();
    drifted.treatments[0].priceCents = 20_000;
    const memory = createMemoryStore([drifted]);

    await expect(rollbackSystemOpsDentalLabConfig(memory.store, {
      clinicId: labId,
      expectedChannelDigest: channelDigest,
      expectedOwnerMembershipDigest: ownerMembershipDigest,
    }, before)).rejects.toThrow(/current state drifted/i);
    expect(memory.changedClinicIds).toEqual([]);
  });

  it("orders every non-active playbook before the single active row during rollback", () => {
    const snapshot = configuredSnapshot();
    snapshot.playbooks.unshift({
      ...snapshot.playbooks[0],
      id: "historical-playbook",
      name: "Historical",
      status: "historical",
    });

    expect(orderSystemOpsDentalLabPlaybooksForRollback(snapshot.playbooks).map((row) => row.status))
      .toEqual(["historical", "active"]);
  });

  it("projects the exact Task 6 artifact with stable IDs before any write", () => {
    const current = {
      schemaVersion: INTERNAL_LAB_RUNTIME_ARTIFACT_SCHEMA,
      clinic: { id: labId, name: "Old Lab", channelProvider: "z_api" },
      editorial: null,
      modules: [{ key: "scheduling", config: null }],
      treatments: [],
    } as const;

    const first = projectSystemOpsDentalLabRuntimeArtifact({ current, snapshot: emptySnapshot() });
    const second = projectSystemOpsDentalLabRuntimeArtifact({ current, snapshot: emptySnapshot() });

    expect(first).toEqual(second);
    expect(first.clinic.name).toBe("SystemOps Dental Lab");
    expect(first.treatments).toHaveLength(3);
    expect(new Set(first.treatments.map((entry) => entry.id)).size).toBe(3);
    expect(computeInternalLabRuntimeBindings(first)).toEqual(
      computeInternalLabRuntimeBindings(second),
    );
  });

  it("binds the exact internal owner, rejects campaigns and canonicalizes snapshot order", async () => {
    const wrongOwner = emptySnapshot();
    wrongOwner.ownerMembershipDigest = `sha256:${"d".repeat(64)}`;
    await expect(applySystemOpsDentalLabConfig(createMemoryStore([wrongOwner]).store, {
      clinicId: labId,
      expectedChannelDigest: channelDigest,
      expectedOwnerMembershipDigest: ownerMembershipDigest,
    })).rejects.toThrow(/owner/i);

    const campaign = emptySnapshot();
    campaign.hasActivePriceCampaigns = true;
    await expect(applySystemOpsDentalLabConfig(createMemoryStore([campaign]).store, {
      clinicId: labId,
      expectedChannelDigest: channelDigest,
      expectedOwnerMembershipDigest: ownerMembershipDigest,
    })).rejects.toThrow(/campaign/i);

    const ordered = configuredSnapshot();
    const reversed = structuredClone(ordered);
    reversed.treatments.reverse();
    reversed.playbooks.reverse();
    expect(digestSystemOpsDentalLabSnapshot(reversed)).toBe(
      digestSystemOpsDentalLabSnapshot(ordered),
    );
  });
});

describe("SystemOps Dental Lab config command", () => {
  it("accepts exactly one mode and requires an external snapshot for apply", () => {
    expect(() => parseSystemOpsDentalLabCommandArgs([
      "--clinic-id", labId,
      "--expected-channel-digest", channelDigest,
      "--expected-owner-membership-digest", ownerMembershipDigest,
      "--dry-run", "--verify",
    ])).toThrow(/exactly one mode/i);
    expect(() => parseSystemOpsDentalLabCommandArgs([
      "--clinic-id", labId,
      "--expected-channel-digest", channelDigest,
      "--expected-owner-membership-digest", ownerMembershipDigest,
      "--apply",
    ])).toThrow(/snapshot/i);
  });

  it("writes the rollback snapshot before the first database mutation", async () => {
    const calls: string[] = [];
    const before = emptySnapshot();
    const after = configuredSnapshot();
    const apply = vi.fn(async () => {
      calls.push("apply");
      return after;
    });

    await runSystemOpsDentalLabConfigCommand({
      mode: "apply",
      clinicId: labId,
      expectedChannelDigest: channelDigest,
      expectedOwnerMembershipDigest: ownerMembershipDigest,
      snapshotPath: "/private/tmp/systemops-lab-snapshot.json",
      resolvedArtifactPath: null,
    }, {
      inspect: async () => before,
      apply,
      rollback: vi.fn(),
      writeOwnerOnlyFile: async () => {
        calls.push("snapshot");
      },
      readOwnerOnlyFile: vi.fn(),
      resolveRuntimeArtifact: vi.fn(),
      write: vi.fn(),
    });

    expect(calls).toEqual(["snapshot", "apply"]);
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({
      expectedSnapshotDigest: expect.stringMatching(/^sha256:/),
    }));
  });

  it("dry-run and verify never invoke a mutating dependency", async () => {
    const apply = vi.fn();
    const rollback = vi.fn();
    const states = { "dry-run": emptySnapshot(), verify: configuredSnapshot() } as const;

    for (const mode of ["dry-run", "verify"] as const) {
      await runSystemOpsDentalLabConfigCommand({
        mode,
        clinicId: labId,
        expectedChannelDigest: channelDigest,
        expectedOwnerMembershipDigest: ownerMembershipDigest,
        snapshotPath: null,
        resolvedArtifactPath: null,
      }, {
        inspect: async () => states[mode],
        apply,
        rollback,
        writeOwnerOnlyFile: vi.fn(),
        readOwnerOnlyFile: vi.fn(),
        resolveRuntimeArtifact: vi.fn(),
        write: vi.fn(),
      });
    }

    expect(apply).not.toHaveBeenCalled();
    expect(rollback).not.toHaveBeenCalled();
  });

  it("writes a projected Task 6 artifact during dry-run without applying", async () => {
    const written: string[] = [];
    const apply = vi.fn();

    await runSystemOpsDentalLabConfigCommand({
      mode: "dry-run",
      clinicId: labId,
      expectedChannelDigest: channelDigest,
      expectedOwnerMembershipDigest: ownerMembershipDigest,
      snapshotPath: null,
      resolvedArtifactPath: "/private/tmp/systemops-lab-resolved.json",
    }, {
      inspect: async () => emptySnapshot(),
      apply,
      rollback: vi.fn(),
      writeOwnerOnlyFile: async (_path, contents) => {
        written.push(contents);
      },
      readOwnerOnlyFile: vi.fn(),
      resolveRuntimeArtifact: async () => ({
        schemaVersion: INTERNAL_LAB_RUNTIME_ARTIFACT_SCHEMA,
        clinic: { id: labId, channelProvider: "z_api", zapiToken: "secret-must-not-leave" },
        editorial: null,
        modules: [],
        treatments: [],
      }),
      write: vi.fn(),
    });

    expect(apply).not.toHaveBeenCalled();
    expect(JSON.parse(written[0]).clinic.name).toBe("SystemOps Dental Lab");
    expect(JSON.parse(written[0]).treatments).toHaveLength(3);
    expect(written.join("\n")).not.toContain("secret-must-not-leave");
  });
});
