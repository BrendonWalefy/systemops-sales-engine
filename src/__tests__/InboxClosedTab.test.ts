// Aba de conversas fechadas.
//
// `segmentRows` sempre calculou o balde `closed` (leadStatus won/lost) e
// devolveu ele — mas nenhuma aba o consumia, nem antes nem depois da extração
// para o servidor. Resultado medido em 13/08/2026: a Vitalli tem 1.028 conversas
// comerciais, 1.024 com lead marcado `lost` pelo varredor de inatividade, e o
// Inbox mostrava 2. As conversas nunca sumiram do banco; elas eram inalcançáveis
// pela interface.
import { describe, expect, it } from "vitest";
import {
  buildSegmentIndex,
  INBOX_TAB_KEYS,
  type SegmentInputRow,
} from "@/application/inbox/inbox-segmentation";

function row(over: Partial<SegmentInputRow> & { convId: string }): SegmentInputRow {
  return {
    conversationCategory: "sales",
    aiPaused: false,
    needsAttention: false,
    attentionReason: null,
    takeoverExpiresAt: null,
    lastMessageAt: new Date("2026-08-13T11:00:00.000Z"),
    leadStatus: "in_conversation",
    leadTemperature: null,
    lastMessageAuthor: "lead",
    latestAppointmentStatus: null,
    latestOutcome: null,
    latestConversationState: null,
    latestStateExpiresAt: null,
    hasPendingHumanReview: false,
    ...over,
  } as SegmentInputRow;
}

const NOW = new Date("2026-08-13T12:00:00.000Z");

describe("aba de fechadas", () => {
  it("está registrada entre as abas do Inbox", () => {
    expect(INBOX_TAB_KEYS).toContain("closed");
  });

  it("reúne lead ganho e lead perdido", () => {
    const index = buildSegmentIndex(
      [
        row({ convId: "perdido", leadStatus: "lost" }),
        row({ convId: "ganho", leadStatus: "won" }),
        row({ convId: "vivo", leadStatus: "in_conversation" }),
      ],
      NOW,
    );

    expect(index.idsByTab.closed.sort()).toEqual(["ganho", "perdido"]);
    expect(index.counts.closed).toBe(2);
  });

  it("não muda quem aparece em 'all' — fechada continua fora das abas vivas", () => {
    const index = buildSegmentIndex(
      [
        row({ convId: "perdido", leadStatus: "lost" }),
        row({ convId: "vivo", leadStatus: "in_conversation" }),
      ],
      NOW,
    );

    expect(index.idsByTab.all).toEqual(["vivo"]);
    expect(index.idsByTab.closed).toEqual(["perdido"]);
  });

  it("não conta fechadas como conversas ativas do cabeçalho", () => {
    const index = buildSegmentIndex(
      [
        row({ convId: "a", leadStatus: "lost" }),
        row({ convId: "b", leadStatus: "lost" }),
        row({ convId: "vivo", leadStatus: "in_conversation" }),
      ],
      NOW,
    );

    expect(index.activeCount).toBe(1);
  });

  it("reproduz o caso Vitalli: 1.024 fechadas continuam alcançáveis", () => {
    const rows: SegmentInputRow[] = [
      ...Array.from({ length: 1024 }, (_, i) => row({ convId: `perdido-${i}`, leadStatus: "lost" })),
      ...Array.from({ length: 4 }, (_, i) => row({ convId: `vivo-${i}`, leadStatus: "appointment_scheduled" })),
    ];
    const index = buildSegmentIndex(rows, NOW);

    expect(index.counts.closed).toBe(1024);
    expect(index.counts.all).toBe(4);
    expect(index.counts.closed + index.counts.all).toBe(1028);
  });

  it("ordena as fechadas pela mesma recência das demais abas", () => {
    const index = buildSegmentIndex(
      [
        row({ convId: "antiga", leadStatus: "lost", lastMessageAt: new Date("2026-07-01T00:00:00.000Z") }),
        row({ convId: "recente", leadStatus: "lost", lastMessageAt: new Date("2026-08-10T00:00:00.000Z") }),
      ],
      NOW,
    );

    expect(index.idsByTab.closed).toEqual(["recente", "antiga"]);
  });

  it("respeita o escopo: fechada de outra categoria não entra na aba", () => {
    const index = buildSegmentIndex(
      [
        row({ convId: "venda-perdida", leadStatus: "lost" }),
        row({ convId: "fornecedor", leadStatus: "lost", conversationCategory: "vendor" }),
      ],
      NOW,
    );

    expect(index.idsByTab.closed).toEqual(["venda-perdida"]);
  });
});
