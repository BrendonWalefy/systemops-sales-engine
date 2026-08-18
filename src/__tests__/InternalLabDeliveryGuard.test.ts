import { describe, expect, it, vi } from "vitest";
vi.mock("@/application/conversation-v2/internal-lab-authorization", () => ({
  isInternalLabApprovalAuthorized: vi.fn(() => true),
}));
import {
  consumeInternalLabDeliveryAuthorization,
  createInternalLabDeliveryGuard,
} from "@/application/conversation-v2/internal-lab-delivery-guard";
import type { ChannelConfigSnapshot } from "@/application/ports/channel-config-snapshot";

const clinicId = "clinic-lab";
const bindings = Object.freeze({
  tenantDigest: `sha256:${"1".repeat(64)}`,
  channelDigest: `sha256:${"2".repeat(64)}`,
  configDigest: `sha256:${"3".repeat(64)}`,
});

describe("Internal Lab delivery authorization", () => {
  it("consumes once the exact approved channel snapshot even if the source changes later", async () => {
    const approvedConfig = Object.freeze({
      provider: "z_api" as const,
      zapi: Object.freeze({ instanceId: "approved", token: "approved-token" }),
      meta: null,
    });
    const changedConfig = Object.freeze({
      provider: "z_api" as const,
      zapi: Object.freeze({ instanceId: "changed", token: "changed-token" }),
      meta: null,
    });
    let currentConfig: ChannelConfigSnapshot = approvedConfig;
    const resolveDeliverySnapshot = vi.fn(async () => ({
        bindings: {
          ...bindings,
        },
        channelConfig: currentConfig,
      }));
    const guard = createInternalLabDeliveryGuard({
      authorization: {
        approval: null,
        runtimeIdentity: null,
        expectedClinicId: clinicId,
        expectedTenantDigest: bindings.tenantDigest,
        expectedChannelDigest: bindings.channelDigest,
        expectedConfigDigest: bindings.configDigest,
        now: () => new Date("2026-08-17T15:00:00.000Z"),
      },
      runtimeBindingsReader: {
        resolve: vi.fn(),
        resolveDeliverySnapshot,
      },
    });

    const authorization = await guard.authorize({
      clinicId,
      binding: {
        schemaVersion: "conversation-v2.internal-lab-delivery-binding.v1",
        ...bindings,
      },
    });

    expect(authorization).not.toBeNull();
    currentConfig = changedConfig;
    expect(JSON.stringify(authorization)).not.toContain("approved-token");
    expect(consumeInternalLabDeliveryAuthorization(authorization)).toBe(approvedConfig);
    expect(consumeInternalLabDeliveryAuthorization(authorization)).toBeNull();
    expect(consumeInternalLabDeliveryAuthorization({
      schemaVersion: "conversation-v2.internal-lab-delivery-authorization.v1",
    })).toBeNull();
    expect(resolveDeliverySnapshot).toHaveBeenCalledOnce();
  });
});
