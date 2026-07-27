import { AsyncLocalStorage } from "node:async_hooks";

export type RuntimeClock = { now(): Date };

const storage = new AsyncLocalStorage<RuntimeClock>();

export function runtimeNow(): Date {
  return storage.getStore()?.now() ?? new Date();
}

export function runWithRuntimeClock<T>(clock: RuntimeClock, operation: () => T): T {
  return storage.run(clock, operation);
}
