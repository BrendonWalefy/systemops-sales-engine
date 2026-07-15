/**
 * Token de acesso da página pública de validação (ADR-002 Fase 2, apêndice G).
 *
 * A implementação foi extraída para o módulo compartilhado
 * `src/application/public-link/access-token.ts` quando a Revisão de Conversas
 * clonou o padrão de página pública tokenizada
 * (docs/product/revisao-conversas-plano.md, Apêndice A). Este arquivo é um
 * re-export que preserva o contrato original — imports e testes existentes
 * continuam funcionando sem alteração; hash e formato do token não mudaram.
 */

export {
  generateAccessToken,
  hashAccessToken,
  resolvePublicDocState as resolveStudyState,
} from "@/application/public-link/access-token";

export type {
  PublicDocState as PublicStudyState,
  PublicDocStateInput as StudyStateInput,
} from "@/application/public-link/access-token";
