import { db } from "../src/infrastructure/db/client";
import { sql } from "drizzle-orm";
import * as fs from "fs";

async function extractCases(clinicId: string, limit: number): Promise<{ name: string; source: string; messages: string[] }[]> {
  const result = await db.execute(sql`
    SELECT c.lead_id, m.author, m.body, m.sent_at
    FROM messages m
    JOIN conversations c ON m.conversation_id = c.id
    WHERE c.organization_id = ${clinicId}
      AND m.sent_at > NOW() - INTERVAL '90 days'
    ORDER BY c.lead_id, m.sent_at
  `);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (result as any).rows || result;

  // Agrupar por lead_id
  const byLead: Record<string, { author: string; body: string }[]> = {};
  for (const row of rows) {
    if (!byLead[row.lead_id]) byLead[row.lead_id] = [];
    byLead[row.lead_id].push({ author: row.author, body: row.body });
  }

  const cases: { name: string; source: string; messages: string[] }[] = [];
  
  for (const [leadId, msgs] of Object.entries(byLead)) {
    // Pegar sequencias do lead.
    const leadMessages = msgs.filter(m => m.author === "lead").map(m => m.body);
    if (leadMessages.length > 0 && leadMessages.length <= 5) {
      cases.push({
        name: `Caso real ${leadId.substring(0, 6)}`,
        source: `Lead ${leadId} (${leadMessages.length} msgs)`,
        messages: leadMessages,
      });
    }
    if (cases.length >= limit) break;
  }
  
  return cases;
}

async function main() {
  const ximendesId = 'c9137774-e783-4461-ac2b-e2f01be739a6';
  const vitalliId = 'd24a584a-faac-4a46-9750-a718d0f8e686';
  
  const ximendesCases = await extractCases(ximendesId, 50);
  const vitalliCases = await extractCases(vitalliId, 50);
  
  fs.writeFileSync('ximendes_cases.json', JSON.stringify(ximendesCases, null, 2));
  fs.writeFileSync('vitalli_cases.json', JSON.stringify(vitalliCases, null, 2));
  
  console.log(`Saved ${ximendesCases.length} Ximendes cases.`);
  console.log(`Saved ${vitalliCases.length} Vitalli cases.`);
  process.exit(0);
}

main();
