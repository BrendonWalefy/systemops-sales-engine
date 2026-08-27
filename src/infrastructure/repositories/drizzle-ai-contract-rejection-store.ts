import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type {
  AiContractRejectionIssue,
  AiContractRejectionStage,
} from "@/application/ports/ai-contract-rejection-recorder";
import { db } from "@/infrastructure/db/client";
import type {
  AiContractRejectionPersistenceInput,
  AiContractRejectionStore,
  PersistedAiContractRejectionCaptureStatus,
} from "@/infrastructure/observability/runtime-ai-contract-rejection-recorder";

type QueryResultLike = Readonly<{ rows?: readonly Record<string, unknown>[] }>;

function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (
    typeof result === "object"
    && result !== null
    && Array.isArray((result as QueryResultLike).rows)
  ) {
    return [...(result as QueryResultLike).rows!] as T[];
  }
  return [];
}

function boundedLimit(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  return Math.max(1, Math.min(Math.floor(value), fallback));
}

export type AiContractRejectionSummary = Readonly<{
  evidenceRef: string;
  turnId: string;
  stage: AiContractRejectionStage;
  modelId: string;
  promptVersion: string;
  contractVersion: string;
  attempt: number;
  issues: readonly AiContractRejectionIssue[];
  outputBytes: number;
  captureStatus: PersistedAiContractRejectionCaptureStatus | "expired";
  rawExpiresAt: Date;
  metadataExpiresAt: Date;
  createdAt: Date;
}>;

export type RevealableAiContractRejection = AiContractRejectionSummary & Readonly<{
  organizationId: string;
  inboundEventId: string;
  encryptedOutput: string | null;
}>;

export type RecordAiContractRejectionRevealAuditInput = Readonly<{
  organizationId: string;
  rejectionId: string;
  ownerSubject: string;
  accessedAt: Date;
}>;

type InsertRow = Readonly<{ id: string }>;
type SummaryRow = Readonly<{
  evidence_ref: string;
  organization_id?: string;
  inbound_event_id?: string;
  turn_id: string;
  stage: AiContractRejectionStage;
  model_id: string;
  prompt_version: string;
  contract_version: string;
  attempt: number;
  issues: readonly AiContractRejectionIssue[];
  output_bytes: number;
  capture_status: PersistedAiContractRejectionCaptureStatus | "expired";
  encrypted_output?: string | null;
  raw_expires_at: Date;
  metadata_expires_at: Date;
  created_at: Date;
}>;

function summaryFrom(row: SummaryRow): AiContractRejectionSummary {
  return Object.freeze({
    evidenceRef: row.evidence_ref,
    turnId: row.turn_id,
    stage: row.stage,
    modelId: row.model_id,
    promptVersion: row.prompt_version,
    contractVersion: row.contract_version,
    attempt: row.attempt,
    issues: Object.freeze(row.issues.map((issue) => Object.freeze({
      path: Object.freeze([...issue.path]),
      code: issue.code,
    }))),
    outputBytes: row.output_bytes,
    captureStatus: row.capture_status,
    rawExpiresAt: new Date(row.raw_expires_at),
    metadataExpiresAt: new Date(row.metadata_expires_at),
    createdAt: new Date(row.created_at),
  });
}

export class DrizzleAiContractRejectionStore
implements AiContractRejectionStore {
  async insert(
    input: AiContractRejectionPersistenceInput,
  ): Promise<Readonly<{ created: boolean; evidenceRef: string }>> {
    const inserted = rowsOf<InsertRow>(await db.execute(sql`
      insert into ai_contract_rejections (
        id,
        organization_id,
        conversation_id,
        inbound_event_id,
        turn_id,
        stage,
        model_id,
        prompt_version,
        contract_version,
        attempt,
        issues,
        output_sha256,
        output_bytes,
        capture_status,
        encrypted_output,
        raw_expires_at,
        metadata_expires_at,
        created_at
      )
      select
        ${input.rejectionId}::uuid,
        inbound.organization_id,
        stream.conversation_id,
        inbound.id,
        inbound.id::text,
        ${input.stage}::ai_contract_rejection_stage,
        ${input.modelId},
        ${input.promptVersion},
        ${input.contractVersion},
        ${input.attempt},
        ${JSON.stringify(input.issues)}::jsonb,
        ${input.outputSha256},
        ${input.outputBytes},
        ${input.captureStatus}::ai_contract_rejection_capture_status,
        ${input.encryptedOutput},
        ${input.rawExpiresAt},
        ${input.metadataExpiresAt},
        ${input.occurredAt}
      from inbound_events inbound
      inner join whatsapp_streams stream
        on stream.id = inbound.stream_id
       and stream.organization_id = inbound.organization_id
       and stream.state = 'active'
      where inbound.id = ${input.inboundEventId}::uuid
        and inbound.organization_id = ${input.organizationId}::uuid
        and inbound.id::text = ${input.turnId}
        and stream.conversation_id = ${input.conversationId}::uuid
        and inbound.stream_generation is not null
      on conflict (organization_id, turn_id, stage, output_sha256)
      do nothing
      returning id
    `));
    if (inserted[0]) {
      return { created: true, evidenceRef: inserted[0].id };
    }

    const existing = rowsOf<InsertRow>(await db.execute(sql`
      select id
      from ai_contract_rejections
      where organization_id = ${input.organizationId}::uuid
        and conversation_id = ${input.conversationId}::uuid
        and inbound_event_id = ${input.inboundEventId}::uuid
        and turn_id = ${input.turnId}
        and stage = ${input.stage}::ai_contract_rejection_stage
        and output_sha256 = ${input.outputSha256}
      limit 1
    `));
    if (!existing[0]) {
      throw new Error("AI contract rejection authority mismatch");
    }
    return { created: false, evidenceRef: existing[0].id };
  }

  async listByConversation(
    organizationId: string,
    conversationId: string,
    limit = 100,
  ): Promise<readonly AiContractRejectionSummary[]> {
    const rows = rowsOf<SummaryRow>(await db.execute(sql`
      select
        id as evidence_ref,
        turn_id,
        stage,
        model_id,
        prompt_version,
        contract_version,
        attempt,
        issues,
        output_bytes,
        capture_status,
        raw_expires_at,
        metadata_expires_at,
        created_at
      from ai_contract_rejections
      where organization_id = ${organizationId}::uuid
        and conversation_id = ${conversationId}::uuid
      order by created_at asc, id asc
      limit ${boundedLimit(limit, 100)}
    `));
    return Object.freeze(rows.map(summaryFrom));
  }

  async findRevealable(
    organizationId: string,
    rejectionId: string,
  ): Promise<RevealableAiContractRejection | null> {
    const rows = rowsOf<SummaryRow>(await db.execute(sql`
      select
        id as evidence_ref,
        organization_id,
        inbound_event_id,
        turn_id,
        stage,
        model_id,
        prompt_version,
        contract_version,
        attempt,
        issues,
        output_bytes,
        capture_status,
        encrypted_output,
        raw_expires_at,
        metadata_expires_at,
        created_at
      from ai_contract_rejections
      where organization_id = ${organizationId}::uuid
        and id = ${rejectionId}::uuid
      limit 1
    `));
    const row = rows[0];
    if (!row || !row.organization_id || !row.inbound_event_id) return null;
    return Object.freeze({
      ...summaryFrom(row),
      organizationId: row.organization_id,
      inboundEventId: row.inbound_event_id,
      encryptedOutput: row.encrypted_output ?? null,
    });
  }

  async recordRevealAudit(
    input: RecordAiContractRejectionRevealAuditInput,
  ): Promise<boolean> {
    const inserted = rowsOf<InsertRow>(await db.execute(sql`
      insert into ai_contract_rejection_access_audits (
        id,
        organization_id,
        rejection_id,
        owner_subject,
        action,
        accessed_at,
        expires_at
      )
      select
        ${randomUUID()}::uuid,
        organization_id,
        id,
        ${input.ownerSubject},
        'raw_output_revealed'::ai_contract_rejection_access_action,
        ${input.accessedAt},
        metadata_expires_at
      from ai_contract_rejections
      where organization_id = ${input.organizationId}::uuid
        and id = ${input.rejectionId}::uuid
        and metadata_expires_at > ${input.accessedAt}
      returning id
    `));
    return inserted.length === 1;
  }

  async expireRaw(now: Date, limit = 500): Promise<number> {
    const rows = rowsOf<InsertRow>(await db.execute(sql`
      with targets as (
        select id
        from ai_contract_rejections
        where encrypted_output is not null
          and raw_expires_at <= ${now}
        order by raw_expires_at asc, id asc
        limit ${boundedLimit(limit, 500)}
      )
      update ai_contract_rejections rejection
      set encrypted_output = null,
          capture_status = 'expired'
      from targets
      where rejection.id = targets.id
      returning rejection.id
    `));
    return rows.length;
  }

  async deleteExpiredMetadata(now: Date, limit = 500): Promise<number> {
    const rows = rowsOf<InsertRow>(await db.execute(sql`
      with targets as (
        select id
        from ai_contract_rejections
        where metadata_expires_at <= ${now}
        order by metadata_expires_at asc, id asc
        limit ${boundedLimit(limit, 500)}
      )
      delete from ai_contract_rejections rejection
      using targets
      where rejection.id = targets.id
      returning rejection.id
    `));
    return rows.length;
  }
}
