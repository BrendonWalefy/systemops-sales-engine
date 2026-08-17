import {
  isRegisteredInternalLabApprovalInstance,
  type RegisteredInternalLabApproval,
} from "@/application/conversation-v2/internal-lab-approval";

export type InternalLabSyntheticRunAuthorization = Readonly<{
  runId: string;
  clinicId: string;
  tenantDigest: string;
  channelDigest: string;
}>;

type RegisteredSyntheticRun = Readonly<{
  approval: RegisteredInternalLabApproval;
  runId: string;
  clinicId: string;
  tenantDigest: string;
  channelDigest: string;
  addresses: ReadonlySet<string>;
}>;

const SYNTHETIC_PREFIX = "systemops-lab-";
const SYNTHETIC_SUFFIX = "@lid";
const MAX_SYNTHETIC_ADDRESS_LENGTH = 128;
const MAX_RUN_ID_LENGTH = 64;
const MAX_PERSONA_ID_LENGTH = 48;
const componentPattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const registeredRuns = new WeakMap<object, RegisteredSyntheticRun>();

function isClosedComponent(value: string, minimum: number, maximum: number): boolean {
  return value.length >= minimum
    && value.length <= maximum
    && componentPattern.test(value)
    && !value.includes("--");
}

function assertRunId(runId: string): void {
  if (!isClosedComponent(runId, 4, MAX_RUN_ID_LENGTH)) {
    throw new Error("Internal Lab synthetic runId has invalid charset or length");
  }
}

function assertPersonaId(personaId: string): void {
  if (!isClosedComponent(personaId, 1, MAX_PERSONA_ID_LENGTH)) {
    throw new Error("Internal Lab synthetic personaId has invalid charset or length");
  }
}

export function createInternalLabSyntheticAddress(input: {
  runId: string;
  personaId: string;
}): `${string}@lid` {
  assertRunId(input.runId);
  assertPersonaId(input.personaId);
  const address = `${SYNTHETIC_PREFIX}${input.runId}-${input.personaId}${SYNTHETIC_SUFFIX}`;
  if (address.length > MAX_SYNTHETIC_ADDRESS_LENGTH) {
    throw new Error("Internal Lab synthetic address exceeds the closed length limit");
  }
  return address as `${string}@lid`;
}

export function isInternalLabSyntheticAddress(value: string): boolean {
  if (
    typeof value !== "string"
    || value.length > MAX_SYNTHETIC_ADDRESS_LENGTH
    || !value.startsWith(SYNTHETIC_PREFIX)
    || !value.endsWith(SYNTHETIC_SUFFIX)
  ) return false;
  const body = value.slice(SYNTHETIC_PREFIX.length, -SYNTHETIC_SUFFIX.length);
  return body.length >= 6
    && componentPattern.test(body)
    && !body.includes("--")
    && body.includes("-");
}

/**
 * Reserved-prefix detection is deliberately broader than the valid parser.
 * Malformed/case-shifted Lab identities must fail closed instead of falling
 * through to a real channel adapter.
 */
export function isInternalLabSyntheticAddressCandidate(value: string): boolean {
  return typeof value === "string"
    && value.trimStart().toLowerCase().startsWith(SYNTHETIC_PREFIX);
}

function isAddressForRun(address: string, runId: string): boolean {
  if (!isInternalLabSyntheticAddress(address)) return false;
  const prefix = `${SYNTHETIC_PREFIX}${runId}-`;
  if (!address.startsWith(prefix)) return false;
  const personaId = address.slice(prefix.length, -SYNTHETIC_SUFFIX.length);
  return isClosedComponent(personaId, 1, MAX_PERSONA_ID_LENGTH);
}

export function registerInternalLabSyntheticRun(input: {
  approval: RegisteredInternalLabApproval;
  clinicId: string;
  runId: string;
  addresses: readonly string[];
}): InternalLabSyntheticRunAuthorization {
  if (!isRegisteredInternalLabApprovalInstance(input.approval, new Date(), input.clinicId)) {
    throw new Error(
      "Internal Lab synthetic run requires a current registered approval and exact clinic binding",
    );
  }
  if (
    typeof input.clinicId !== "string"
    || input.clinicId.length === 0
    || input.clinicId !== input.clinicId.trim()
    || input.clinicId.length > 128
  ) throw new Error("Internal Lab synthetic clinicId is invalid");
  assertRunId(input.runId);
  if (input.addresses.length === 0 || input.addresses.length > 64) {
    throw new Error("Internal Lab synthetic run addresses are empty or exceed the limit");
  }
  const addresses = new Set<string>();
  for (const address of input.addresses) {
    if (!isAddressForRun(address, input.runId)) {
      throw new Error("Internal Lab synthetic address does not belong to the exact run");
    }
    if (addresses.has(address)) {
      throw new Error("Internal Lab synthetic run contains a duplicate address");
    }
    addresses.add(address);
  }

  const authorization = Object.freeze({
    runId: input.runId,
    clinicId: input.clinicId,
    tenantDigest: input.approval.claims.tenantDigest,
    channelDigest: input.approval.claims.channelDigest,
  }) satisfies InternalLabSyntheticRunAuthorization;
  registeredRuns.set(authorization, Object.freeze({
    approval: input.approval,
    runId: input.runId,
    clinicId: input.clinicId,
    tenantDigest: input.approval.claims.tenantDigest,
    channelDigest: input.approval.claims.channelDigest,
    addresses: Object.freeze(addresses),
  }));
  return authorization;
}

export function isInternalLabSyntheticDeliveryAuthorized(input: Readonly<{
  authorization: InternalLabSyntheticRunAuthorization | null | undefined;
  clinicId: string;
  address: string;
  now?: Date;
}>): boolean {
  if (!input.authorization) return false;
  const registered = registeredRuns.get(input.authorization);
  if (!registered) return false;
  if (!isRegisteredInternalLabApprovalInstance(
    registered.approval,
    input.now ?? new Date(),
    registered.clinicId,
  )) {
    return false;
  }
  return input.authorization.runId === registered.runId
    && input.authorization.clinicId === registered.clinicId
    && input.authorization.tenantDigest === registered.tenantDigest
    && input.authorization.channelDigest === registered.channelDigest
    && input.clinicId === registered.clinicId
    && isAddressForRun(input.address, registered.runId)
    && registered.addresses.has(input.address);
}
