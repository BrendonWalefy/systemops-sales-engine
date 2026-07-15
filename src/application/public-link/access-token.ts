/**
 * Token de acesso compartilhado das páginas públicas tokenizadas.
 *
 * Nascido na página de validação do estudo de setup (ADR-002 Fase 2,
 * apêndice G) e extraído para módulo compartilhado quando a Revisão de
 * Conversas clonou o padrão (docs/product/revisao-conversas-plano.md,
 * Apêndice A). Hash e formato do token são idênticos aos originais —
 * `src/application/setup-study/access-token.ts` re-exporta este módulo.
 *
 * O banco guarda **apenas** o sha256 do token (`access_token_hash`).
 * O token cru é exibido ao owner uma única vez na geração (padrão de API
 * key) e viaja só no link enviado ao responsável da clínica. A resolução do
 * documento na rota pública é feita exclusivamente pelo hash — o `clinicId`
 * nunca aparece na URL nem no payload.
 *
 * Espaço de 256 bits torna brute-force inviável → rate limit dispensado na v1
 * (decisão registrada no ADR-002 apêndice G e repetida no plano da revisão).
 */

import { createHash, randomBytes } from "node:crypto";

/** Gera um token de acesso e seu hash. Retorna o token cru para exibir 1x. */
export function generateAccessToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashAccessToken(token) };
}

/** sha256 hex do token — o que é persistido e comparado no lookup. */
export function hashAccessToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Estado resolvido de um documento do ponto de vista da página pública. */
export type PublicDocState =
  | "valid" // status=sent e não expirado → mostra o formulário
  | "expired" // passou de expires_at (ou status=expired)
  | "answered" // já concluído (answered/applied)
  | "invalid"; // token não bate / doc em draft (nunca enviado)

/** Campos mínimos necessários para resolver o estado público de um documento. */
export interface PublicDocStateInput {
  status: string;
  expiresAt: Date | null;
}

/**
 * Resolve o estado público de um documento tokenizado (estudo de setup,
 * rodada de revisão de conversas, …). Função pura e testável.
 * Precedência: answered/applied vence expiração (o cliente já respondeu);
 * expiração vence o status "sent"; draft/expired/desconhecido → não navegável.
 */
export function resolvePublicDocState(
  doc: PublicDocStateInput | null | undefined,
  now: Date = new Date(),
): PublicDocState {
  if (!doc) return "invalid";
  if (doc.status === "answered" || doc.status === "applied") return "answered";
  if (doc.status === "expired") return "expired";
  if (doc.status !== "sent") return "invalid"; // draft nunca foi enviado ao cliente
  if (doc.expiresAt && doc.expiresAt.getTime() < now.getTime()) return "expired";
  return "valid";
}
