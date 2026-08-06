import { describe, it, expect } from "vitest";
import {
  renderPostAppointmentMessage,
  postAppointmentDedupeKey,
} from "@/domain/entities/post-appointment-rule";
import {
  isAutomationOutboundPayload,
  type AutomationOutboundPayload,
} from "@/application/jobs/conversation-outbound-payload";

describe("renderPostAppointmentMessage", () => {
  it("substitui {nome} pelo primeiro nome e {clinica}", () => {
    const out = renderPostAppointmentMessage("Oi {nome}, aqui é da {clinica}!", {
      leadName: "Maria Silva Souza",
      clinicName: "Clínica Aurora",
    });
    expect(out).toBe("Oi Maria, aqui é da Clínica Aurora!");
  });

  it("sem nome, limpa a pontuação órfã", () => {
    const out = renderPostAppointmentMessage("Oi {nome}, como você está?", {
      leadName: null,
      clinicName: "X",
    });
    expect(out).toBe("Oi, como você está?");
  });

  it("não deixa espaços duplos quando o nome falta no meio", () => {
    const out = renderPostAppointmentMessage("Tudo certo {nome} com o resultado?", {
      leadName: "   ",
      clinicName: "X",
    });
    expect(out).toBe("Tudo certo com o resultado?");
  });
});

describe("postAppointmentDedupeKey", () => {
  it("é determinística por (regra, consulta)", () => {
    expect(postAppointmentDedupeKey("cuidados-lentes", "appt-1")).toBe(
      "postcare:cuidados-lentes:appt-1",
    );
    expect(postAppointmentDedupeKey("cuidados-lentes", "appt-1")).toBe(
      postAppointmentDedupeKey("cuidados-lentes", "appt-1"),
    );
    expect(postAppointmentDedupeKey("feedback-24h", "appt-1")).not.toBe(
      postAppointmentDedupeKey("cuidados-lentes", "appt-1"),
    );
  });
});

describe("AutomationOutboundPayload com mediaParts", () => {
  it("continua válido com mediaParts presentes ou ausentes", () => {
    const base: AutomationOutboundPayload = {
      version: 1,
      kind: "automation",
      to: "5511999999999",
      text: "oi",
      leadId: "lead-1",
      conversationId: "conv-1",
      agentMessageId: "msg-1",
    };
    expect(isAutomationOutboundPayload(base)).toBe(true);
    expect(
      isAutomationOutboundPayload({
        ...base,
        mediaParts: [
          { type: "media", mediaId: "m1", url: "https://x/y.jpg", mediaType: "image", title: "Cuidados" },
        ],
      }),
    ).toBe(true);
  });
});
