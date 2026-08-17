import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@/infrastructure/db/client", () => ({ db: dbMock }));

import { ConversationStateMachine } from "@/core/conversation/ConversationStateMachine";

describe("ConversationStateMachine.invalidateIfCurrent", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns true only when the single conditional insert consumes the expected current state", async () => {
    dbMock.execute.mockResolvedValueOnce({ rows: [{ id: "idle-state" }] });
    await expect(new ConversationStateMachine().invalidateIfCurrent(
      "conversation-1",
      "offer-state-1",
    )).resolves.toBe(true);
    expect(dbMock.execute).toHaveBeenCalledOnce();
  });

  it("returns false when a newer state makes the conditional insert a no-op", async () => {
    dbMock.execute.mockResolvedValueOnce({ rows: [] });
    await expect(new ConversationStateMachine().invalidateIfCurrent(
      "conversation-1",
      "stale-offer-state",
    )).resolves.toBe(false);
    expect(dbMock.execute).toHaveBeenCalledOnce();
  });
});
