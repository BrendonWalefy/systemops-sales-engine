#!/usr/bin/env tsx
/**
 * Extrai as conversas da Vitalli com atividade nas últimas N horas (default 5)
 * com todas as mensagens — base para explorar cenários reais no replay.
 *
 * Uso: dotenv -e .env.local -- tsx scripts/extract-vitalli-last-hours.ts [horas]
 * Saída: vitalli-last-<N>h.json na raiz do repo.
 */
import "dotenv/config";
import { db } from "../src/infrastructure/db/client";
import { conversations, messages, leads, organizations } from "../src/infrastructure/db/schema";
import { eq, desc, and, gte } from "drizzle-orm";
import fs from "fs";

async function main() {
  const hours = Number(process.argv[2] ?? 5);
  const since = new Date(Date.now() - hours * 3600_000);

  const org = await db.query.organizations.findFirst({
    where: eq(organizations.slug, "clinica-vitalli"),
  });
  if (!org) {
    console.error("Org not found");
    process.exit(1);
  }
  console.log(`Org: ${org.name} (${org.id}) — janela: últimas ${hours}h (desde ${since.toISOString()})`);

  const convs = await db.query.conversations.findMany({
    where: and(eq(conversations.clinicId, org.id), gte(conversations.updatedAt, since)),
    orderBy: [desc(conversations.updatedAt)],
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
      aiPaused: conv.aiPaused,
      needsAttention: conv.needsAttention,
      attentionReason: conv.attentionReason,
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

  const file = `vitalli-last-${hours}h.json`;
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`Extraídas ${out.length} conversas -> ${file}`);
  console.log(`Range: ${out[out.length - 1]?.updatedAt} .. ${out[0]?.updatedAt}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
