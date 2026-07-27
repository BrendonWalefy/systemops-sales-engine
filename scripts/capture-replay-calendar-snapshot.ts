import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { REPLAY_CALENDAR_SNAPSHOT_SCHEMA_VERSION } from "../src/application/replay/contracts";
import { loadReplayClinicManifest } from "../src/application/replay/load-replay-clinic-manifest";
import { signReplayCalendarSnapshot } from "../src/application/replay/replay-calendar-snapshot";
import { assertReplayOutputOutsideGitRepository } from "../src/application/replay/replay-export-policy";
import { ClinicTimezone } from "../src/core/scheduling/ClinicTimezone";
import { resolveCalendarGateway } from "../src/infrastructure/adapters/calendar/resolve-calendar-gateway";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await assertReplayOutputOutsideGitRepository(args.output);
  const manifest = await loadReplayClinicManifest(args.clinic);
  const from = new Date(args.from);
  const to = new Date(args.to);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to) {
    throw new Error("--from/--to must define a valid increasing ISO interval");
  }
  const gateway = resolveCalendarGateway({
    clinicId: manifest.clinic.id,
    calendarMode: manifest.clinic.calendarMode,
    googleCalendarId: manifest.clinic.googleCalendarId,
    timezone: new ClinicTimezone(manifest.clinic.timezone),
    businessHours: manifest.clinic.businessHours,
    postAppointmentBufferMinutes: manifest.clinic.postAppointmentBufferMinutes,
  });
  const durations = [...new Set(
    manifest.clinicTreatments.map((treatment) => treatment.durationMinutes),
  )].sort((left, right) => left - right);
  const availability = await Promise.all(durations.map(async (slotDurationMinutes) => ({
    slotDurationMinutes,
    professionalId: null,
    slots: (await gateway.listAvailableSlots({
      clinicId: manifest.clinic.id,
      from,
      to,
      slotDurationMinutes,
    })).map((slot) => ({
      startsAt: slot.startsAt.toISOString(),
      endsAt: slot.endsAt.toISOString(),
      professionalId: slot.professionalId,
      source: slot.source,
    })),
  })));
  const blocks = (await gateway.listBlockEvents({
    clinicId: manifest.clinic.id,
    from,
    to,
  })).map((block, index) => ({
    // Nunca exporta o ID real do provedor; apenas um ref local estável.
    calendarEventId: `snapshot-block-${index + 1}`,
    startsAt: block.startsAt.toISOString(),
    endsAt: block.endsAt.toISOString(),
    reason: block.reason,
  }));
  const privateKey = await readFile(args.privateKey, "utf8");
  const snapshot = signReplayCalendarSnapshot({
    schemaVersion: REPLAY_CALENDAR_SNAPSHOT_SCHEMA_VERSION,
    clinicKey: manifest.clinic.slug!,
    configFingerprint: manifest.configFingerprint,
    capturedAt: new Date().toISOString(),
    range: { from: from.toISOString(), to: to.toISOString(), timezone: manifest.clinic.timezone },
    availability,
    blocks,
  }, privateKey);
  await writeFile(args.output, `${JSON.stringify(snapshot, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  console.log(JSON.stringify({
    output: args.output,
    clinicKey: snapshot.clinicKey,
    durationCount: availability.length,
    slotCount: availability.reduce((total, entry) => total + entry.slots.length, 0),
    blockCount: blocks.length,
    keyId: snapshot.approval.keyId,
  }));
}

function parseArgs(values: string[]) {
  const read = (name: string) => {
    const index = values.indexOf(name);
    return index >= 0 ? values[index + 1] : undefined;
  };
  const clinic = read("--clinic");
  const from = read("--from");
  const to = read("--to");
  const privateKey = read("--private-key");
  const output = read("--output");
  if (!clinic || !from || !to || !privateKey || !output) {
    throw new Error(
      "Usage: --clinic <slug> --from <ISO> --to <ISO> --private-key <pem> --output <json>",
    );
  }
  return {
    clinic,
    from,
    to,
    privateKey: path.resolve(privateKey),
    output: path.resolve(output),
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
