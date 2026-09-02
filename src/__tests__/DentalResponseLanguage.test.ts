import { describe, expect, it } from "vitest";
import { buildV2AuthorizedResponsePlan } from "@/conversation-core/authorized-response-plan";
import { DeterministicResponseComposer } from "@/conversation-core/composer/deterministic-composer";
import { renderDeterministicResponse } from "@/conversation-core/composer/deterministic-renderer";
import { authorizedStatementsFor } from "@/conversation-core/composer/authorized-surface";
import { validateDraft } from "@/conversation-core/composer/validator";
import type { ActionResult } from "@/conversation-core/decision";
import { DENTAL_OUTCOME_SCHEMA } from "@/domain-packs/dental/capabilities";

describe("renderização determinística de resultados dentais", () => {
  it("verbaliza somente classes e valores autorizados sem léxico externo", async () => {
    const service = { type: "service", id: "service-1", displayName: "Limpeza" };
    const slot = { type: "slot", id: "slot-1", displayName: "quarta às 15h" };
    const appointment = { type: "appointment", id: "appointment-1", displayName: "quarta às 15h" };
    const readEvidence = { source: "read", reference: "catalog-1" } as const;
    const writeEvidence = { source: "write", reference: "booking-1" } as const;
    const results: ActionResult<typeof DENTAL_OUTCOME_SCHEMA>[] = [
      {
        type: "catalog_answered", semanticClass: "information_authorized",
        origin: { capabilityId: "dental-catalog" }, subject: service, evidence: [readEvidence],
        facts: [{ key: "price_cents", value: { kind: "money", amountInMinor: 29000, currency: "BRL" }, subject: service, evidence: readEvidence, disclosure: "allowed" }],
      },
      {
        type: "slots_found", semanticClass: "options_found",
        origin: { capabilityId: "dental-scheduling" }, subject: service, evidence: [readEvidence], facts: [],
        options: [{ id: "slot-1", subject: slot, facts: [{ key: "slot_label", value: { kind: "display_text", value: "quarta às 15h" }, subject: slot, evidence: readEvidence, disclosure: "allowed" }] }],
      },
      {
        type: "appointment_created", semanticClass: "effect_completed",
        origin: { capabilityId: "dental-scheduling" }, subject: appointment, evidence: [writeEvidence],
        facts: [{ key: "appointment_label", value: { kind: "display_text", value: "quarta às 15h" }, subject: appointment, evidence: writeEvidence, disclosure: "allowed" }],
      },
      {
        type: "appointment_create_failed", semanticClass: "effect_failed",
        origin: { capabilityId: "dental-scheduling" }, subject: null, evidence: [writeEvidence], facts: [],
      },
      {
        type: "escalation_required", semanticClass: "human_action_required",
        origin: { capabilityId: "dental-escalation" }, subject: null, evidence: [], facts: [],
      },
    ];
    const plan = buildV2AuthorizedResponsePlan(DENTAL_OUTCOME_SCHEMA, results);
    const draft = await new DeterministicResponseComposer().compose({
      plan,
      style: { tone: "warm", verbosity: "standard", greeting: "omit", emoji: "none" },
    });
    const validation = validateDraft(plan, draft);
    if (!validation.valid) throw new Error(JSON.stringify(validation.violations));

    expect(renderDeterministicResponse({
      draft: validation.draft,
    }).text).toBe(
      'Para "Limpeza", valor: R$ 290,00. Para "Limpeza", tenho estas opções: "quarta às 15h". ' +
      'Para "quarta às 15h", a ação foi concluída. Informação: "quarta às 15h". ' +
      "Não foi possível concluir a ação. É necessário atendimento humano.",
    );
  });

  it("preserva o resultado exato de listar, cancelar e reagendar até a verbalização", async () => {
    const readEvidence = { source: "read", reference: "appointments:list" } as const;
    const writeEvidence = { source: "write", reference: "appointment:effect" } as const;
    const appointmentA = {
      type: "appointment",
      id: "appointment-a",
      displayName: "quarta às 15h",
    } as const;
    const appointmentB = {
      type: "appointment",
      id: "appointment-b",
      displayName: "quinta às 10h",
    } as const;
    const appointmentFact = (
      subject: typeof appointmentA | typeof appointmentB,
      evidence: typeof readEvidence | typeof writeEvidence,
    ) => ({
      key: "appointment_label",
      value: { kind: "display_text" as const, value: subject.displayName },
      subject,
      evidence,
      disclosure: "allowed" as const,
    });
    const results: ActionResult<typeof DENTAL_OUTCOME_SCHEMA>[] = [
      {
        type: "appointments_listed",
        semanticClass: "options_found",
        origin: { capabilityId: "dental-appointment-lifecycle" },
        subject: null,
        evidence: [readEvidence],
        facts: [],
        options: [{ id: appointmentA.id, subject: appointmentA, facts: [
          appointmentFact(appointmentA, readEvidence),
        ] }],
      },
      {
        type: "appointment_cancelled",
        semanticClass: "effect_completed",
        origin: { capabilityId: "dental-appointment-lifecycle" },
        subject: appointmentA,
        evidence: [writeEvidence],
        facts: [appointmentFact(appointmentA, writeEvidence)],
      },
      {
        type: "appointment_rescheduled",
        semanticClass: "effect_completed",
        origin: { capabilityId: "dental-scheduling" },
        subject: appointmentB,
        evidence: [writeEvidence],
        facts: [appointmentFact(appointmentB, writeEvidence)],
      },
      {
        type: "appointment_reschedule_failed",
        semanticClass: "effect_failed",
        origin: { capabilityId: "dental-scheduling" },
        subject: null,
        evidence: [writeEvidence],
        facts: [],
      },
    ];
    const plan = buildV2AuthorizedResponsePlan(DENTAL_OUTCOME_SCHEMA, results);
    const draft = await new DeterministicResponseComposer().compose({
      plan,
      style: { tone: "warm", verbosity: "standard", greeting: "omit", emoji: "none" },
    });
    const validation = validateDraft(plan, draft);
    if (!validation.valid) throw new Error(JSON.stringify(validation.violations));

    expect(authorizedStatementsFor(validation.draft)).toEqual([
      expect.objectContaining({ outcome: "appointments_listed", meaning: "offer_options" }),
      expect.objectContaining({ outcome: "appointment_cancelled", meaning: "confirm_effect" }),
      expect.objectContaining({ outcome: "appointment_rescheduled", meaning: "confirm_effect" }),
      expect.objectContaining({
        outcome: "appointment_reschedule_failed",
        meaning: "communicate_failure",
      }),
    ]);
  });
});
