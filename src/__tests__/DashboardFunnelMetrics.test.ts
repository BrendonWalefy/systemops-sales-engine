import { describe, expect, it } from "vitest";
import {
  DESKTOP_FUNNEL_VISUAL_WIDTHS,
  calculateFunnelStagePercentages,
  desktopFunnelVisualWidth,
} from "../app/(clinic)/app/dashboard/funnel-metrics";

describe("dashboard funnel metrics", () => {
  it("keeps the first stage at 100% and converts each next stage from the previous one", () => {
    expect(calculateFunnelStagePercentages([8, 7, 4, 2, 1])).toEqual([100, 87.5, 57.14285714285714, 50, 50]);
  });

  it("returns zero when the previous stage has no volume", () => {
    expect(calculateFunnelStagePercentages([8, 0, 3, 0])).toEqual([100, 0, 0, 0]);
  });

  it("uses the last desktop width as fallback for extra stages", () => {
    expect(desktopFunnelVisualWidth(0)).toBe(DESKTOP_FUNNEL_VISUAL_WIDTHS[0]);
    expect(desktopFunnelVisualWidth(4)).toBe(DESKTOP_FUNNEL_VISUAL_WIDTHS[4]);
    expect(desktopFunnelVisualWidth(9)).toBe(DESKTOP_FUNNEL_VISUAL_WIDTHS[4]);
  });
});
