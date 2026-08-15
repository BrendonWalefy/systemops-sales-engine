import { createHmac } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { CorpusCandidate } from "@/application/corpus/candidate-stratification";
import { guessJourneyForSampling } from "@/application/corpus/candidate-stratification";
import {
  assertClinicAllowedForReplayExport,
  assertReplayOutputOutsideGitRepository,
} from "@/application/replay/replay-export-policy";
import { redactCorpusText } from "@/application/corpus/redact-corpus-text";
import { sanitizeReplayText } from "@/application/replay/sanitize-replay-text";
import { db } from "@/infrastructure/db/client";
import {
  conversations,
  leads,
  messages,
  organizations,
} from "@/infrastructure/db/schema";

/**
 * Extração de candidatos a caso de corpus.
 *
 * Duas restrições valem sobre tudo aqui:
 *
 * 1. **Só leitura.** Nenhum caminho deste arquivo escreve no banco, nem uma
 *    coluna de "já revisado". `src/__tests__/CorpusCandidateStratification.test.ts`
 *    varre este arquivo e falha se qualquer verbo de escrita aparecer.
 * 2. **Saída fora do repositório.** O bruto ainda contém texto de conversa real
 *    e a sanitização automática é primeira barreira, não aprovação. O arquivo
 *    nasce em `~/Dev/Projetos/_systemops-replay-corpus/corpus-candidates/`, com
 *    modo 0600, e só o caso rotulado e revisado entra em `evals/corpus/`.
 */

const BURST_WINDOW_MS = 60_000;
const HISTORY_TURNS = 6;
/**
 * Janela em que uma mensagem ainda conta como resposta àquele turno.
 *
 * Sem ela, um lead que nunca mais escreveu arrasta para dentro do turno toda
 * retomada enviada dias depois, e o "turno" vira um bloco impossível de julgar.
 * Duas horas cobre a resposta atrasada da recepção sem alcançar a campanha do
 * dia seguinte.
 */
const RESPONSE_WINDOW_MS = 2 * 60 * 60 * 1000;

type Arguments = {
  clinicKey: string;
  outputDirectory: string;
  conversationLimit: number;
};

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  assertClinicAllowedForReplayExport(
    args.clinicKey,
    process.env.REPLAY_EXPORT_ALLOWED_CLINICS,
  );
  const hashKey = process.env.REPLAY_EXPORT_HASH_KEY ?? "";
  if (hashKey.length < 32) {
    throw new Error("REPLAY_EXPORT_HASH_KEY must have at least 32 characters");
  }

  await mkdir(args.outputDirectory, { recursive: true, mode: 0o700 });
  const outputDirectory = await realpath(args.outputDirectory);
  await assertReplayOutputOutsideGitRepository(outputDirectory);

  const [clinic] = await db
    .select({ id: organizations.id, slug: organizations.slug })
    .from(organizations)
    .where(eq(organizations.slug, args.clinicKey))
    .limit(1);
  if (!clinic) throw new Error(`clinic "${args.clinicKey}" not found`);

  const sourceConversations = await db
    .select({ id: conversations.id, leadId: conversations.leadId })
    .from(conversations)
    .where(
      and(
        eq(conversations.clinicId, clinic.id),
        eq(conversations.category, "sales"),
      ),
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(args.conversationLimit);

  const conversationIds = sourceConversations.map((entry) => entry.id);
  if (conversationIds.length === 0) {
    throw new Error(`clinic "${args.clinicKey}" has no sales conversations`);
  }
  const leadIds = [...new Set(sourceConversations.map((entry) => entry.leadId))];

  const [messageRows, leadRows] = await Promise.all([
    db
      .select({
        id: messages.id,
        conversationId: messages.conversationId,
        author: messages.author,
        body: messages.body,
        mediaType: messages.mediaType,
        intent: messages.intent,
        sentAt: messages.sentAt,
      })
      .from(messages)
      .where(inArray(messages.conversationId, conversationIds))
      .orderBy(asc(messages.sentAt)),
    db
      .select({ id: leads.id, name: leads.name })
      .from(leads)
      .where(inArray(leads.id, leadIds)),
  ]);

  const leadNameById = new Map(leadRows.map((row) => [row.id, row.name]));
  const leadIdByConversation = new Map(
    sourceConversations.map((entry) => [entry.id, entry.leadId]),
  );
  const byConversation = new Map<string, typeof messageRows>();
  for (const row of messageRows) {
    const bucket = byConversation.get(row.conversationId) ?? [];
    bucket.push(row);
    byConversation.set(row.conversationId, bucket);
  }

  const candidates: CorpusCandidate[] = [];
  for (const [conversationId, rows] of byConversation) {
    const leadName = leadNameById.get(
      leadIdByConversation.get(conversationId) ?? "",
    ) ?? null;
    candidates.push(
      ...buildCandidates({
        conversationHash: opaqueRef(hashKey, [clinic.slug ?? "", conversationId]),
        tenantHash: opaqueRef(hashKey, [clinic.slug ?? ""]),
        leadName,
        rows,
      }),
    );
  }

  const journeyHistogram: Record<string, number> = {};
  for (const candidate of candidates) {
    const journey = guessJourneyForSampling(candidate);
    journeyHistogram[journey] = (journeyHistogram[journey] ?? 0) + 1;
  }

  const outputPath = path.join(
    outputDirectory,
    `${(clinic.slug ?? "clinic").replace(/[^a-zA-Z0-9._-]/g, "_")}.candidates.json`,
  );
  await writeFile(
    outputPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        clinicKey: clinic.slug,
        conversationCount: conversationIds.length,
        candidateCount: candidates.length,
        journeyHistogram,
        sanitization: { automated: true, humanReviewRequired: true },
        candidates,
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", mode: 0o600 },
  );

  console.log(
    JSON.stringify({
      outputPath,
      clinicKey: clinic.slug,
      conversationCount: conversationIds.length,
      candidateCount: candidates.length,
      journeyHistogram,
    }),
  );
}

type SourceRow = {
  id: string;
  author: "lead" | "clinic_user" | "agent" | "system";
  body: string;
  mediaType: "image" | "video" | "audio" | "document" | null;
  intent: string | null;
  sentAt: Date;
};

/**
 * Uma virada = a mensagem do lead mais as respostas que vieram antes da próxima
 * mensagem dele. Guarda separadamente o que a IA respondeu e o que o humano
 * respondeu, porque é o contraste entre os dois que o corpus quer medir.
 */
export function buildCandidates(params: {
  conversationHash: string;
  tenantHash: string;
  leadName: string | null;
  rows: SourceRow[];
}): CorpusCandidate[] {
  const ordered = [...params.rows]
    .filter((row) => row.author !== "system")
    .sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());

  const candidates: CorpusCandidate[] = [];
  const history: CorpusCandidate["history"] = [];

  for (let index = 0; index < ordered.length; index += 1) {
    const row = ordered[index]!;
    const authored = row.author === "lead" ? "lead" : row.author === "agent" ? "agent" : "operator";
    const text = sanitize(row, params.leadName);

    if (row.author !== "lead") {
      history.push({ author: authored, body: text });
      continue;
    }

    const untilNextLead: SourceRow[] = [];
    let previousReplyAt = row.sentAt.getTime();
    for (const reply of ordered.slice(index + 1)) {
      if (reply.author === "lead") break;
      if (reply.sentAt.getTime() - previousReplyAt > RESPONSE_WINDOW_MS) break;
      previousReplyAt = reply.sentAt.getTime();
      untilNextLead.push(reply);
    }

    const previous = ordered[index - 1];
    const isBurst = Boolean(
      previous &&
        previous.author === "lead" &&
        row.sentAt.getTime() - previous.sentAt.getTime() <= BURST_WINDOW_MS,
    );

    candidates.push({
      candidateId: `${params.conversationHash}-${index}`,
      tenantHash: params.tenantHash,
      conversationHash: params.conversationHash,
      turnIndex: index,
      capturedAt: row.sentAt.toISOString(),
      leadMessage: text,
      history: history.slice(-HISTORY_TURNS),
      aiResponse: joinReplies(untilNextLead, "agent", params.leadName),
      humanResponse: joinReplies(untilNextLead, "clinic_user", params.leadName),
      // O intent que a V1 resolveu em produção é gravado na mensagem da IA que
      // responde ao turno, nunca na mensagem do lead: 2.488 das 2.600 de agente
      // têm o campo, e nenhuma das 7.802 de lead tem. É o único registro barato
      // do que a V1 entendeu, e existe só nos turnos que a IA respondeu.
      observedIntent:
        untilNextLead.find((reply) => reply.author === "agent" && reply.intent)
          ?.intent ?? null,
      mediaKind: row.mediaType,
      isBurst,
    });

    history.push({ author: "lead", body: text });
  }

  return candidates;
}

function joinReplies(
  rows: SourceRow[],
  author: "agent" | "clinic_user",
  leadName: string | null,
): string | null {
  const parts = rows
    .filter((row) => row.author === author)
    .map((row) => sanitize(row, leadName));
  return parts.length > 0 ? parts.join("\n") : null;
}

function sanitize(row: SourceRow, leadName: string | null): string {
  // Duas barreiras, não uma. A do replay foi escrita para artefato que fica fora
  // do Git; a do corpus existe porque o caso rotulado é commitado, e cobre as
  // formas que a primeira deixou passar — nome dentro de nome de arquivo,
  // payload de Pix, UUID grudado em dígitos, domínio sem esquema.
  const sanitized = redactCorpusText(sanitizeReplayText(row.body, leadName));
  const marker = row.mediaType ? `[MIDIA:${row.mediaType.toUpperCase()}]` : "";
  return [marker, sanitized].filter(Boolean).join(" ") || "[SEM_TEXTO]";
}

function opaqueRef(key: string, parts: string[]): string {
  return createHmac("sha256", key)
    .update(parts.join(""))
    .digest("hex")
    .slice(0, 16);
}

export function parseArguments(argv: string[]): Arguments {
  const clinicKey = requiredValue(argv, "--clinic");
  const outputDirectory = requiredValue(argv, "--out-dir");
  if (!path.isAbsolute(outputDirectory)) {
    throw new Error("--out-dir must be an absolute path outside a Git repository");
  }
  const rawLimit = optionalValue(argv, "--conversations") ?? "200";
  const conversationLimit = Number(rawLimit);
  if (!Number.isInteger(conversationLimit) || conversationLimit < 1 || conversationLimit > 2000) {
    throw new Error("--conversations must be an integer between 1 and 2000");
  }
  return { clinicKey, outputDirectory, conversationLimit };
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
