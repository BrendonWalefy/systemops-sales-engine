// Dump READ-ONLY do estado atual da Vitalli: treatments (preços/quantityPrices/
// bookingWindows/status), biblioteca de mídia e playbook ativo. Nada é escrito.
import "dotenv/config";
import postgres from "postgres";

const CLINIC_ID = "d24a584a-faac-4a46-9750-a718d0f8e686";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

  const org = await sql`
    SELECT name, shadow_mode_enabled, auto_reply_enabled, deposit_enabled,
           deposit_amount_cents, deposit_confirmation_notes, address, greeting_message
    FROM organizations WHERE id = ${CLINIC_ID}
  `;
  console.log("=== ORG ===");
  console.log(JSON.stringify(org[0], null, 2));

  const treats = await sql`
    SELECT name, price_cents, price_kind, price_unit, price_quotable_in_chat, duration_minutes,
           quantity_prices, booking_windows, requires_evaluation_first, keyword_match_enabled,
           aliases, description IS NOT NULL AS has_description, pipeline_steps IS NOT NULL AS has_pipeline
    FROM treatments WHERE organization_id = ${CLINIC_ID} ORDER BY name
  `;
  console.log(`\n=== TREATMENTS (${treats.length}) ===`);
  for (const t of treats) {
    console.log(
      `- ${t.name} | preço=${t.price_cents}(${t.price_kind}${t.price_unit ? "/" + t.price_unit : ""}) | cotável=${t.price_quotable_in_chat} | dur=${t.duration_minutes}min | kw=${t.keyword_match_enabled} | desc=${t.has_description} | pipe=${t.has_pipeline}` +
        (t.quantity_prices ? ` | qty=${JSON.stringify(t.quantity_prices)}` : "") +
        (t.booking_windows ? ` | janelas=${JSON.stringify(t.booking_windows)}` : "") +
        ` | avaliação1º=${t.requires_evaluation_first} | aliases=${JSON.stringify(t.aliases)}`,
    );
  }

  const media = await sql`
    SELECT m.id, m.title, m.type, m.treatment_id, t.name AS treatment_name, m.url
    FROM media_assets m LEFT JOIN treatments t ON t.id = m.treatment_id
    WHERE m.organization_id = ${CLINIC_ID} ORDER BY m.created_at
  `;
  console.log(`\n=== MEDIA_ASSETS (${media.length}) ===`);
  for (const m of media) {
    console.log(`- [${m.type}] "${m.title}" → ${m.treatment_name ?? "GERAL"} (${m.id})`);
    console.log(`  ${m.url.slice(0, 100)}`);
  }

  const pv = await sql`
    SELECT id, name, status, media_asset_ids,
           length(notes) AS notes_len, length(commercial_policy) AS policy_len,
           receptionist_name, jsonb_array_length(objections) AS n_objections
    FROM playbook_versions WHERE organization_id = ${CLINIC_ID}
    ORDER BY created_at DESC LIMIT 6
  `;
  console.log(`\n=== PLAYBOOK VERSIONS ===`);
  for (const p of pv) {
    console.log(
      `- "${p.name}" [${p.status}] recep=${p.receptionist_name} | mídias autorizadas=${JSON.stringify(p.media_asset_ids)} | notes=${p.notes_len}ch policy=${p.policy_len}ch objections=${p.n_objections}`,
    );
  }

  const active = await sql`
    SELECT notes, procedure_description, commercial_policy FROM playbook_versions
    WHERE organization_id = ${CLINIC_ID} AND status = 'active' LIMIT 1
  `;
  if (active[0]) {
    console.log("\n=== NOTES (playbook ativo) ===");
    console.log(active[0].notes);
    console.log("\n=== PROCEDURE DESCRIPTION ===");
    console.log(active[0].procedure_description);
    console.log("\n=== POLÍTICA COMERCIAL ATIVA ===");
    console.log(active[0].commercial_policy);
  }

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
