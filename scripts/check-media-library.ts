import "dotenv/config";
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
const CLINIC_ID = "5a2ce07d-cfa1-4108-9a3c-3d1fae017067";

const rows = await sql`
  SELECT id, name, status,
         jsonb_array_length(COALESCE(media_library, '[]'::jsonb)) as media_count,
         media_library
  FROM playbook_versions
  WHERE clinic_id = ${CLINIC_ID}
  ORDER BY created_at DESC
  LIMIT 5
`;

for (const r of rows) {
  console.log(`\n"${r.name}" [${r.status}] — ${r.media_count} item(s) de mídia`);
  if (r.media_library && Array.isArray(r.media_library) && r.media_library.length > 0) {
    for (const m of r.media_library as { type: string; id: string; title: string; url?: string }[]) {
      console.log(`  • [${m.type}] id="${m.id}" title="${m.title}"`);
      console.log(`    url: ${m.url ? m.url.slice(0, 90) + "..." : "❌ VAZIO"}`);
    }
  } else {
    console.log("  ❌ mediaLibrary vazia");
  }
}

await sql.end();
