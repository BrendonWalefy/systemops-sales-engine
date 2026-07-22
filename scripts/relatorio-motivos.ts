#!/usr/bin/env tsx
/**
 * Motor de Reativação (ADR-009), Fase 1 — relatório de motivos de não-fechamento.
 *
 * Responde a pergunta que o cliente faz: "por que meus pacientes não fecharam?"
 * Lê `lead_outcomes` (preenchida pelo cron lead-outcome-classifier) e imprime,
 * por motivo, quem não fechou e o trecho da conversa que sustenta a conclusão.
 *
 * Não envia nada e não escreve no banco — é só leitura.
 *
 * Uso:
 *   npx dotenv -e .env.local -- tsx scripts/relatorio-motivos.ts <clinicId> [--dias 30]
 *   npx dotenv -e .env.local -- tsx scripts/relatorio-motivos.ts --listar
 */

import { neon } from "@neondatabase/serverless";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error(
    "DATABASE_URL não definida. Rode com: npx dotenv -e .env.local -- tsx scripts/relatorio-motivos.ts <clinicId>",
  );
  process.exit(1);
}

const sql = neon(dbUrl);

const REASON_LABELS: Record<string, string> = {
  price: "Achou caro / não cabia no orçamento",
  schedule: "Agenda / horário incompatível",
  location: "Distância ou localização",
  fear: "Medo, dor ou insegurança com o procedimento",
  third_party_decision: "Depende de outra pessoa para decidir",
  competitor: "Foi para outra clínica",
  treatment_mismatch: "Não era o tratamento certo para o caso",
  no_response: "Sumiu sem dar motivo",
  already_treated: "Já fez / já tinha resolvido",
  other: "Outro motivo",
};

const args = process.argv.slice(2);

if (args.includes("--listar")) {
  const clinicas = await sql`
    SELECT o.id, o.name, COUNT(lo.id) AS classificados
    FROM organizations o
    LEFT JOIN lead_outcomes lo ON lo.organization_id = o.id
    GROUP BY o.id, o.name
    ORDER BY o.name
  `;
  console.log("\nClínicas:\n");
  for (const c of clinicas) {
    console.log(`  ${c.id}  ${c.name}  (${c.classificados} classificados)`);
  }
  console.log();
  process.exit(0);
}

const clinicId = args.find((a) => !a.startsWith("--"));
if (!clinicId) {
  console.error(
    "Informe o id da clínica. Use --listar para ver os ids disponíveis.",
  );
  process.exit(1);
}

const diasIndex = args.indexOf("--dias");
const diasBruto =
  diasIndex >= 0 && args[diasIndex + 1] ? Number(args[diasIndex + 1]) : 30;
if (!Number.isFinite(diasBruto) || diasBruto <= 0) {
  console.error("--dias precisa ser um número positivo.");
  process.exit(1);
}
// make_interval(days => ...) espera integer.
const dias = Math.floor(diasBruto);

const [clinica] = await sql`
  SELECT name FROM organizations WHERE id = ${clinicId}
`;
if (!clinica) {
  console.error(`Clínica ${clinicId} não encontrada.`);
  process.exit(1);
}

const linhas = await sql`
  SELECT
    lo.reason,
    lo.confidence,
    lo.evidence_excerpt,
    lo.classified_at,
    l.name           AS lead_name,
    l.phone,
    l.treatment_interest,
    c.last_message_at
  FROM lead_outcomes lo
  JOIN leads l         ON l.id = lo.lead_id
  LEFT JOIN conversations c ON c.id = lo.conversation_id
  WHERE lo.organization_id = ${clinicId}
    -- COALESCE porque conversation_id é ON DELETE SET NULL: um outcome cuja
    -- conversa foi apagada continua válido e não pode sumir do relatório.
    -- make_interval evita a concatenação de texto, que quebra a inferência de
    -- tipo do parâmetro vinculado.
    AND COALESCE(c.last_message_at, lo.classified_at)
        > NOW() - make_interval(days => ${dias})
  ORDER BY lo.reason, lo.confidence DESC
`;

console.log(`\n${"=".repeat(72)}`);
console.log(`  ${clinica.name} — por que os pacientes não fecharam`);
console.log(`  Últimos ${dias} dias · ${linhas.length} leads analisados`);
console.log(`${"=".repeat(72)}\n`);

if (linhas.length === 0) {
  console.log(
    "Nenhum lead classificado nesse período.\n" +
      "Rode o cron /api/cron/lead-outcome-classifier antes (ou aguarde a execução diária).\n",
  );
  process.exit(0);
}

const porMotivo = new Map<string, typeof linhas>();
for (const linha of linhas) {
  const atual = porMotivo.get(linha.reason as string) ?? [];
  atual.push(linha);
  porMotivo.set(linha.reason as string, atual);
}

const ordenado = [...porMotivo.entries()].sort(
  (a, b) => b[1].length - a[1].length,
);

// Resumo primeiro: é o número que abre a conversa com o cliente.
console.log("RESUMO\n");
for (const [reason, grupo] of ordenado) {
  const pct = Math.round((grupo.length / linhas.length) * 100);
  const barra = "█".repeat(Math.max(1, Math.round(pct / 3)));
  console.log(
    `  ${String(grupo.length).padStart(3)} (${String(pct).padStart(2)}%) ${barra} ${REASON_LABELS[reason] ?? reason}`,
  );
}

console.log(`\n${"-".repeat(72)}\n`);

for (const [reason, grupo] of ordenado) {
  console.log(`\n### ${REASON_LABELS[reason] ?? reason} — ${grupo.length} leads\n`);

  for (const linha of grupo) {
    const nome = (linha.lead_name as string) || "(sem nome)";
    const tratamento = linha.treatment_interest
      ? ` · ${linha.treatment_interest}`
      : "";
    const confianca = Number(linha.confidence);
    const marca = confianca < 60 ? " [confirmar]" : "";

    console.log(`  • ${nome}${tratamento}${marca}`);
    if (linha.phone) console.log(`    ${linha.phone}`);
    if (linha.evidence_excerpt) {
      console.log(`    "${linha.evidence_excerpt}"`);
    }
    console.log();
  }
}

console.log(
  `${"-".repeat(72)}\n` +
    `[confirmar] = confiança abaixo de 60%; vale conferir a conversa antes de usar numa campanha.\n`,
);
