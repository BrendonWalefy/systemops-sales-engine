// ─── Régua de pós-atendimento (mensagens agendadas após a consulta) ──────────
//
// Diferente do pipeline de conversa (PipelineStep), que é REATIVO ao inbound do
// lead durante um atendimento, a régua é OUTBOUND e disparada por RELÓGIO: "X
// horas após o fim da consulta, envie esta mensagem". É config por clínica —
// cada clínica preenche as próprias regras; vazio = nada dispara. Um único cron
// genérico (post-appointment-followup) percorre as regras de todas as clínicas.
//
// Exemplos (Vitalli): cuidados pós-lentes 1h depois (texto + imagens + vídeo);
// pedido de feedback 24h depois (só se a consulta foi marcada como concluída).

export type PostAppointmentRuleCategory = "follow_up" | "operational";

export type PostAppointmentRule = {
  // Identificador ESTÁVEL da regra dentro da clínica. Entra no dedupe da outbox
  // (`postcare:{id}:{appointmentId}`) — mudar o id reenvia para quem já recebeu.
  id: string;
  label: string;
  // Horas após a âncora até o disparo (ex.: 1 = cuidados 1h depois; 24 = feedback).
  offsetHours: number;
  // De onde o offset é contado. Hoje só o fim do horário da consulta; enum aberto
  // para futuras âncoras (ex.: início) sem quebrar configs existentes.
  anchor: "appointment_end";
  // Se presente, a regra só dispara quando a consulta chegou nesse status (ex.:
  // "completed" para feedback — não pede opinião de quem não foi atendido).
  // Ausente = dispara por relógio, pulando apenas cancelado/no-show.
  requiresStatus?: "completed";
  // Filtro por tratamento (ex.: cuidados só para lentes). Ausente/null = todos.
  treatmentIds?: string[] | null;
  // Conteúdo DETERMINÍSTICO (instruções de cuidado não podem ser parafraseadas
  // pela LLM). Placeholders suportados: {nome} (primeiro nome do lead), {clinica}.
  message: string;
  // Anexos (mediaIds da biblioteca da clínica). Resolvidos contra media_assets no
  // disparo; ids inválidos/de outra clínica são omitidos.
  mediaIds?: string[];
  // Gate do Channel Safety Engine. follow_up é sujeito a opt-out/quiet hours;
  // operational é sempre entregue (avisos transacionais).
  category: PostAppointmentRuleCategory;
};

// Substitui os placeholders do template. Determinístico — sem LLM.
export function renderPostAppointmentMessage(
  template: string,
  vars: { leadName: string | null; clinicName: string },
): string {
  const firstName = vars.leadName?.trim().split(/\s+/)[0] ?? "";
  return template
    .replace(/\{nome\}/g, firstName)
    .replace(/\{clinica\}/g, vars.clinicName)
    .replace(/\s+([,.!?])/g, "$1") // "Oi , tudo?" → "Oi, tudo?" quando não há nome
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

// Chave de dedupe determinística por (regra, consulta). A outbox é única em
// (conversationId, dedupeKey), então o mesmo disparo nunca sai duas vezes mesmo
// com o cron reescaneando a janela de catch-up.
export function postAppointmentDedupeKey(ruleId: string, appointmentId: string): string {
  return `postcare:${ruleId}:${appointmentId}`;
}
