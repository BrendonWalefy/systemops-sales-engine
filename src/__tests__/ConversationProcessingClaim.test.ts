import { describe, expect, it, vi } from "vitest";
import type {
  AcquireConversationTurnLeaseInput,
  ConversationTurnLeaseStore,
} from "@/application/ports/conversation-turn-lease-store";
import {
  CONVERSATION_TURN_LEASE_TTL_MS,
  ConversationTurnCoordinator,
} from "@/core/pipeline/ConversationTurnCoordinator";

class MemoryLeaseStore implements ConversationTurnLeaseStore {
  leaseUntil: Date | null = null;

  async tryAcquire(input: AcquireConversationTurnLeaseInput): Promise<boolean> {
    if (this.leaseUntil && this.leaseUntil >= input.now) return false;
    this.leaseUntil = input.leaseUntil;
    return true;
  }

  async release(): Promise<void> {
    this.leaseUntil = null;
  }
}

describe("ConversationTurnCoordinator", () => {
  it("concede somente um decisor ativo por conversa", async () => {
    const store = new MemoryLeaseStore();
    const now = () => new Date("2026-07-27T12:00:00.000Z");
    const first = new ConversationTurnCoordinator(store, { now, maxWaitMs: 0 });
    const second = new ConversationTurnCoordinator(store, { now, maxWaitMs: 0 });

    expect(await first.acquire("conversation-1")).toBe(true);
    expect(await second.acquire("conversation-1")).toBe(false);
  });

  it("permite que o próximo turno continue depois da liberação", async () => {
    const store = new MemoryLeaseStore();
    const coordinator = new ConversationTurnCoordinator(store, { maxWaitMs: 0 });

    expect(await coordinator.acquire("conversation-1")).toBe(true);
    await coordinator.release("conversation-1");
    expect(await coordinator.acquire("conversation-1")).toBe(true);
  });

  it("recupera conversa cujo lease expirou após crash", async () => {
    const store = new MemoryLeaseStore();
    let clock = Date.parse("2026-07-27T12:00:00.000Z");
    const coordinator = new ConversationTurnCoordinator(store, {
      now: () => new Date(clock),
      maxWaitMs: 0,
    });

    expect(await coordinator.acquire("conversation-1")).toBe(true);
    clock += CONVERSATION_TURN_LEASE_TTL_MS + 1;
    expect(await coordinator.acquire("conversation-1")).toBe(true);
  });

  it("espera de forma controlável e adquire assim que o detentor libera", async () => {
    const store = new MemoryLeaseStore();
    let clock = Date.parse("2026-07-27T12:00:00.000Z");
    store.leaseUntil = new Date(clock + 60_000);
    const sleep = vi.fn(async (durationMs: number) => {
      clock += durationMs;
      store.leaseUntil = null;
    });
    const coordinator = new ConversationTurnCoordinator(store, {
      now: () => new Date(clock),
      sleep,
      pollMs: 2_000,
      maxWaitMs: 10_000,
    });

    expect(await coordinator.acquire("conversation-1")).toBe(true);
    expect(sleep).toHaveBeenCalledOnce();
  });

  it("não transforma falha de release em retry do turno já concluído", async () => {
    const releaseError = new Error("database unavailable");
    const onReleaseError = vi.fn();
    const store: ConversationTurnLeaseStore = {
      tryAcquire: async () => true,
      release: async () => {
        throw releaseError;
      },
    };
    const coordinator = new ConversationTurnCoordinator(store, {
      onReleaseError,
    });

    await expect(coordinator.release("conversation-1")).resolves.toBeUndefined();
    expect(onReleaseError).toHaveBeenCalledWith("conversation-1", releaseError);
  });
});
