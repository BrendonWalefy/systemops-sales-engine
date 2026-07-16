#!/usr/bin/env tsx
/**
 * Extrai as últimas 30 conversas da Vitalli com todas as mensagens
 * (lead, clinic_user/operador, agent/IA — incluindo flag simulated)
 * para análise comparativa operador vs IA.
 */
import "dotenv/config";
import { db } from "../src/infrastructure/db/client";
import { conversations, messages, leads, organizations } from "../src/infrastructure/db/schema";
import { eq, desc } from "drizzle-orm";
import fs from "fs";

async function main() {
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.slug, "clinica-vitalli"),
  });
  if (!org) {
    console.error("Org not found");
    process.exit(1);
  }
  console.log(`Org: ${org.name} (${org.id})`);

  const convs = await db.query.conversations.findMany({
    where: eq(conversations.clinicId, org.id),
    orderBy: [desc(conversations.updatedAt)],
    limit: 30,
  });

  const out: Array<Record<string, unknown>> = [];

  for (const conv of convs) {
    const lead = await db.query.leads.findFirst({
      where: eq(leads.id, conv.leadId),
      columns: { name: true, phone: true },
    });

    const msgs = await db.query.messages.findMany({
      where: eq(messages.conversationId, conv.id),
      orderBy: [messages.sentAt],
    });

    out.push({
      conversationId: conv.id,
      leadName: lead?.name ?? "Unknown",
      leadPhone: lead?.phone ?? null,
      category: conv.category,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      messages: msgs.map((m) => ({
        author: m.author,
        body: m.body,
        intent: m.intent,
        simulated: m.simulated,
        mediaType: m.mediaType,
        deliveryFormat: m.deliveryFormat,
        sentAt: m.sentAt,
      })),
    });
  }

  fs.writeFileSync(
    "/tmp/vitalli-last-30.json",
    JSON.stringify(out, null, 2),
  );

  console.log(`Extraídas ${out.length} conversas -> /tmp/vitalli-last-30.json`);
  console.log(`Range: ${out[out.length - 1]?.updatedAt} .. ${out[0]?.updatedAt}`);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
