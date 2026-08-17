import type {
  InternalLabRuntimeBindings,
  InternalLabRuntimeBindingsReader,
} from "@/application/conversation-v2/internal-lab-runtime-bindings";
import {
  isInternalLabApprovalAuthorized,
  type InternalLabAuthorizationBindings,
} from "@/application/conversation-v2/internal-lab-authorization";
import type { ChannelConfigSnapshot } from "@/application/ports/channel-config-snapshot";

export const INTERNAL_LAB_DELIVERY_BINDING_SCHEMA =
  "conversation-v2.internal-lab-delivery-binding.v1" as const;

export type InternalLabDeliveryBinding = InternalLabRuntimeBindings & Readonly<{
  schemaVersion: typeof INTERNAL_LAB_DELIVERY_BINDING_SCHEMA;
}>;

export const INTERNAL_LAB_DELIVERY_AUTHORIZATION_SCHEMA =
  "conversation-v2.internal-lab-delivery-authorization.v1" as const;

export type InternalLabDeliveryAuthorization = Readonly<{
  schemaVersion: typeof INTERNAL_LAB_DELIVERY_AUTHORIZATION_SCHEMA;
}>;

const registeredAuthorizations = new WeakMap<object, ChannelConfigSnapshot>();
const consumedAuthorizations = new WeakSet<object>();

export function consumeInternalLabDeliveryAuthorization(
  authorization: InternalLabDeliveryAuthorization | null | undefined,
): ChannelConfigSnapshot | null {
  if (!authorization || consumedAuthorizations.has(authorization)) return null;
  const snapshot = registeredAuthorizations.get(authorization);
  if (!snapshot) return null;
  consumedAuthorizations.add(authorization);
  return snapshot;
}

export type InternalLabDeliveryGuard = Readonly<{
  authorize(input: Readonly<{
    clinicId: string;
    binding: InternalLabDeliveryBinding;
  }>): Promise<InternalLabDeliveryAuthorization | null>;
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
      ) return null;
      try {
        const snapshot = await input.runtimeBindingsReader.resolveDeliverySnapshot?.(clinicId);
        if (!snapshot || !sameBindings(snapshot.bindings, binding)) return null;
        if (!isInternalLabApprovalAuthorized({
          ...input.authorization,
          expectedTenantDigest: snapshot.bindings.tenantDigest,
          expectedChannelDigest: snapshot.bindings.channelDigest,
          expectedConfigDigest: snapshot.bindings.configDigest,
        })) return null;
        const authorization = Object.freeze({
          schemaVersion: INTERNAL_LAB_DELIVERY_AUTHORIZATION_SCHEMA,
        });
        registeredAuthorizations.set(authorization, snapshot.channelConfig);
        return authorization;
      } catch {
        return null;
      }
    },
  });
}
