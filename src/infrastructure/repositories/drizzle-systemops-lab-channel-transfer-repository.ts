import { sql, type SQL } from "drizzle-orm";

import type {
  SystemOpsLabChannelTransferRepository,
  SystemOpsLabTransferContext,
} from "@/application/labs/systemops-lab-channel-transfer";
import {
  decryptCredentialNullable,
  encryptCredentialNullable,
} from "@/infrastructure/crypto/credential-vault";
import { db } from "@/infrastructure/db/client";

type DatabaseExecutor = {
  execute(query: SQL): PromiseLike<{ rows: unknown[] }>;
};

type TransferContextRow = {
  target_id: string | null;
  target_name: string | null;
  target_is_test: boolean | null;
  target_is_demo: boolean | null;
  target_operational_status: SystemOpsLabTransferContext["target"] extends infer Target
    ? Target extends { operationalStatus: infer Status }
      ? Status | null
      : never
    : never;
  target_auto_reply_enabled: boolean | null;
  target_shadow_mode_enabled: boolean | null;
  target_zapi_instance_id: string | null;
  source_id: string | null;
  source_name: string | null;
  source_zapi_instance_id: string | null;
  source_zapi_token: string | null;
};

export class DrizzleSystemOpsLabChannelTransferRepository
implements SystemOpsLabChannelTransferRepository {
  constructor(private readonly database: DatabaseExecutor = db) {}

  async readContext(
    instanceId: string,
    targetClinicId: string,
  ): Promise<SystemOpsLabTransferContext> {
    const result = await this.database.execute(sql`
      with target as (
        select
          id,
          name,
          is_test,
          is_demo,
          operational_status,
          auto_reply_enabled,
          shadow_mode_enabled,
          zapi_instance_id
        from organizations
        where id = ${targetClinicId}
      ), current_owner as (
        select id, name, zapi_instance_id, zapi_token
        from organizations
        where zapi_instance_id = ${instanceId}
        limit 1
      )
      select
        target.id as target_id,
        target.name as target_name,
        target.is_test as target_is_test,
        target.is_demo as target_is_demo,
        target.operational_status as target_operational_status,
        target.auto_reply_enabled as target_auto_reply_enabled,
        target.shadow_mode_enabled as target_shadow_mode_enabled,
        target.zapi_instance_id as target_zapi_instance_id,
        current_owner.id as source_id,
        current_owner.name as source_name,
        current_owner.zapi_instance_id as source_zapi_instance_id,
        current_owner.zapi_token as source_zapi_token
      from (values (1)) as seed(value)
      left join target on true
      left join current_owner on true
    `);
    const row = result.rows[0] as TransferContextRow | undefined;

    return {
      target: row?.target_id && row.target_name && row.target_operational_status
        ? {
            id: row.target_id,
            name: row.target_name,
            isTest: row.target_is_test === true,
            isDemo: row.target_is_demo === true,
            operationalStatus: row.target_operational_status,
            autoReplyEnabled: row.target_auto_reply_enabled === true,
            shadowModeEnabled: row.target_shadow_mode_enabled === true,
            zapiInstanceId: row.target_zapi_instance_id,
          }
        : null,
      source: row?.source_id && row.source_name && row.source_zapi_instance_id
        ? {
            id: row.source_id,
            name: row.source_name,
            zapiInstanceId: row.source_zapi_instance_id,
            currentPlaintextToken: decryptCredentialNullable(row.source_zapi_token),
          }
        : null,
    };
  }

  async transfer(
    input: Parameters<SystemOpsLabChannelTransferRepository["transfer"]>[0],
  ): Promise<void> {
    const expectedSourceClinicId = input.expectedSourceClinicId?.trim() || null;
    const encryptedToken = encryptCredentialNullable(input.rotatedToken);
    const encryptedClientToken = encryptCredentialNullable(input.clientToken);

    if (!encryptedToken) {
      throw new Error("Atomic Lab transfer requires a rotated credential");
    }

    let result: { rows: unknown[] };
    try {
      result = await this.database.execute(sql`
        with eligible_target as (
        select id, zapi_instance_id
        from organizations
        where id = ${input.targetClinicId}
          and is_test = true
          and is_demo = false
          and operational_status = 'test'
          and auto_reply_enabled = false
          and shadow_mode_enabled = false
          and (zapi_instance_id is null or zapi_instance_id = ${input.instanceId})
          and not exists (
            select 1 from organizations owner
            where owner.zapi_instance_id = ${input.instanceId}
              and owner.id <> ${input.targetClinicId}
              and (${expectedSourceClinicId}::uuid is null or owner.id <> ${expectedSourceClinicId}::uuid)
          )
        for update
      ), detached as (
        update organizations
        set channel_provider = null,
            zapi_instance_id = null,
            zapi_token = null,
            zapi_client_token = null,
            updated_at = now()
        where zapi_instance_id = ${input.instanceId}
          and id <> ${input.targetClinicId}
          and (${expectedSourceClinicId}::uuid is null or id = ${expectedSourceClinicId}::uuid)
          and exists (select 1 from eligible_target)
        returning id
      )
      update organizations
      set channel_provider = 'z_api',
          zapi_instance_id = ${input.instanceId},
          zapi_token = ${encryptedToken},
          zapi_client_token = ${encryptedClientToken},
          channel_paired_at = coalesce(channel_paired_at, now()),
          updated_at = now()
      where id in (select id from eligible_target)
        and (
          ${expectedSourceClinicId}::uuid is null
          or exists (
            select 1
            from detached
            where detached.id = ${expectedSourceClinicId}::uuid
          )
          or (
            id = ${expectedSourceClinicId}::uuid
            and exists (
              select 1
              from eligible_target
              where eligible_target.zapi_instance_id = ${input.instanceId}
            )
          )
        )
        returning id
      `);
    } catch {
      throw new Error("Atomic Lab transfer failed");
    }

    if (result.rows.length === 0) {
      throw new Error("Atomic Lab transfer rejected by database guard");
    }
  }

  async resolveClinicIdByInstance(instanceId: string): Promise<string | null> {
    const result = await this.database.execute(sql`
      select id
      from organizations
      where zapi_instance_id = ${instanceId}
      limit 1
    `);
    return (result.rows[0] as { id: string } | undefined)?.id ?? null;
  }
}
