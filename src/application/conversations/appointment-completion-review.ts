/**
 * Confirmação de atendimento realizado, pelo WhatsApp do doutor.
 *
 * O bloqueio medido: **nenhuma consulta da Aurora chega a `completed`** — 43
 * `scheduled`, zero concluídas. Sem isso, a regra de feedback de 24h nunca
 * dispara e o painel não contabiliza faturamento. O lembrete de fim de dia já
 * existe e já é entregue (8 envios, último em 20/07), mas só lista os pendentes
 * e manda abrir o painel. Confirmar exige sair do WhatsApp — e não acontece.
 *
 * O código é derivado do HORÁRIO (`C0830`), não de um índice sequencial. Índice
 * mudaria de significado a cada confirmação: o doutor confirma "C2" às 21h e
 * marca a consulta errada porque "C1" já saiu da lista. O horário é estável, já
 * está escrito na mensagem e é o que ele reconhece.
 */

export type AppointmentCompletionAction = "completed" | "no_show";

export type PendingCompletionAppointment = {
  id: string;
  /** Horário local já formatado, "08:30". */
  time: string;
  leadName: string;
};

export type ParsedAppointmentCompletionReply =
  | { kind: "all" }
  | { kind: "single"; timeCode: string; action: AppointmentCompletionAction };

const CONFIRM_ALL_BUTTON_ID = "appointment-done:all";
const MISS_BUTTON_PREFIX = "appointment-miss:";

// O WhatsApp renderizou 5 botões no teste de 21/07. Medido nas agendas reais:
// em 37 dias com atendimento, nenhum passou de 5 consultas (Aurora p50=2,
// máx=5). Com "Todos compareceram" fixo sobram 4 nomes — cobre todos os dias
// observados, e o excedente cai no código textual sem perder o toque único.
const MAX_NAME_BUTTONS = 4;

/** "08:30" → "0830". O que o doutor digita não tem os dois-pontos. */
export function toTimeCode(time: string): string {
  return time.replace(/\D/g, "");
}

/**
 * Botões da confirmação.
 *
 * O padrão do dia é "todos compareceram" — então o botão de nome marca a
 * EXCEÇÃO, não a regra. Rotular só com o nome ("08:30 Angelucia") não dizia o
 * que o toque faria: confirma? abre? cancela? O ❌ na frente resolve isso no
 * relance, e o dia normal continua a um toque.
 */
export function buildAppointmentCompletionButtons(
  pending: PendingCompletionAppointment[],
): { id: string; label: string }[] {
  return [
    { id: CONFIRM_ALL_BUTTON_ID, label: "✅ Todos compareceram" },
    ...pending.slice(0, MAX_NAME_BUTTONS).map((a) => ({
      id: `${MISS_BUTTON_PREFIX}${toTimeCode(a.time)}`,
      label: `❌ ${a.time} ${a.leadName}`,
    })),
  ];
}

export function parseAppointmentCompletionReply(
  text: string,
): ParsedAppointmentCompletionReply | null {
  const normalized = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (normalized === CONFIRM_ALL_BUTTON_ID || normalized === "c todos") return { kind: "all" };

  // Botão de exceção: o toque num nome significa "essa faltou".
  const buttonMiss = normalized.match(/^appointment-miss:(\d{4})$/);
  if (buttonMiss) return { kind: "single", timeCode: buttonMiss[1], action: "no_show" };

  // "c0830", "c 0830", "c0830 2", "c 08:30 2"
  const match = normalized.match(/^c\s*(\d{1,2}):?(\d{2})\s*([12])?$/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;

  return {
    kind: "single",
    timeCode: `${String(hour).padStart(2, "0")}${String(minute).padStart(2, "0")}`,
    action: match[3] === "2" ? "no_show" : "completed",
  };
}

/** "c" ou "c08" sozinhos: começou a digitar e parou — merece ajuda, não silêncio. */
export function isMalformedAppointmentCompletionReply(text: string): boolean {
  const trimmed = text.trim();
  return /^c$/i.test(trimmed) || /^c\s*\d{1,3}$/i.test(trimmed);
}

export function buildAppointmentCompletionInvalidReplyMessage(): string {
  return "Não entendi. Responda com o horário da consulta, ex: *C0830* (realizado) ou *C0830 2* (faltou).";
}

/**
 * Agenda de amanhã — informação pura, sem botão.
 *
 * Vai separada da confirmação de propósito. São propósitos diferentes: esta o
 * doutor lê e segue; a outra exige resposta. Juntas, a ação pendente ficava
 * enterrada sob uma lista já lida — e a mensagem de ação precisa ser a última do
 * chat, que é onde ele olha.
 */
export function buildTomorrowAgendaMessage(params: {
  clinicName: string;
  tomorrow: { time: string; leadName: string }[];
}): string | null {
  const { clinicName, tomorrow } = params;
  if (tomorrow.length === 0) return null;
  return [
    `📅 *Amanhã · ${clinicName}* — ${tomorrow.length} atendimento${tomorrow.length !== 1 ? "s" : ""}`,
    ...tomorrow.map((a) => `• ${a.time} ${a.leadName}`),
  ].join("\n");
}

/**
 * Confirmação dos atendimentos de hoje — a única mensagem que cobra ação.
 *
 * Devolve null sem pendências: buzinar à toa treina o doutor a ignorar.
 *
 * Acima de `MAX_NAME_BUTTONS` os excedentes não viram botão, então a lista
 * textual sempre traz o código de cada um. O "Todos compareceram" continua
 * valendo para o dia inteiro, independente de quantos couberam em botão.
 */
export function buildPendingConfirmationMessage(params: {
  pending: PendingCompletionAppointment[];
}): string | null {
  const { pending } = params;
  if (pending.length === 0) return null;

  const excedentes = pending.slice(MAX_NAME_BUTTONS);
  const linhas = pending.map((a) =>
    excedentes.includes(a)
      ? `• ${a.time} ${a.leadName} — *C${toTimeCode(a.time)}*`
      : `• ${a.time} ${a.leadName}`,
  );

  const rodape = excedentes.length > 0
    ? `Alguém faltou? Toque no nome ou responda o código, ex: *C${toTimeCode(excedentes[0].time)}*`
    : "Alguém faltou? Toque no nome.";

  return [
    `⏳ *Confirmar atendimentos de hoje* — ${pending.length} pendente${pending.length !== 1 ? "s" : ""}`,
    ...linhas,
    "",
    rodape,
  ].join("\n");
}

/**
 * Resposta após marcar uma falta.
 *
 * Não-comparecimento não é fim de linha: é um lead que voltou ao funil. Remarcar
 * pelo botão seria promessa vazia (não dá para escolher data num botão), então a
 * falta vira gatilho de recuperação — que é onde está a receita.
 */
export function buildNoShowFollowUpMessage(leadName: string): string {
  return `${leadName} marcada como falta. Quer que eu chame para remarcar?`;
}

export function buildNoShowFollowUpButtons(timeCode: string): { id: string; label: string }[] {
  return [
    { id: `appointment-recover:${timeCode}:yes`, label: "Sim, chamar" },
    { id: `appointment-recover:${timeCode}:no`, label: "Deixa comigo" },
  ];
}

export function parseNoShowFollowUpReply(
  text: string,
): { timeCode: string; recover: boolean } | null {
  const match = text.trim().toLowerCase().match(/^appointment-recover:(\d{4}):(yes|no)$/);
  if (!match) return null;
  return { timeCode: match[1], recover: match[2] === "yes" };
}
