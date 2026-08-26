import type { OutboundDeliveryBoundary } from "@/application/jobs/send-message-job";

const registeredReplayCaptureBoundaries = new WeakSet<object>();

export function registerReplayCaptureBoundary<T extends object>(boundary: T): T {
  registeredReplayCaptureBoundaries.add(boundary);
  return boundary;
}

export function isRegisteredReplayCaptureBoundary(
  boundary: unknown,
): boundary is Partial<OutboundDeliveryBoundary> {
  return typeof boundary === "object"
    && boundary !== null
    && registeredReplayCaptureBoundaries.has(boundary);
}
