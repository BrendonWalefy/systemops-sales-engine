import { db } from "../src/infrastructure/db/client";
import { organizations, conversations, messages } from "../src/infrastructure/db/schema";
import { desc, eq } from "drizzle-orm";

async function run() {
  const vitalli = await db.select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(eq(organizations.slug, "clinica-vitalli"))
    .limit(1);

  if (vitalli.length === 0) {
    // try fetching all organizations
    const all = await db.select({ id: organizations.id, name: organizations.name, slug: organizations.slug }).from(organizations);
    console.log("Organizations:", all);
    process.exit(0);
  }

  const clinicId = vitalli[0].id;
  console.log("Found Vitalli:", vitalli[0]);

  const recentConversations = await db.select({ id: conversations.id, category: conversations.category })
    .from(conversations)
    .where(eq(conversations.clinicId, clinicId))
    .orderBy(desc(conversations.createdAt))
    .limit(20);

  console.log(`Found ${recentConversations.length} recent conversations.`);

  for (const conv of recentConversations) {
    const convMsgs = await db.select({
      id: messages.id,
      author: messages.author,
      body: messages.body,
      sentAt: messages.sentAt,
      intent: messages.intent,
      simulated: messages.simulated
    }).from(messages)
      .where(eq(messages.conversationId, conv.id))
      .orderBy(messages.sentAt);
      
    console.log(`\nConversation ${conv.id} (Category: ${conv.category})`);
    for (const msg of convMsgs) {
      console.log(`[${msg.sentAt.toISOString()}] ${msg.author.toUpperCase()}${msg.simulated ? ' [SIMULATED]' : ''}${msg.intent ? ` (Intent: ${msg.intent})` : ''}: ${msg.body}`);
    }
  }

  process.exit(0);
}

run().catch(console.error);
