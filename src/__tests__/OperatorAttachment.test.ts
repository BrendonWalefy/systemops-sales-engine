import { describe, expect, it } from "vitest";
import {
  formatAttachmentSize,
  inspectOperatorAttachment,
  MAX_OPERATOR_ATTACHMENT_BYTES,
} from "@/application/conversations/operator-attachment";

describe("operator attachment", () => {
  it.each([
    ["foto.jpg", "image/jpeg", "image"],
    ["caso.mp4", "video/mp4", "video"],
    ["proposta.pdf", "application/pdf", "document"],
    ["orcamento.xlsx", "application/octet-stream", "document"],
  ] as const)("aceita %s como %s", (name, type, expectedMediaType) => {
    const result = inspectOperatorAttachment({ name, type, size: 1024 });
    expect(result).toEqual({
      value: expect.objectContaining({ mediaType: expectedMediaType }),
    });
  });

  it("bloqueia executáveis, arquivo vazio, tamanho excessivo e extensão incompatível", () => {
    expect(inspectOperatorAttachment({ name: "virus.exe", type: "application/octet-stream", size: 10 })).toHaveProperty("error");
    expect(inspectOperatorAttachment({ name: "vazio.pdf", type: "application/pdf", size: 0 })).toHaveProperty("error");
    expect(inspectOperatorAttachment({ name: "grande.mp4", type: "video/mp4", size: MAX_OPERATOR_ATTACHMENT_BYTES + 1 })).toHaveProperty("error");
    expect(inspectOperatorAttachment({ name: "enganoso.pdf", type: "image/png", size: 10 })).toHaveProperty("error");
  });

  it("normaliza o nome e formata o tamanho para a prévia", () => {
    const result = inspectOperatorAttachment({
      name: "../Proposta: julho?.pdf",
      type: "application/pdf",
      size: 1024,
    });
    expect(result).toEqual({
      value: expect.objectContaining({ safeFileName: "Proposta_ julho_.pdf" }),
    });
    expect(formatAttachmentSize(1024)).toBe("1 KB");
    expect(formatAttachmentSize(5 * 1024 * 1024)).toBe("5 MB");
  });
});
