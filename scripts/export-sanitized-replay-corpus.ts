import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { buildSanitizedReplayCorpus } from "@/application/replay/build-sanitized-replay-corpus";
import { loadReplayClinicManifest } from "@/application/replay/load-replay-clinic-manifest";
import {
  assertClinicAllowedForReplayExport,
  assertReplayOutputOutsideGitRepository,
} from "@/application/replay/replay-export-policy";
import { db } from "@/infrastructure/db/client";
import {
  conversations,
  leads,
  messages,
} from "@/infrastructure/db/schema";

type Arguments = {
  clinicKey: string;
  datasetVersion: string;
  outputDirectory: string;
  limit: number;
};

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  assertClinicAllowedForReplayExport(
    args.clinicKey,
    process.env.REPLAY_EXPORT_ALLOWED_CLINICS,
  );
  const sourceHashKey = process.env.REPLAY_EXPORT_HASH_KEY ?? "";
  if (sourceHashKey.length < 32) {
    throw new Error("REPLAY_EXPORT_HASH_KEY must have at least 32 characters");
  }

  await mkdir(args.outputDirectory, { recursive: true, mode: 0o700 });
  const outputDirectory = await realpath(args.outputDirectory);
  await assertReplayOutputOutsideGitRepository(outputDirectory);

  const {
    clinic,
    configFingerprint,
    playbookFingerprint,
  } = await loadReplayClinicManifest(args.clinicKey);
  assertClinicAllowedForReplayExport(
    clinic.slug,
    process.env.REPLAY_EXPORT_ALLOWED_CLINICS,
  );

  const sourceConversations = await db
    .select({
      id: conversations.id,
      leadId: conversations.leadId,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.clinicId, clinic.id),
        eq(conversations.category, "sales"),
      ),
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(args.limit);

  const conversationIds = sourceConversations.map((conversation) => conversation.id);
  const leadIds = [...new Set(sourceConversations.map((conversation) => conversation.leadId))];
  const [messageRows, leadRows] = await Promise.all([
    conversationIds.length
      ? db
          .select({
            id: messages.id,
            conversationId: messages.conversationId,
            author: messages.author,
            body: messages.body,
            mediaType: messages.mediaType,
            sentAt: messages.sentAt,
          })
          .from(messages)
          .where(inArray(messages.conversationId, conversationIds))
          .orderBy(asc(messages.sentAt))
      : Promise.resolve([]),
    leadIds.length
      ? db
          .select({ id: leads.id, name: leads.name })
          .from(leads)
          .where(inArray(leads.id, leadIds))
      : Promise.resolve([]),
  ]);

  const leadNameById = new Map(leadRows.map((lead) => [lead.id, lead.name]));
  const messagesByConversation = new Map<string, typeof messageRows>();
  for (const message of messageRows) {
    const entries = messagesByConversation.get(message.conversationId) ?? [];
    entries.push(message);
    messagesByConversation.set(message.conversationId, entries);
  }

  const dataset = buildSanitizedReplayCorpus({
    datasetVersion: args.datasetVersion,
    generatedAt: new Date(),
    clinicKey: clinic.slug,
    timezone: clinic.timezone,
    configFingerprint,
    playbookFingerprint,
    sourceHashKey,
    conversations: sourceConversations.map((conversation) => ({
      sourceId: conversation.id,
      leadName: leadNameById.get(conversation.leadId) ?? null,
      messages: (messagesByConversation.get(conversation.id) ?? []).map((message) => ({
        sourceId: message.id,
        author:
          message.author === "clinic_user"
            ? "operator"
            : message.author,
        body: message.body,
        mediaType: message.mediaType,
        sentAt: message.sentAt,
      })),
    })),
  });

  const safeClinicKey = clinic.slug.replace(/[^a-zA-Z0-9._-]/g, "_");
  const safeVersion = args.datasetVersion.replace(/[^a-zA-Z0-9._-]/g, "_");
  const outputPath = path.join(
    outputDirectory,
    `${safeClinicKey}.${safeVersion}.needs-review.json`,
  );
  await writeFile(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  console.log(JSON.stringify({
    outputPath,
    clinicKey: clinic.slug,
    datasetVersion: args.datasetVersion,
    scenarioCount: dataset.scenarioCount,
    status: dataset.status,
  }));
}

export function parseArguments(argv: string[]): Arguments {
  const clinicKey = requiredValue(argv, "--clinic");
  const datasetVersion = requiredValue(argv, "--dataset-version");
  const outputDirectory = requiredValue(argv, "--out-dir");
  if (!path.isAbsolute(outputDirectory)) {
    throw new Error("--out-dir must be an absolute path outside a Git repository");
  }
  const rawLimit = optionalValue(argv, "--limit") ?? "50";
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("--limit must be an integer between 1 and 100");
  }
  return { clinicKey, datasetVersion, outputDirectory, limit };
}

function requiredValue(argv: string[], flag: string): string {
  const value = optionalValue(argv, flag);
  if (!value) throw new Error(`${flag} is required`);
  return value;
}

function optionalValue(argv: string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  return index >= 0 ? (argv[index + 1] ?? null) : null;
}

if (process.env.VITEST !== "true") {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
