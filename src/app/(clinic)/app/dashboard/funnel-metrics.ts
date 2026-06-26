export const DESKTOP_FUNNEL_VISUAL_WIDTHS = [520, 470, 420, 370, 320] as const;

export function calculateFunnelStagePercentages(values: number[]): number[] {
  if (values.length === 0) return [];

  return values.map((value, index) => {
    if (index === 0) {
      return value > 0 ? 100 : 0;
    }

    const previousValue = values[index - 1] ?? 0;
    return previousValue > 0 ? (value / previousValue) * 100 : 0;
  });
}

export function desktopFunnelVisualWidth(index: number): number {
  return DESKTOP_FUNNEL_VISUAL_WIDTHS[index] ?? DESKTOP_FUNNEL_VISUAL_WIDTHS[DESKTOP_FUNNEL_VISUAL_WIDTHS.length - 1];
}
