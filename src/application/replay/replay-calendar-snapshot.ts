import {
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import type { CalendarGateway } from "@/application/ports/calendar-gateway";
import {
  REPLAY_CALENDAR_SNAPSHOT_SCHEMA_VERSION,
  type ReplayCalendarSnapshotV1,
} from "@/application/replay/contracts";
import { fingerprintReplayConfig, stableSerialize } from "@/application/replay/fingerprint-replay-config";

type UnsignedCalendarSnapshot = Omit<ReplayCalendarSnapshotV1, "approval">;

export function signReplayCalendarSnapshot(
  snapshot: UnsignedCalendarSnapshot,
  privateKeyPem: string | Buffer,
): ReplayCalendarSnapshotV1 {
  assertSnapshotShape(snapshot);
  const privateKey = createPrivateKey(privateKeyPem);
  assertEd25519(privateKey);
  const publicKey = createPublicKey(privateKey);
  const envelope = {
    algorithm: "ed25519" as const,
    keyId: fingerprintReplayConfig(
      publicKey.export({ type: "spki", format: "der" }),
    ).slice(0, 24),
    signature: "",
  };
  const signature = sign(
    null,
    Buffer.from(stableSerialize({ ...snapshot, approval: envelope }), "utf8"),
    privateKey,
  ).toString("base64");
  return { ...snapshot, approval: { ...envelope, signature } };
}

export function verifyReplayCalendarSnapshot(
  snapshot: ReplayCalendarSnapshotV1,
  publicKeyPem: string | Buffer,
  expected: { clinicKey: string; configFingerprint: string },
): void {
  assertSnapshotShape(snapshot);
  if (snapshot.clinicKey !== expected.clinicKey) {
    throw new Error("Calendar snapshot belongs to another clinic");
  }
  if (snapshot.configFingerprint !== expected.configFingerprint) {
    throw new Error("Calendar snapshot configuration fingerprint does not match");
  }
  const publicKey = createPublicKey(publicKeyPem);
  assertEd25519(publicKey);
  const keyId = fingerprintReplayConfig(
    publicKey.export({ type: "spki", format: "der" }),
  ).slice(0, 24);
  if (snapshot.approval.keyId !== keyId) {
    throw new Error("Calendar snapshot key does not match trusted key");
  }
  const unsignedEnvelope = { ...snapshot.approval, signature: "" };
  const valid = verify(
    null,
    Buffer.from(
      stableSerialize({ ...snapshot, approval: unsignedEnvelope }),
      "utf8",
    ),
    publicKey,
    Buffer.from(snapshot.approval.signature, "base64"),
  );
  if (!valid) throw new Error("Calendar snapshot signature is invalid");
}

export class ReplayCalendarSnapshotGateway implements CalendarGateway {
  constructor(private readonly snapshot: ReplayCalendarSnapshotV1) {}

  async listAvailableSlots(input: Parameters<CalendarGateway["listAvailableSlots"]>[0]) {
    const snapshotFrom = new Date(this.snapshot.range.from);
    const snapshotTo = new Date(this.snapshot.range.to);
    if (input.from < snapshotFrom || input.to > snapshotTo) {
      throw new Error("calendar_snapshot_range_exceeded");
    }
    const availability = this.snapshot.availability.find(
      (entry) =>
        entry.slotDurationMinutes === input.slotDurationMinutes &&
        (entry.professionalId ?? null) === (input.professionalId ?? null),
    );
    if (!availability) {
      throw new Error(
        `calendar_snapshot_query_missing: duration=${input.slotDurationMinutes}, professional=${input.professionalId ?? "any"}`,
      );
    }
    return availability.slots
      .map((slot, index) => ({
        ...slot,
        id: `replay-slot-${availability.slotDurationMinutes}-${index}`,
        clinicId: input.clinicId,
        startsAt: new Date(slot.startsAt),
        endsAt: new Date(slot.endsAt),
      }))
      .filter((slot) => slot.startsAt >= input.from && slot.endsAt <= input.to);
  }

  async listBlockEvents(input: Parameters<CalendarGateway["listBlockEvents"]>[0]) {
    return this.snapshot.blocks
      .map((block) => ({
        ...block,
        startsAt: new Date(block.startsAt),
        endsAt: new Date(block.endsAt),
      }))
      .filter((block) => block.startsAt < input.to && block.endsAt > input.from);
  }

  async isSlotFree(input: Parameters<CalendarGateway["isSlotFree"]>[0]) {
    return !this.snapshot.blocks.some(
      (block) => new Date(block.startsAt) < input.endsAt && new Date(block.endsAt) > input.startsAt,
    );
  }

  createAppointment = forbiddenWrite("createAppointment");
  cancelAppointment = forbiddenWrite("cancelAppointment");
  updateCalendarEvent = forbiddenWrite("updateCalendarEvent");
  createBlockEvent = forbiddenWrite("createBlockEvent");
  deleteBlockEvent = forbiddenWrite("deleteBlockEvent");
  updateBlockEvent = forbiddenWrite("updateBlockEvent");
}

function forbiddenWrite(operation: string) {
  return async () => {
    throw new Error(`Replay snapshot cannot execute calendar write: ${operation}`);
  };
}

function assertSnapshotShape(snapshot: Partial<ReplayCalendarSnapshotV1>): void {
  if (
    snapshot.schemaVersion !== REPLAY_CALENDAR_SNAPSHOT_SCHEMA_VERSION ||
    !snapshot.clinicKey ||
    !/^[a-f0-9]{64}$/.test(snapshot.configFingerprint ?? "") ||
    !snapshot.range ||
    !Array.isArray(snapshot.availability) ||
    !Array.isArray(snapshot.blocks) ||
    ("approval" in snapshot &&
      (!snapshot.approval ||
        snapshot.approval.algorithm !== "ed25519" ||
        !snapshot.approval.keyId ||
        !snapshot.approval.signature))
  ) {
    throw new Error("Invalid replay calendar snapshot");
  }
}

function assertEd25519(key: KeyObject): void {
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("Replay calendar snapshot keys must use Ed25519");
  }
}
