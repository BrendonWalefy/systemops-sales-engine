import { describe, expect, it } from "vitest";
import {
  digestInboundClaimToken,
  generateInboundClaimToken,
} from "@/application/jobs/inbound-claim-token";

describe("WhatsApp durable stream claim", () => {
  it("generates an opaque 32-byte base64url token", () => {
    const first = generateInboundClaimToken();
    const second = generateInboundClaimToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(first);
  });

  it("digests a claim token deterministically with SHA-256 base64url", () => {
    expect(digestInboundClaimToken("claim-token-for-test")).toBe(
      "9v3icKOXuENeCVhnLzO3-nnu1e5D5wBTs5OTiw8HXR8",
    );
    expect(digestInboundClaimToken("claim-token-for-test")).toHaveLength(43);
  });
});
