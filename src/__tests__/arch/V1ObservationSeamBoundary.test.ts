import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const OBSERVATION_CONTRACT = "src/core/observability/V1TurnObservation.ts";
const OBSERVATION_BUILDERS = "src/core/observability/V1TurnObservationBuilders.ts";
const ORCHESTRATOR = "src/core/pipeline/ConversationOrchestrator.ts";

describe("V1 observation seam boundary", () => {
  it("mantém o contrato core sem imports de V2, packs ou core novo", async () => {
    const [contract, builders, orchestrator] = await Promise.all([
      readFile(OBSERVATION_CONTRACT, "utf8"),
      readFile(OBSERVATION_BUILDERS, "utf8"),
      readFile(ORCHESTRATOR, "utf8"),
    ]);
    const forbidden = /(?:src\/|@\/)(?:conversation-core|domain-packs|application\/conversation-v2)(?:\/|["'])/;

    expect(contract).not.toMatch(forbidden);
    expect(builders).not.toMatch(forbidden);
    expect(orchestrator).not.toMatch(forbidden);
  });

  it("mantém o contrato como plain-data sem Date, repository, DB ou provider", async () => {
    const contract = await readFile(OBSERVATION_CONTRACT, "utf8");

    expect(contract).not.toMatch(/\bDate\b|Repository|Gateway|Provider|infrastructure\/db|\bfetch\s*\(/);
    expect(contract).not.toMatch(/Promise\s*</);
  });

  it("mantém a instrumentação turn-local e sem I/O próprio", async () => {
    const [builders, orchestrator] = await Promise.all([
      readFile(OBSERVATION_BUILDERS, "utf8"),
      readFile(ORCHESTRATOR, "utf8"),
    ]);
    const observationLines = orchestrator
      .split(/\r?\n/)
      .filter((line) => /turnObservationSink|recordV1TurnObservation/.test(line));

    expect(observationLines.join("\n")).not.toMatch(/\b(?:db|fetch|Repository|Gateway)\b|\bawait\b/);
    expect(builders).not.toMatch(/infrastructure\/db|Repository|Gateway|Provider|\bfetch\s*\(/);
    expect(orchestrator).not.toMatch(/private readonly turnObservationSink|constructor\([^)]*turnObservationSink/s);
  });

  it("liga builders reais nos reads V1 sem fabricar policy ou resolução a partir do braço de controle", async () => {
    const orchestrator = await readFile(ORCHESTRATOR, "utf8");
    const collector = await readFile("src/application/conversation-v2/v1-observation-collector.ts", "utf8");
    const mapper = collector.slice(collector.indexOf("export function buildCapturedV2TurnReads("));

    expect(orchestrator).toMatch(/buildV1TurnContextObservation\(\{/);
    expect(orchestrator).toMatch(/buildV1TenantSnapshotObservation\(\{/);
    expect(orchestrator).toMatch(/buildV1ServiceResolutionObservation\(\{/);
    expect(orchestrator).toMatch(/buildV1PendingAppointmentResolutionObservation\(\{/);
    expect(orchestrator).toMatch(/recordV1SlotSearchBeforeWrite\(\{/);
    expect(collector).not.toMatch(/serviceResolutions\s*=\s*reads\.slotSearches/);
    expect(mapper).toMatch(/slotSearches:\s*\[\]/);
    expect(mapper).not.toMatch(/reads\.slotSearches\.(?:map|filter|find)/);
    expect(mapper).not.toMatch(/responsePlans|\.terminal\.(?:replied|reason)/);
  });

  it("observa slot search antes de offerSlots e não reutiliza o clock do início do turno", async () => {
    const orchestrator = await readFile(ORCHESTRATOR, "utf8");
    const methodStart = orchestrator.indexOf("private async fetchAndOfferSlots(");
    const methodEnd = orchestrator.indexOf("private async findTodayAppointment(", methodStart);
    const method = orchestrator.slice(methodStart, methodEnd);

    expect(methodStart).toBeGreaterThan(-1);
    expect(method.indexOf("recordV1SlotSearchBeforeWrite({")).toBeGreaterThan(-1);
    expect(method.indexOf("recordV1SlotSearchBeforeWrite({")).toBeLessThan(method.indexOf("this.stateMachine.offerSlots("));
    expect(method).not.toContain("turnStartedAt");
    expect(method).toMatch(/const shouldObserveSearch = Boolean\(observation\?\.sink && windowTreatment\)/);
    expect(method).toMatch(/buildEvent:\s*\(\)\s*=>\s*\{[\s\S]*?buildObservedSearch\(\s*best\.map/);
  });

  it("registra humanControlled pelo gate efetivo depois das retomadas", async () => {
    const orchestrator = await readFile(ORCHESTRATOR, "utf8");
    const gateStart = orchestrator.indexOf("// ── 4. Verifica se a IA está pausada");
    const gateEnd = orchestrator.indexOf("// ── 5. Rate limit", gateStart);
    const gate = orchestrator.slice(gateStart, gateEnd);
    const pausedBranch = gate.indexOf("if (conversation.aiPaused)");
    const activePauseFact = gate.indexOf("buildV1HumanControlGateFact(turnId, true)");
    const resumedFact = gate.lastIndexOf("buildV1HumanControlGateFact(turnId, false)");

    expect(pausedBranch).toBeGreaterThan(-1);
    expect(gate.slice(0, pausedBranch)).not.toContain('field: "humanControlled"');
    expect(activePauseFact).toBeGreaterThan(pausedBranch);
    expect(resumedFact).toBeGreaterThan(activePauseFact);
  });

  it("observa o pending appointment no read existente antes de qualquer save", async () => {
    const orchestrator = await readFile(ORCHESTRATOR, "utf8");
    const branchStart = orchestrator.indexOf('currentConversationState?.state === "awaiting_appointment_confirmation"');
    const branchEnd = orchestrator.indexOf("const isMenuActive", branchStart);
    const branch = orchestrator.slice(branchStart, branchEnd);
    const read = branch.indexOf("this.appointmentRepo.findById(confirmPayload.appointmentId)");
    const observation = branch.indexOf("buildV1PendingAppointmentResolutionObservation({");
    const write = branch.indexOf("this.appointmentRepo.save(");

    expect(read).toBeGreaterThan(-1);
    expect(observation).toBeGreaterThan(read);
    expect(observation).toBeLessThan(write);
    expect(branch.match(/appointmentRepo\.findById/g)).toHaveLength(1);
  });
});
