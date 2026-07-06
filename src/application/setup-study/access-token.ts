/**
 * Token de acesso da página pública de validação (ADR-002 Fase 2, apêndice G).
 *
 * O banco guarda **apenas** o sha256 do token (`setup_studies.access_token_hash`).
 * O token cru é exibido ao owner uma única vez na geração (padrão de API key) e
 * viaja só no link enviado ao responsável da clínica. A resolução do estudo na
 * rota pública é feita exclusivamente pelo hash — o `clinicId` nunca aparece na
 * URL nem no payload.
 *
 * Espaço de 256 bits torna brute-force inviável → rate limit dispensado na v1
 * (decisão registrada no ADR-G).
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

/** Estado resolvido de um estudo do ponto de vista da página pública. */
export type PublicStudyState =
  | "valid" // status=sent e não expirado → mostra o formulário
  | "expired" // passou de expires_at (ou status=expired)
  | "answered" // já concluído (answered/applied)
  | "invalid"; // token não bate / estudo em draft (nunca enviado)

/** Campos mínimos necessários para resolver o estado público de um estudo. */
export interface StudyStateInput {
  status: string;
  expiresAt: Date | null;
}

/**
 * Resolve o estado público de um estudo. Função pura e testável.
 * Precedência: answered/applied vence expiração (o cliente já respondeu);
 * expiração vence o status "sent"; draft/expired/desconhecido → não navegável.
 */
export function resolveStudyState(
  study: StudyStateInput | null | undefined,
  now: Date = new Date(),
): PublicStudyState {
  if (!study) return "invalid";
  if (study.status === "answered" || study.status === "applied") return "answered";
  if (study.status === "expired") return "expired";
  if (study.status !== "sent") return "invalid"; // draft nunca foi enviado ao cliente
  if (study.expiresAt && study.expiresAt.getTime() < now.getTime()) return "expired";
  return "valid";
}
