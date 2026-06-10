import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

const rows = await sql`
  SELECT r.phone, r.label, r.enabled,
         s.name as source_clinic, t.name as target_clinic
  FROM whatsapp_qa_routes r
  JOIN clinics s ON r.source_clinic_id = s.id
  JOIN clinics t ON r.target_clinic_id = t.id
  ORDER BY r.created_at DESC
`;

for (const r of rows) {
  const status = r.enabled ? "✅" : "❌";
  console.log(`${status} phone: ${r.phone} | label: "${r.label}" | ${r.source_clinic} → ${r.target_clinic}`);
}

await sql.end();
