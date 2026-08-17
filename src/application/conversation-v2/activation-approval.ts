import { isProxy } from "node:util/types";
import { z } from "zod";
import {
  isRegisteredCycleIGateReport,
  type CycleIGateReport,
} from "@/application/conversation-v2/gate-report";
import type { HmacRef } from "@/application/conversation-v2/comparison-record";
import type { CycleIAuthorityVerifier } from "@/application/ports/cycle-i-authority-verifier";

export const INTERNAL_V2_ACTIVATION_APPROVAL_VERSION =
  "conversation-v2-internal-activation-approval.v1" as const;

declare const internalV2ActivationApprovalBrand: unique symbol;
export type InternalV2ActivationApproval = Readonly<{
  version: typeof INTERNAL_V2_ACTIVATION_APPROVAL_VERSION;
  commit: string;
  reportDigest: HmacRef;
  populationDigest: HmacRef;
  datasetDigest: HmacRef;
  configDigest: HmacRef;
  approvedAt: string;
  readonly [internalV2ActivationApprovalBrand]: true;
}>;

export type InternalV2ActivationExpected = Readonly<{
  commit: string;
  reportDigest: HmacRef;
  populationDigest: HmacRef;
  datasetDigest: HmacRef;
  configDigest: HmacRef;
}>;

const hmac = z.string().regex(/^hmac:[a-f0-9]{64}$/);
const commit = z.string().regex(/^[a-f0-9]{7,64}$/);
const isoDateTime = z.string().datetime({ offset: true });
const approvalRecordSchema = z.object({
  version: z.literal(INTERNAL_V2_ACTIVATION_APPROVAL_VERSION),
  decision: z.literal("approved"),
  approvedBy: z.literal("systemops_owner"),
  approvedAt: isoDateTime,
  commit,
  reportDigest: hmac,
  populationDigest: hmac,
  datasetDigest: hmac,
  configDigest: hmac,
  signature: hmac,
}).strict();

const approvals = new WeakSet<object>();

function snapshotPlainRecord(
  input: unknown,
  expectedKeys: readonly string[] | null,
  error: string,
): Record<string, unknown> {
  if (
    typeof input !== "object"
    || input === null
    || Array.isArray(input)
    || isProxy(input)
    || Object.getPrototypeOf(input) !== Object.prototype
  ) {
    throw new Error(error);
  }
  const keys = Reflect.ownKeys(input);
  if (
    keys.some((key) => typeof key !== "string")
    || (expectedKeys && (
      keys.length !== expectedKeys.length
      || keys.some((key) => !expectedKeys.includes(key as string))
    ))
  ) throw new Error(error);
  const snapshot: Record<string, unknown> = {};
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error(error);
    }
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

export function parseInternalV2ActivationApproval(
  report: CycleIGateReport,
  expected: InternalV2ActivationExpected,
  approvalRecord: unknown,
  verifier: CycleIAuthorityVerifier,
): InternalV2ActivationApproval {
  if (!isRegisteredCycleIGateReport(report)) {
    throw new Error("Cycle I gate report is not registered by the canonical parser");
  }
  if (
    report.decision !== "GO"
    || Object.values(report.criteria).some((criterion) => criterion.blocking && criterion.status !== "pass")
  ) {
    throw new Error("Cycle I activation gate is not fully pass");
  }

  const expectedSnapshot = snapshotPlainRecord(
    expected,
    ["commit", "reportDigest", "populationDigest", "datasetDigest", "configDigest"],
    "invalid internal V2 expected authority",
  );
  const parsed = approvalRecordSchema.parse(snapshotPlainRecord(
    approvalRecord,
    null,
    "invalid internal V2 approval record",
  ));
  const { signature, ...unsignedApproval } = parsed;
  const approvalPayload = JSON.stringify(Object.fromEntries(
    Object.entries(unsignedApproval).sort(([left], [right]) => left.localeCompare(right)),
  ));
  if (!verifier.verifyApprovalRecord(approvalPayload, signature as HmacRef)) {
    throw new Error("internal V2 approval record signature is invalid");
  }
  const exact = {
    commit: commit.parse(expectedSnapshot.commit),
    reportDigest: hmac.parse(expectedSnapshot.reportDigest) as HmacRef,
    populationDigest: hmac.parse(expectedSnapshot.populationDigest) as HmacRef,
    datasetDigest: hmac.parse(expectedSnapshot.datasetDigest) as HmacRef,
    configDigest: hmac.parse(expectedSnapshot.configDigest) as HmacRef,
  };
  for (const key of Object.keys(exact) as Array<keyof typeof exact>) {
    const reportMismatch = key === "commit"
      ? false
      : report[key as Exclude<keyof typeof exact, "commit">] !== exact[key];
    if (parsed[key] !== exact[key] || reportMismatch) {
      throw new Error(`internal V2 activation ${key} mismatch`);
    }
  }

  const approval = Object.freeze({
    version: INTERNAL_V2_ACTIVATION_APPROVAL_VERSION,
    ...exact,
    approvedAt: parsed.approvedAt,
  }) as InternalV2ActivationApproval;
  approvals.add(approval);
  return approval;
}

export function isRegisteredInternalV2ActivationApproval(
  approval: InternalV2ActivationApproval | null,
): boolean {
  return typeof approval === "object" && approval !== null && approvals.has(approval);
}
