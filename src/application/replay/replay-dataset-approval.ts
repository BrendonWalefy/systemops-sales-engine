import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import {
  REPLAY_DATASET_SCHEMA_VERSION,
  type ReplayDatasetApprovalV1,
  type ReplayDatasetV2,
} from "@/application/replay/contracts";
import { stableSerialize } from "@/application/replay/fingerprint-replay-config";

const REVIEWER_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export type ApproveReplayDatasetInput = {
  dataset: ReplayDatasetV2;
  privateKeyPem: string | Buffer;
  approvedAt: Date;
  approvedBy: string;
};

export function approveReplayDataset(
  input: ApproveReplayDatasetInput,
): ReplayDatasetV2 {
  assertNeedsReviewDataset(input.dataset);
  assertReviewer(input.approvedBy);
  if (Number.isNaN(input.approvedAt.getTime())) {
    throw new Error("Replay approval timestamp is invalid");
  }

  const privateKey = createPrivateKey(input.privateKeyPem);
  assertEd25519(privateKey);
  const publicKey = createPublicKey(privateKey);
  const approvedAt = input.approvedAt.toISOString();
  const approvalWithoutSignature: Omit<ReplayDatasetApprovalV1, "signature"> = {
    algorithm: "ed25519",
    checklistVersion: "replay-privacy-review.v1",
    approvedAt,
    approvedBy: input.approvedBy,
    keyId: replayApprovalKeyId(publicKey),
    sourceDigest: sha256(stableSerialize(input.dataset)),
  };
  const unsigned: ReplayDatasetV2 = {
    ...input.dataset,
    status: "approved",
    sanitization: {
      ...input.dataset.sanitization,
      humanReviewApprovedAt: approvedAt,
    },
    approval: {
      ...approvalWithoutSignature,
      signature: "",
    },
  };
  const signature = sign(
    null,
    Buffer.from(replayApprovalPayload(unsigned), "utf8"),
    privateKey,
  ).toString("base64");

  return {
    ...unsigned,
    approval: {
      ...approvalWithoutSignature,
      signature,
    },
  };
}

export function verifyReplayDatasetApproval(
  dataset: ReplayDatasetV2,
  publicKeyPem: string | Buffer,
): void {
  assertApprovedDataset(dataset);
  const publicKey = createPublicKey(publicKeyPem);
  assertEd25519(publicKey);
  if (dataset.approval.keyId !== replayApprovalKeyId(publicKey)) {
    throw new Error("Replay dataset approval key does not match the trusted public key");
  }
  if (!SHA256_PATTERN.test(dataset.approval.sourceDigest)) {
    throw new Error("Replay dataset source digest is invalid");
  }
  const approvedAt = new Date(dataset.approval.approvedAt);
  if (
    Number.isNaN(approvedAt.getTime()) ||
    dataset.sanitization.humanReviewApprovedAt !== dataset.approval.approvedAt
  ) {
    throw new Error("Replay dataset approval timestamp is invalid or inconsistent");
  }
  assertReviewer(dataset.approval.approvedBy);

  const valid = verify(
    null,
    Buffer.from(replayApprovalPayload(dataset), "utf8"),
    publicKey,
    Buffer.from(dataset.approval.signature, "base64"),
  );
  if (!valid) {
    throw new Error("Replay dataset signature is invalid; the approved file was changed");
  }
}

export function replayApprovalPayload(dataset: ReplayDatasetV2): string {
  if (!dataset.approval) throw new Error("Replay dataset has no approval envelope");
  const approval: Omit<ReplayDatasetApprovalV1, "signature"> = {
    algorithm: dataset.approval.algorithm,
    checklistVersion: dataset.approval.checklistVersion,
    approvedAt: dataset.approval.approvedAt,
    approvedBy: dataset.approval.approvedBy,
    keyId: dataset.approval.keyId,
    sourceDigest: dataset.approval.sourceDigest,
  };
  return stableSerialize({ ...dataset, approval });
}

export function replayApprovalKeyId(publicKey: KeyObject): string {
  const der = publicKey.export({ type: "spki", format: "der" });
  return sha256(der).slice(0, 24);
}

function assertNeedsReviewDataset(dataset: ReplayDatasetV2): void {
  assertDatasetVersion(dataset);
  if (
    dataset.status !== "needs_review" ||
    dataset.approval !== null ||
    dataset.sanitization.humanReviewApprovedAt !== null
  ) {
    throw new Error("Only an untouched needs_review replay dataset can be approved");
  }
}

function assertApprovedDataset(
  dataset: ReplayDatasetV2,
): asserts dataset is ReplayDatasetV2 & { approval: ReplayDatasetApprovalV1 } {
  assertDatasetVersion(dataset);
  if (
    dataset.status !== "approved" ||
    !dataset.approval ||
    dataset.approval.algorithm !== "ed25519" ||
    dataset.approval.checklistVersion !== "replay-privacy-review.v1"
  ) {
    throw new Error("Replay dataset is not cryptographically approved");
  }
}

function assertDatasetVersion(dataset: ReplayDatasetV2): void {
  if (dataset.schemaVersion !== REPLAY_DATASET_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported replay dataset schema: ${String(dataset.schemaVersion)}`,
    );
  }
  if (
    dataset.scenarioCount !== dataset.scenarios.length ||
    dataset.scenarios.some(
      (scenario) => scenario.datasetVersion !== dataset.datasetVersion,
    )
  ) {
    throw new Error("Replay dataset manifest is inconsistent");
  }
}

function assertReviewer(value: string): void {
  if (!REVIEWER_PATTERN.test(value)) {
    throw new Error(
      "Replay reviewer must be a non-PII identifier using 2-64 lowercase letters, numbers, dot, underscore or hyphen",
    );
  }
}

function assertEd25519(key: KeyObject): void {
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("Replay approval keys must use Ed25519");
  }
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
