import type { BuildResponsePlanInput } from "@/core/conversation/response-plan";

/** A demo mostra bolhas curtas de WhatsApp; 600 é o mesmo default do pipeline. */
export const DEMO_TURN_MAX_CHARACTERS = 600;

/**
 * A fronteira do turno da demo pública, num módulo próprio porque `actions.ts`
 * é `"use server"` — um arquivo de Server Actions só pode exportar funções
 * async, então a constante e o builder não podem morar lá.
 *
 * A clínica da demo é fictícia e sua política é justamente "nunca informar
 * valores por mensagem". Sem plano, um composer que inventasse um preço estaria
 * exibindo uma promessa comercial para quem está avaliando comprar o produto.
 */
export function buildDemoTurnPlanInput(input: {
  maxCharacters: number;
}): Omit<BuildResponsePlanInput, "actionResult"> {
  return {
    commercialPolicy: null,
    installmentTable: null,
    allowedMediaIds: [],
    expectedState: null,
    maxCharacters: input.maxCharacters,
  };
}
