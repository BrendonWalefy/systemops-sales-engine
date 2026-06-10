import { db } from "@/infrastructure/db";
import { messages, conversations } from "@/infrastructure/db/schema";
import { eq, and, gte, count, desc } from "drizzle-orm";

const oneHourAgo = new Date(Date.now() - 60 * 60_000);

const rows = await db
  .select({ phone: conversations.leadPhone, total: count() })
  .from(messages)
  .innerJoin(conversations, eq(messages.conversationId, conversations.id))
  .where(
    and(
      eq(messages.author, "lead"),
      gte(messages.sentAt, oneHourAgo)
    )
  )
  .groupBy(conversations.leadPhone)
  .orderBy(desc(count()));

console.log(JSON.stringify(rows, null, 2));
process.exit(0);
