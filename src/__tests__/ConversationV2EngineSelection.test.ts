import { describe, expect, it } from "vitest";
import {
  CONVERSATION_ENGINES,
  assertConversationEngineActivationProof,
  canonicalizeConversationEnginePolicy,
  resolveConversationEngineActivationProof,
} from "@/application/conversation-v2/engine-selection";

describe("Conversation V2 engine configuration", () => {
  it("keeps the configured engine vocabulary closed", () => {
    expect(CONVERSATION_ENGINES).toEqual(["v1", "v1_with_v2_shadow", "v2_internal"]);
  });

  it("canonicalizes an exact tenant policy without selecting a runtime", () => {
    expect(canonicalizeConversationEnginePolicy({
      clinicId: "clinic-1", engine: "v2_internal", isTest: true,
    }, "clinic-1")).toEqual({ clinicId: "clinic-1", engine: "v2_internal", isTest: true });
    expect(() => canonicalizeConversationEnginePolicy({
      clinicId: "clinic-2", engine: "v2_internal", isTest: true,
    }, "clinic-1")).toThrow(/invalid conversation engine policy/i);
  });

  it("owns the exact V1 preactivation and V2 Internal Lab readiness contract", async () => {
    const resolve = (engine: "v1" | "v1_with_v2_shadow" | "v2_internal", activation: "preactivation_v1" | "internal_live_v2") =>
      resolveConversationEngineActivationProof({
        getConversationEnginePolicy: async () => ({
          clinicId: "clinic-1", engine, isTest: true,
        }),
      }, { clinicId: "clinic-1", activation });
    expect(await resolve("v1", "preactivation_v1")).not.toBeNull();
    expect(await resolve("v1_with_v2_shadow", "preactivation_v1")).toBeNull();
    expect(await resolve("v2_internal", "internal_live_v2")).not.toBeNull();
    expect(await resolve("v1", "internal_live_v2")).toBeNull();
    await expect(resolveConversationEngineActivationProof({
      getConversationEnginePolicy: async () => ({
        clinicId: "clinic-1", engine: "v2_internal", isTest: true,
      }),
    }, {
      clinicId: "clinic-1",
      activation: "unexpected" as never,
    })).rejects.toThrow(/invalid conversation engine activation/i);
  });

  it("issues a nominal proof bound to the exact tenant and activation", async () => {
    const reader = {
      getConversationEnginePolicy: async (clinicId: string) => ({
        clinicId,
        engine: "v1" as const,
        isTest: true,
      }),
    };
    const proof = await resolveConversationEngineActivationProof(reader, {
      clinicId: "clinic-1",
      activation: "preactivation_v1",
    });
    expect(proof).not.toBeNull();
    expect(Object.isFrozen(proof)).toBe(true);
    expect(() => assertConversationEngineActivationProof(proof, {
      clinicId: "clinic-1",
      activation: "preactivation_v1",
    })).not.toThrow();

    const clone = Object.freeze({ ...proof });
    const reflected = Reflect.construct(Object, []) as Record<PropertyKey, unknown>;
    for (const key of Reflect.ownKeys(proof!)) {
      Reflect.defineProperty(reflected, key, Object.getOwnPropertyDescriptor(proof!, key)!);
    }
    Object.freeze(reflected);
    const inherited = Object.create(proof!);
    const proxy = new Proxy(proof!, {});
    for (const forged of [clone, reflected, inherited, proxy]) {
      expect(() => assertConversationEngineActivationProof(forged, {
        clinicId: "clinic-1",
        activation: "preactivation_v1",
      })).toThrow(/activation proof/i);
    }
    expect(() => assertConversationEngineActivationProof(proof, {
      clinicId: "clinic-2",
      activation: "preactivation_v1",
    })).toThrow(/activation proof/i);
    expect(() => assertConversationEngineActivationProof(proof, {
      clinicId: "clinic-1",
      activation: "internal_live_v2",
    })).toThrow(/activation proof/i);
  });

  it("does not issue a proof when the configured engine misses the activation", async () => {
    const proof = await resolveConversationEngineActivationProof({
      getConversationEnginePolicy: async (clinicId: string) => ({
        clinicId,
        engine: "v1" as const,
        isTest: true,
      }),
    }, {
      clinicId: "clinic-1",
      activation: "internal_live_v2",
    });
    expect(proof).toBeNull();
  });
});
