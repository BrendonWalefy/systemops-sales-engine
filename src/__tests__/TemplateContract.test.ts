import { describe, expect, it } from "vitest";
import {
  PLACEHOLDER_KINDS,
  PRICE_CHANNELS,
  CANONICAL_OWNERS,
} from "@/application/templates/contract";

describe("template contract", () => {
  it("allows exactly two placeholder kinds", () => {
    expect([...PLACEHOLDER_KINDS].sort()).toEqual(["blocking", "defaulted"]);
  });

  it("models the three price delivery channels", () => {
    expect([...PRICE_CHANNELS].sort()).toEqual(["human", "media", "text"]);
  });

  it("restricts install operations to the canonical owners", () => {
    expect([...CANONICAL_OWNERS].sort()).toEqual([
      "organizations",
      "playbook_versions",
      "treatments",
    ]);
  });
});
