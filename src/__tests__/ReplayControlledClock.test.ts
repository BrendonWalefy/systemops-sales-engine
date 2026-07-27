import { describe, expect, it } from "vitest";
import { runWithRuntimeClock, runtimeNow } from "@/core/time/RuntimeClock";

describe("replay controlled clock", () => {
  it("preserva o relógio lógico em toda a cadeia assíncrona e o isola", async () => {
    const fixed = new Date("2026-07-27T09:15:00.000Z");
    await runWithRuntimeClock({ now: () => new Date(fixed) }, async () => {
      await Promise.resolve();
      expect(runtimeNow()).toEqual(fixed);
    });
    expect(runtimeNow().getTime()).not.toBe(fixed.getTime());
  });
});
