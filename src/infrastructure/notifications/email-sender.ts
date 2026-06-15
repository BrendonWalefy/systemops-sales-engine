import { Resend } from "resend";

export type EmailPayload = {
  to: string;
  subject: string;
  html: string;
};

export type EmailResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

// Envia via Resend quando RESEND_API_KEY está definida; caso contrário, loga
// no console para não bloquear ambientes de desenvolvimento ou CI.
export async function sendEmail(payload: EmailPayload): Promise<EmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL ?? "SystemOps <noreply@systemops.app>";

  if (!apiKey) {
    console.log(
      `[email-sender] RESEND_API_KEY não definida — email não enviado.\n` +
        `Para: ${payload.to}\nAssunto: ${payload.subject}`,
    );
    return { ok: true, id: "console-fallback" };
  }

  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
  });

  if (error) {
    console.error("[email-sender] Falha ao enviar via Resend:", error);
    return { ok: false, error: error.message };
  }

  return { ok: true, id: data!.id };
}
