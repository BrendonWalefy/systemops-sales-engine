"use client";

export type HapticIntent = "light" | "medium" | "success";

const HAPTIC_PATTERNS: Record<HapticIntent, number | number[]> = {
  light: 8,
  medium: 14,
  success: [10, 40, 16],
};

export function haptic(intent: HapticIntent = "light"): void {
  if (typeof window === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  if (!("vibrate" in navigator)) return;

  navigator.vibrate(HAPTIC_PATTERNS[intent]);
}
