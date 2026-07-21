import { describe, expect, it } from "vitest";
import {
  extractCalendarEventPhone,
  extractEventPhone,
} from "@/application/calendar/extract-event-phone";
import { shouldRepointAppointmentLead } from "@/application/calendar/import-calendar-events";

describe("extractEventPhone — formatos que o operador digita", () => {
  it("aceita o número cru com DDI", () => {
    expect(extractEventPhone("5511921525494")).toBe("5511921525494");
  });

  it("aceita DDD + móvel sem DDI e completa o 55", () => {
    expect(extractEventPhone("11921525494")).toBe("5511921525494");
  });

  it("aceita o formato de agenda brasileiro", () => {
    expect(extractEventPhone("(11) 92152-5494")).toBe("5511921525494");
  });

  it("aceita +55 com espaços", () => {
    expect(extractEventPhone("+55 11 92152-5494")).toBe("5511921525494");
  });

  it("aceita ponto como separador", () => {
    expect(extractEventPhone("11.92152.5494")).toBe("5511921525494");
  });

  it("aceita o 9 separado do resto", () => {
    expect(extractEventPhone("11 9 2152-5494")).toBe("5511921525494");
  });

  it("aceita telefone fixo de 8 dígitos", () => {
    expect(extractEventPhone("(11) 3333-4444")).toBe("551133334444");
  });

  it("encontra o número no meio de uma frase", () => {
    expect(extractEventPhone("Paciente keylla, contato (11) 92152-5494, retorno")).toBe(
      "5511921525494",
    );
  });

  it("encontra o número com rótulo antes", () => {
    expect(extractEventPhone("Tel: 11921525494")).toBe("5511921525494");
    expect(extractEventPhone("WhatsApp 11921525494")).toBe("5511921525494");
  });
});

describe("extractEventPhone — o que NÃO pode virar telefone", () => {
  it("ignora valor em reais", () => {
    expect(extractEventPhone("20 lentes R$ 2.000")).toBeNull();
    expect(extractEventPhone("R$1.500,00 de entrada")).toBeNull();
  });

  it("ignora data", () => {
    expect(extractEventPhone("retorno 22/07/2026")).toBeNull();
    expect(extractEventPhone("marcado 22/07")).toBeNull();
  });

  it("ignora hora", () => {
    expect(extractEventPhone("chega 16:00 sai 21:00")).toBeNull();
    expect(extractEventPhone("16h30")).toBeNull();
  });

  it("ignora CPF e CNPJ", () => {
    expect(extractEventPhone("CPF 123.456.789-00")).toBeNull();
    expect(extractEventPhone("CNPJ 12.345.678/0001-90")).toBeNull();
  });

  it("ignora CEP", () => {
    expect(extractEventPhone("Rua X, 01310-100")).toBeNull();
  });

  it("recusa DDD inexistente", () => {
    expect(extractEventPhone("10921525494")).toBeNull();
    expect(extractEventPhone("(01) 92152-5494")).toBeNull();
  });

  it("recusa móvel de 9 dígitos que não começa com 9", () => {
    expect(extractEventPhone("11821525494")).toBeNull();
  });

  it("recusa dígitos repetidos", () => {
    expect(extractEventPhone("11111111111")).toBeNull();
  });

  it("recusa sequência mais longa que um telefone", () => {
    expect(extractEventPhone("1192152549412345")).toBeNull();
  });

  it("devolve null em texto sem número", () => {
    expect(extractEventPhone("Instalação de lentes")).toBeNull();
    expect(extractEventPhone("")).toBeNull();
    expect(extractEventPhone(null)).toBeNull();
    expect(extractEventPhone(undefined)).toBeNull();
  });
});

describe("extractEventPhone — ruído não pode engolir o número válido", () => {
  // A regressão que motivou a varredura posição a posição: com busca global, o
  // candidato inválido "00 11921525" era consumido primeiro e o telefone real
  // sumia no que sobrava.
  it("acha o telefone depois de um número solto", () => {
    expect(extractEventPhone("2000 11921525494")).toBe("5511921525494");
  });

  it("acha o telefone depois de valor, data e hora juntos", () => {
    expect(
      extractEventPhone("20 lentes R$ 2.000 — 22/07/2026 16:00 — tel 11921525494"),
    ).toBe("5511921525494");
  });

  it("acha o telefone quando o DDD inválido vem antes", () => {
    expect(extractEventPhone("sala 10 (11) 92152-5494")).toBe("5511921525494");
  });

  it("com dois números válidos, fica com o primeiro", () => {
    expect(extractEventPhone("11921525494 / 11940755777")).toBe("5511921525494");
  });
});

describe("extractCalendarEventPhone — descrição antes do título", () => {
  it("prefere a descrição", () => {
    expect(
      extractCalendarEventPhone({
        summary: "keylla 20 lentes 11940755777",
        description: "contato 11921525494",
      }),
    ).toBe("5511921525494");
  });

  it("cai para o título quando a descrição não tem número", () => {
    expect(
      extractCalendarEventPhone({
        summary: "keylla 20 lentes — 11921525494",
        description: "confirmar retorno",
      }),
    ).toBe("5511921525494");
  });

  it("devolve null quando nenhum dos dois tem número", () => {
    expect(
      extractCalendarEventPhone({
        summary: "keylla 20 lentes R$ 2.000",
        description: "",
      }),
    ).toBeNull();
  });

  it("aceita evento sem descrição", () => {
    expect(extractCalendarEventPhone({ summary: "keylla 11921525494" })).toBe(
      "5511921525494",
    );
  });
});

describe("shouldRepointAppointmentLead — agendamento segue o telefone", () => {
  const MUDO = "lead-mudo";
  const CONVERSA = "lead-com-conversa";
  const COM_LID = "lead-so-lid";

  // Mudo = sem telefone e sem @lid. Lead com @lid NÃO entra aqui.
  const mudos = new Set([MUDO]);

  it("reponta quando o agendamento está preso a um lead mudo", () => {
    expect(
      shouldRepointAppointmentLead({
        resolvedLeadId: CONVERSA,
        currentLeadId: MUDO,
        muteLeadIds: mudos,
      }),
    ).toBe(true);
  });

  it("não reponta quando já é o mesmo lead", () => {
    expect(
      shouldRepointAppointmentLead({
        resolvedLeadId: MUDO,
        currentLeadId: MUDO,
        muteLeadIds: mudos,
      }),
    ).toBe(false);
  });

  it("NÃO rouba agendamento de lead com conversa viva", () => {
    expect(
      shouldRepointAppointmentLead({
        resolvedLeadId: CONVERSA,
        currentLeadId: "outro-lead-com-telefone",
        muteLeadIds: mudos,
      }),
    ).toBe(false);
  });

  it("NÃO rouba de lead que tem só @lid — ele conversa, só não tem número", () => {
    expect(
      shouldRepointAppointmentLead({
        resolvedLeadId: CONVERSA,
        currentLeadId: COM_LID,
        muteLeadIds: mudos,
      }),
    ).toBe(false);
  });

  it("não reponta quando nenhum lead é mudo", () => {
    expect(
      shouldRepointAppointmentLead({
        resolvedLeadId: CONVERSA,
        currentLeadId: COM_LID,
        muteLeadIds: new Set(),
      }),
    ).toBe(false);
  });
});
