import { isProxy } from "node:util/types";
import type { ConversationEnginePolicyReader } from "@/application/ports/conversation-engine-policy-reader";

export const CONVERSATION_ENGINES = [
  "v1",
  "v1_with_v2_shadow",
  "v2_internal",
] as const;

export type ConversationEngine = typeof CONVERSATION_ENGINES[number];
export type ConversationEnginePolicy = Readonly<{
  clinicId: string;
  engine: ConversationEngine;
  isTest: boolean;
}>;
export type ConversationEngineActivation = "preactivation_v1" | "internal_live_v2";
export type ConversationEngineActivationProof = Readonly<{
  clinicId: string;
  activation: ConversationEngineActivation;
}>;

const registeredActivationProofs = new WeakMap<
  object,
  Readonly<{ clinicId: string; activation: ConversationEngineActivation }>
>();

export function canonicalizeConversationEnginePolicy(
  input: unknown,
  expectedClinicId: string,
): ConversationEnginePolicy {
  if (
    typeof input !== "object"
    || input === null
    || Array.isArray(input)
    || isProxy(input)
    || Object.getPrototypeOf(input) !== Object.prototype
  ) throw new Error("invalid conversation engine policy");
  const expectedKeys = ["clinicId", "engine", "isTest"] as const;
  const keys = Reflect.ownKeys(input);
  if (
    keys.length !== expectedKeys.length
    || keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key as typeof expectedKeys[number]))
  ) throw new Error("invalid conversation engine policy");
  const source: Record<string, unknown> = {};
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new Error("invalid conversation engine policy");
    }
    source[key] = descriptor.value;
  }
  if (
    typeof expectedClinicId !== "string"
    || expectedClinicId.length === 0
    || source.clinicId !== expectedClinicId
    || typeof source.engine !== "string"
    || !(CONVERSATION_ENGINES as readonly string[]).includes(source.engine)
    || typeof source.isTest !== "boolean"
  ) throw new Error("invalid conversation engine policy");
  return Object.freeze({
    clinicId: expectedClinicId,
    engine: source.engine as ConversationEngine,
    isTest: source.isTest,
  });
}

function matchesConversationEngineActivation(
  input: unknown,
  expectedClinicId: string,
  activation: ConversationEngineActivation,
): boolean {
  const policy = canonicalizeConversationEnginePolicy(input, expectedClinicId);
  if (activation !== "preactivation_v1" && activation !== "internal_live_v2") {
    throw new Error("invalid conversation engine activation");
  }
  const expectedEngine: ConversationEngine = activation === "preactivation_v1"
    ? "v1"
    : "v2_internal";
  return policy.engine === expectedEngine;
}

export async function resolveConversationEngineActivationProof(
  reader: ConversationEnginePolicyReader,
  input: Readonly<{
    clinicId: string;
    activation: ConversationEngineActivation;
  }>,
): Promise<ConversationEngineActivationProof | null> {
  const policy = await reader.getConversationEnginePolicy(input.clinicId);
  if (!matchesConversationEngineActivation(policy, input.clinicId, input.activation)) {
    return null;
  }
  const proof = Object.freeze({
    clinicId: input.clinicId,
    activation: input.activation,
  });
  registeredActivationProofs.set(proof, proof);
  return proof;
}

export function assertConversationEngineActivationProof(
  proof: unknown,
  expected: Readonly<{
    clinicId: string;
    activation: ConversationEngineActivation;
  }>,
): asserts proof is ConversationEngineActivationProof {
  if (typeof proof !== "object" || proof === null) {
    throw new Error("conversation engine activation proof is not registered");
  }
  const binding = registeredActivationProofs.get(proof);
  if (
    !binding
    || binding.clinicId !== expected.clinicId
    || binding.activation !== expected.activation
  ) {
    throw new Error("conversation engine activation proof binding mismatch");
  }
}
