import type { HmacRef } from "@/application/conversation-v2/comparison-record";

export type CycleIAuthorityVerifier = Readonly<{
  verifyGateReport(payload: string, digest: HmacRef): boolean;
  verifyApprovalRecord(payload: string, signature: HmacRef): boolean;
}>;
