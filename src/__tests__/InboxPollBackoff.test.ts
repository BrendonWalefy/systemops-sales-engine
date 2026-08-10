import { describe, expect, it } from "vitest";
import { nextPollDelayMs } from "@/app/(clinic)/app/inbox/poll-schedule";

describe("inbox poll backoff", () => {
  it("starts inside the 15-30s window from the spec", () => {
    expect(nextPollDelayMs(0)).toBe(15_000);
  });

  it("backs off toward 60s while nothing changes", () => {
    expect(nextPollDelayMs(1)).toBe(30_000);
    expect(nextPollDelayMs(2)).toBe(60_000);
  });

  it("caps at 60s and never exceeds it", () => {
    expect(nextPollDelayMs(50)).toBe(60_000);
    expect(nextPollDelayMs(Number.MAX_SAFE_INTEGER)).toBe(60_000);
  });

  it("never decreases as the unchanged streak grows", () => {
    const ladder = [0, 1, 2, 3, 10].map(nextPollDelayMs);
    const sorted = [...ladder].sort((a, b) => a - b);
    expect(ladder).toEqual(sorted);
  });

  it("treats a negative counter as the floor rather than throwing", () => {
    expect(nextPollDelayMs(-1)).toBe(15_000);
  });
});
