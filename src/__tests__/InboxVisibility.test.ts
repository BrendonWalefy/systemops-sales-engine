import { describe, expect, it } from "vitest";
import {
  getAppointmentBadgeWindow,
  isConversationUnreadByClinic,
  shouldShowAppointmentBadge,
} from "@/app/(clinic)/app/inbox/inbox-visibility";

describe("isConversationUnreadByClinic", () => {
  const lastMessageAt = new Date("2026-06-05T15:00:00.000Z");

  it("marca como nao lida quando a ultima mensagem e do lead e nunca foi aberta", () => {
    expect(isConversationUnreadByClinic({ lastAuthor: "lead", lastMessageAt, lastReadAt: null })).toBe(true);
  });

  it("nao marca quando a conversa foi aberta depois da ultima mensagem do lead", () => {
    expect(
      isConversationUnreadByClinic({
        lastAuthor: "lead",
        lastMessageAt,
        lastReadAt: new Date("2026-06-05T15:01:00.000Z"),
      }),
    ).toBe(false);
  });

  it("nao marca quando a ultima mensagem foi da IA ou operador", () => {
    expect(isConversationUnreadByClinic({ lastAuthor: "agent", lastMessageAt, lastReadAt: null })).toBe(false);
    expect(isConversationUnreadByClinic({ lastAuthor: "clinic_user", lastMessageAt, lastReadAt: null })).toBe(false);
  });
});

describe("appointment badge visibility", () => {
  const now = new Date("2026-06-05T12:00:00.000Z");

  it("mostra consulta dentro da janela de 24h antes/depois", () => {
    expect(shouldShowAppointmentBadge(new Date("2026-06-06T11:59:59.000Z"), now)).toBe(true);
    expect(shouldShowAppointmentBadge(new Date("2026-06-04T12:00:01.000Z"), now)).toBe(true);
  });

  it("oculta consulta velha ou muito futura", () => {
    expect(shouldShowAppointmentBadge(new Date("2026-06-04T11:59:59.000Z"), now)).toBe(false);
    expect(shouldShowAppointmentBadge(new Date("2026-06-06T12:00:01.000Z"), now)).toBe(false);
  });

  it("gera a mesma janela usada na query do inbox", () => {
    const window = getAppointmentBadgeWindow(now);
    expect(window.startsAtFrom.toISOString()).toBe("2026-06-04T12:00:00.000Z");
    expect(window.startsAtTo.toISOString()).toBe("2026-06-06T12:00:00.000Z");
  });
});
