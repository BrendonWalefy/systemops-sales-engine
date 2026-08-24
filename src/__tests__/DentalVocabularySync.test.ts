import { describe, expect, it } from "vitest";
import { DENTAL_OUTCOME_SCHEMA } from "@/domain-packs/dental/capabilities";
import { dentalPack } from "@/domain-packs/dental";
import { DENTAL_REQUESTS } from "@/domain-packs/dental/vocabulary";
import {
  COMPARISON_CAPABILITY_IDS,
  COMPARISON_REQUESTS,
} from "@/application/conversation-v2/comparison-record";
import {
  EVIDENCE_OUTCOME_TYPES,
  EVIDENCE_REQUESTS,
} from "@/application/labs/systemops-lab-evidence";

/**
 * Um vocabulário fechado declarado em dois lugares já matou turno no meio duas
 * vezes: o tipo aceita, o parser recusa, e a falha é silenciosa. Estes testes
 * existem para que a próxima divergência quebre aqui, e não em produção.
 */
describe("sincronia dos vocabulários fechados do pack dental", () => {
  it("faz o registro de comparação aceitar todo pedido do pack", () => {
    expect([...DENTAL_REQUESTS].filter((request) =>
      !(COMPARISON_REQUESTS as readonly string[]).includes(request))).toEqual([]);
  });

  it("faz o registro de comparação aceitar toda capability do pack", () => {
    expect(dentalPack.capabilities
      .map(({ id }) => id)
      .filter((id) => !(COMPARISON_CAPABILITY_IDS as readonly string[]).includes(id)))
      .toEqual([]);
  });

  it("faz a evidência do Lab aceitar todo pedido do pack", () => {
    expect([...DENTAL_REQUESTS].filter((request) =>
      !(EVIDENCE_REQUESTS as readonly string[]).includes(request))).toEqual([]);
  });

  it("faz a evidência do Lab aceitar todo outcome do pack", () => {
    expect(Object.keys(DENTAL_OUTCOME_SCHEMA).filter((type) =>
      !(EVIDENCE_OUTCOME_TYPES as readonly string[]).includes(type))).toEqual([]);
  });
});
