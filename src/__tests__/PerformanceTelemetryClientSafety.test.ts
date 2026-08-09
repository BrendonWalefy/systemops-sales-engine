import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/app/agenda",
}));

vi.mock("zod", () => {
  throw new Error("runtime validation reached the client performance graph");
});

describe("client performance telemetry dependencies", () => {
  it("loads the navigation reporter without the runtime validator", async () => {
    await expect(
      import("@/components/performance/navigation-performance-reporter"),
    ).resolves.toEqual(expect.objectContaining({
      NavigationPerformanceReporter: expect.any(Function),
      reportNavigationCompletion: expect.any(Function),
    }));
  });
});
