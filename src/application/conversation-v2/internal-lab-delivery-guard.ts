import type {
  InternalLabRuntimeBindings,
  InternalLabRuntimeBindingsReader,
} from "@/application/conversation-v2/internal-lab-runtime-bindings";
import {
  isInternalLabApprovalAuthorized,
  type InternalLabAuthorizationBindings,
} from "@/application/conversation-v2/internal-lab-authorization";

export const INTERNAL_LAB_DELIVERY_BINDING_SCHEMA =
  "conversation-v2.internal-lab-delivery-binding.v1" as const;

export type InternalLabDeliveryBinding = InternalLabRuntimeBindings & Readonly<{
  schemaVersion: typeof INTERNAL_LAB_DELIVERY_BINDING_SCHEMA;
}>;

export type InternalLabDeliveryGuard = Readonly<{
  authorize(input: Readonly<{
    clinicId: string;
    binding: InternalLabDeliveryBinding;
  }>): Promise<boolean>;
}>;

function sameBindings(
  left: InternalLabRuntimeBindings,
  right: InternalLabRuntimeBindings,
): boolean {
  return left.tenantDigest === right.tenantDigest
    && left.channelDigest === right.channelDigest
    && left.configDigest === right.configDigest;
}

export function createInternalLabDeliveryGuard(input: Readonly<{
  authorization: InternalLabAuthorizationBindings;
  runtimeBindingsReader: InternalLabRuntimeBindingsReader;
}>): InternalLabDeliveryGuard {
  return Object.freeze({
    async authorize({ clinicId, binding }) {
      if (
        binding.schemaVersion !== INTERNAL_LAB_DELIVERY_BINDING_SCHEMA
        || clinicId !== input.authorization.expectedClinicId
      ) return false;
      try {
        const current = await input.runtimeBindingsReader.resolve(clinicId);
        if (!sameBindings(current, binding)) return false;
        return isInternalLabApprovalAuthorized({
          ...input.authorization,
          expectedTenantDigest: current.tenantDigest,
          expectedChannelDigest: current.channelDigest,
          expectedConfigDigest: current.configDigest,
        });
      } catch {
        return false;
      }
    },
  });
}
