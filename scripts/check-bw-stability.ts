import "dotenv/config";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL nao definido");
  process.exit(1);
}

const sql = postgres(connectionString, { max: 1 });

const BW_CLINIC_ID = "5a2ce07d-cfa1-4108-9a3c-3d1fae017067";
const BW_SLUG = "bw-odontologia";
const hoursArg = Number(process.argv[2] ?? "48");
const windowHours = Number.isFinite(hoursArg) && hoursArg > 0 ? hoursArg : 48;

function fmt(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function section(title: string): void {
  console.log(`\n${"=".repeat(72)}\n${title}\n${"=".repeat(72)}`);
}

async function main() {
  console.log(`BW estabilidade — janela de ${windowHours}h`);

  const autoConversationExact = await sql`
    SELECT
      m2.conversation_id,
      m1.sent_at AS agent_sent_at,
      m2.sent_at AS echoed_at,
      LEFT(m1.body, 80) AS body
    FROM messages m1
    JOIN messages m2
      ON m2.conversation_id = m1.conversation_id
     AND m1.author = 'agent'
     AND m2.author = 'lead'
     AND m2.body = m1.body
     AND m2.sent_at BETWEEN m1.sent_at AND m1.sent_at + INTERVAL '10 seconds'
    JOIN conversations c ON c.id = m1.conversation_id
    WHERE c.clinic_id = ${BW_CLINIC_ID}
      AND m1.sent_at > NOW() - (${windowHours} * INTERVAL '1 hour')
    ORDER BY m1.sent_at DESC
  `;

  const autoConversationPrefix = await sql`
    SELECT
      m2.conversation_id,
      m1.sent_at AS agent_sent_at,
      m2.sent_at AS echoed_at,
      LEFT(m2.body, 80) AS body
    FROM messages m1
    JOIN messages m2
      ON m2.conversation_id = m1.conversation_id
     AND m1.author = 'agent'
     AND m2.author = 'lead'
     AND LENGTH(m2.body) >= 20
     AND LEFT(m1.body, LENGTH(m2.body)) = m2.body
     AND m2.sent_at BETWEEN m1.sent_at AND m1.sent_at + INTERVAL '10 seconds'
    JOIN conversations c ON c.id = m1.conversation_id
    WHERE c.clinic_id = ${BW_CLINIC_ID}
      AND m1.sent_at > NOW() - (${windowHours} * INTERVAL '1 hour')
    ORDER BY m1.sent_at DESC
  `;

  const followUpFlood = await sql`
    SELECT
      lead_id,
      DATE(completed_at) AS day,
      COUNT(*)::int AS total
    FROM follow_ups
    WHERE clinic_id = ${BW_CLINIC_ID}
      AND status = 'done'
      AND completed_at > NOW() - (${windowHours} * INTERVAL '1 hour')
    GROUP BY 1, 2
    HAVING COUNT(*) > 1
    ORDER BY day DESC, total DESC
  `;

  const clinicHealth = await sql`
    SELECT
      cl.slug,
      cl.auto_reply_enabled,
      MAX(m.sent_at) FILTER (WHERE m.author = 'lead') AS last_lead,
      MAX(m.sent_at) FILTER (WHERE m.author = 'agent') AS last_agent
    FROM clinics cl
    LEFT JOIN conversations cv ON cv.clinic_id = cl.id
    LEFT JOIN messages m ON m.conversation_id = cv.id
    WHERE cl.id = ${BW_CLINIC_ID}
    GROUP BY cl.slug, cl.auto_reply_enabled
  `;

  const recentFollowUps = await sql`
    SELECT
      f.status,
      f.reason,
      f.created_at,
      f.completed_at,
      l.name,
      l.phone
    FROM follow_ups f
    JOIN leads l ON l.id = f.lead_id
    WHERE f.clinic_id = ${BW_CLINIC_ID}
      AND f.created_at > NOW() - (${windowHours} * INTERVAL '1 hour')
    ORDER BY f.created_at DESC
    LIMIT 20
  `;

  section("Health da clinica");
  const health = clinicHealth[0];
  if (!health) {
    console.log(`Clinica ${BW_SLUG} nao encontrada.`);
  } else {
    console.log(`slug: ${health.slug}`);
    console.log(`autoReplyEnabled: ${health.auto_reply_enabled}`);
    console.log(`ultima inbound lead: ${fmt(health.last_lead as string | null)}`);
    console.log(`ultima outbound agent: ${fmt(health.last_agent as string | null)}`);
  }

  section("Auto-conversa — match exato");
  console.log(`casos: ${autoConversationExact.length}`);
  for (const row of autoConversationExact.slice(0, 10)) {
    console.log(
      `- conv=${row.conversation_id} | agent=${fmt(row.agent_sent_at as string)} | echo=${fmt(row.echoed_at as string)} | ${row.body}`,
    );
  }

  section("Auto-conversa — match por prefixo");
  console.log(`casos: ${autoConversationPrefix.length}`);
  for (const row of autoConversationPrefix.slice(0, 10)) {
    console.log(
      `- conv=${row.conversation_id} | agent=${fmt(row.agent_sent_at as string)} | echo=${fmt(row.echoed_at as string)} | ${row.body}`,
    );
  }

  section("Flood de follow-up");
  console.log(`casos: ${followUpFlood.length}`);
  for (const row of followUpFlood) {
    console.log(`- lead=${row.lead_id} | dia=${row.day} | total=${row.total}`);
  }

  section("Follow-ups recentes");
  if (recentFollowUps.length === 0) {
    console.log("nenhum follow-up recente na janela");
  } else {
    for (const row of recentFollowUps) {
      console.log(
        `- ${row.status.padEnd(10)} | ${fmt(row.created_at as string)} | ${row.name ?? "sem nome"} | ${row.phone ?? "sem telefone"} | ${row.reason}`,
      );
    }
  }
}

main()
  .then(() => sql.end())
  .catch(async (err) => {
    console.error("Falha ao checar estabilidade da BW:", err);
    await sql.end();
    process.exit(1);
  });
