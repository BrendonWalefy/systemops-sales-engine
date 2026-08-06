import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  REPLAY_CALENDAR_SNAPSHOT_SCHEMA_VERSION,
  type ReplayCalendarSnapshotV1,
} from "@/application/replay/contracts";
import {
  ReplayCalendarSnapshotGateway,
  signReplayCalendarSnapshot,
  verifyReplayCalendarSnapshot,
} from "@/application/replay/replay-calendar-snapshot";

const keyPair = generateKeyPairSync("ed25519");
const privatePem = keyPair.privateKey.export({ type: "pkcs8", format: "pem" });
const publicPem = keyPair.publicKey.export({ type: "spki", format: "pem" });

function signedSnapshot(): ReplayCalendarSnapshotV1 {
  return signReplayCalendarSnapshot({
    schemaVersion: REPLAY_CALENDAR_SNAPSHOT_SCHEMA_VERSION,
    clinicKey: "horizonte",
    configFingerprint: "a".repeat(64),
    capturedAt: "2026-07-27T08:00:00.000Z",
    range: {
      from: "2026-07-27T00:00:00.000Z",
      to: "2026-08-10T00:00:00.000Z",
      timezone: "America/Sao_Paulo",
    },
    availability: [{
      slotDurationMinutes: 60,
      professionalId: null,
      slots: [{
        startsAt: "2026-07-28T12:00:00.000Z",
        endsAt: "2026-07-28T13:00:00.000Z",
        professionalId: null,
        source: "google_calendar",
      }],
    }],
    blocks: [],
  }, privatePem);
}

describe("signed replay calendar snapshot", () => {
  it("verifica assinatura, clínica e fingerprint", () => {
    expect(() => verifyReplayCalendarSnapshot(signedSnapshot(), publicPem, {
      clinicKey: "horizonte",
      configFingerprint: "a".repeat(64),
    })).not.toThrow();
  });

  it("detecta qualquer alteração no calendário assinado", () => {
    const snapshot = signedSnapshot();
    snapshot.availability[0]!.slots[0]!.startsAt = "2026-07-28T13:00:00.000Z";
    expect(() => verifyReplayCalendarSnapshot(snapshot, publicPem, {
      clinicKey: "horizonte",
      configFingerprint: "a".repeat(64),
    })).toThrow("signature is invalid");
  });

  it("serve somente consultas cobertas pela fotografia", async () => {
    const gateway = new ReplayCalendarSnapshotGateway(signedSnapshot());
    const slots = await gateway.listAvailableSlots({
      clinicId: "clinic-sandbox",
      from: new Date("2026-07-27T00:00:00.000Z"),
      to: new Date("2026-07-29T00:00:00.000Z"),
      slotDurationMinutes: 60,
    });
    expect(slots).toEqual([
      expect.objectContaining({
        clinicId: "clinic-sandbox",
        startsAt: new Date("2026-07-28T12:00:00.000Z"),
      }),
    ]);
    await expect(gateway.listAvailableSlots({
      clinicId: "clinic-sandbox",
      from: new Date("2026-07-27T00:00:00.000Z"),
      to: new Date("2026-07-29T00:00:00.000Z"),
      slotDurationMinutes: 30,
    })).rejects.toThrow("calendar_snapshot_query_missing");
  });
});
