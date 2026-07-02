// Redação de PII em eventos do Sentry. Módulo PURO (browser + server), sem
// dependências de runtime — importado pelas três configs de init.
//
// Defesa em profundidade: além de `sendDefaultPii: false`, aqui removemos
// cookies e cabeçalhos sensíveis e redigimos telefone/CPF/e-mail que possam ter
// vazado para mensagens, exceptions, breadcrumbs, URL ou extras. Stack frames
// NÃO são tocados, para preservar a fidelidade do rastreamento.
import type { ErrorEvent } from "@sentry/nextjs";

const REDACTIONS: Array<[RegExp, string]> = [
  // CPF: 000.000.000-00 ou 00000000000
  [/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[cpf]"],
  // Telefone BR (com/sem +55, DDD, 8-9 dígitos)
  [/\b(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, "[phone]"],
  // E-mail
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]"],
];

export function redactPii(input: string): string {
  let out = input;
  for (const [re, tag] of REDACTIONS) out = out.replace(re, tag);
  return out;
}

const SENSITIVE_HEADERS = ["cookie", "authorization", "x-api-key", "proxy-authorization"];

export function scrubEvent(event: ErrorEvent): ErrorEvent {
  // 1) Nunca envie usuário identificável.
  delete event.user;

  // 2) Requisição: remove cookies e cabeçalhos sensíveis; redige URL/query.
  if (event.request) {
    delete event.request.cookies;
    const headers = event.request.headers;
    if (headers) {
      for (const key of Object.keys(headers)) {
        if (SENSITIVE_HEADERS.includes(key.toLowerCase())) delete headers[key];
      }
    }
    if (typeof event.request.url === "string") event.request.url = redactPii(event.request.url);
    if (typeof event.request.query_string === "string") {
      event.request.query_string = redactPii(event.request.query_string);
    }
  }

  // 3) Mensagem principal.
  if (typeof event.message === "string") event.message = redactPii(event.message);

  // 4) Valores das exceptions (a mensagem do erro, não o stack).
  for (const ex of event.exception?.values ?? []) {
    if (typeof ex.value === "string") ex.value = redactPii(ex.value);
  }

  // 5) Breadcrumbs.
  for (const crumb of event.breadcrumbs ?? []) {
    if (typeof crumb.message === "string") crumb.message = redactPii(crumb.message);
  }

  // 6) Extras (nível 1) — redige strings.
  if (event.extra) {
    for (const [key, value] of Object.entries(event.extra)) {
      if (typeof value === "string") event.extra[key] = redactPii(value);
    }
  }

  return event;
}
