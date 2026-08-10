import {
  PERFORMANCE_SURFACES,
  createSoftNavigationSample,
  normalizePerformanceRoute,
  type PerformanceSample,
  type PerformanceSurface,
} from "@/application/observability/performance-contract";

export const NAVIGATION_MARK_KEY = "systemops.performance.pending-navigation.v1";
export const NAVIGATION_COUNT_KEY = "systemops.performance.sample-count.v1";

export const MAX_NAVIGATION_DURATION_MS = 120_000;

export type PendingNavigation = {
  surface: PerformanceSurface;
  startedAt: number;
};

export type NavigationStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type NavigationTimingDeps = {
  storage: NavigationStorage;
  now(): number;
};

type CompletedNavigation = {
  nextPending: null;
  sample: PerformanceSample | null;
};

function normalizeRoute(raw: string): PerformanceSurface | null {
  try {
    return normalizePerformanceRoute(raw);
  } catch {
    return null;
  }
}

export function markNavigationStart(
  _currentPending: PendingNavigation | null,
  targetRoute: string,
  now: number,
): PendingNavigation | null {
  const surface = normalizeRoute(targetRoute);
  if (!surface || !Number.isFinite(now)) return null;

  return { surface, startedAt: now };
}

export function completeNavigation(
  pending: PendingNavigation | null,
  currentRoute: string,
  now: number,
): CompletedNavigation {
  const surface = normalizeRoute(currentRoute);
  const durationMs = pending ? now - pending.startedAt : Number.NaN;

  if (
    !pending
    || surface !== pending.surface
    || !Number.isFinite(durationMs)
    || durationMs < 0
    || durationMs > MAX_NAVIGATION_DURATION_MS
  ) {
    return { nextPending: null, sample: null };
  }

  return {
    nextPending: null,
    sample: createSoftNavigationSample(surface, durationMs),
  };
}

function parsePendingNavigation(serialized: string | null): PendingNavigation | null {
  if (!serialized) return null;

  try {
    const value: unknown = JSON.parse(serialized);
    if (!value || typeof value !== "object") return null;
    const candidate = value as Record<string, unknown>;
    if (
      Object.keys(candidate).length !== 2
      || typeof candidate.surface !== "string"
      || typeof candidate.startedAt !== "number"
    ) {
      return null;
    }

    const surface = PERFORMANCE_SURFACES.find((allowed) => allowed === candidate.surface);
    if (!surface || !Number.isFinite(candidate.startedAt)) {
      return null;
    }

    return { surface, startedAt: candidate.startedAt };
  } catch {
    return null;
  }
}

function browserTimingDeps(): NavigationTimingDeps {
  return {
    storage: window.sessionStorage,
    now: () => performance.now(),
  };
}

export function markNavigationStartInSession(
  targetRoute: string,
  deps?: NavigationTimingDeps,
): void {
  try {
    const runtime = deps ?? browserTimingDeps();
    const pending = markNavigationStart(null, targetRoute, runtime.now());
    if (!pending) {
      runtime.storage.removeItem(NAVIGATION_MARK_KEY);
      return;
    }

    runtime.storage.setItem(NAVIGATION_MARK_KEY, JSON.stringify(pending));
  } catch {
    // Telemetry must never affect navigation.
  }
}

/**
 * Lê a marca de início de navegação SEM consumi-la.
 *
 * `consumeNavigationSampleInSession` (usado pelo NavigationPerformanceReporter
 * do layout) remove a marca ao emitir `soft_navigation`. O ContentReadyReporter
 * precisa do mesmo `startedAt` para medir da navegação até o paint, então lê
 * por aqui — sem remover, porque o dono da remoção continua sendo quem emite o
 * soft_navigation.
 *
 * Devolve null quando não há marca, quando ela é de outra superfície (uma
 * navegação anterior que nunca completou) ou quando o storage não está
 * acessível.
 */
export function peekNavigationStartForSurface(
  surface: PerformanceSurface,
  storage: NavigationStorage,
): number | null {
  try {
    const pending = parsePendingNavigation(storage.getItem(NAVIGATION_MARK_KEY));
    if (!pending || pending.surface !== surface) return null;
    return pending.startedAt;
  } catch {
    return null;
  }
}

export function consumeNavigationSampleInSession(
  currentRoute: string,
  deps: NavigationTimingDeps,
): PerformanceSample | null {
  try {
    const pending = parsePendingNavigation(deps.storage.getItem(NAVIGATION_MARK_KEY));
    const completed = completeNavigation(pending, currentRoute, deps.now());
    deps.storage.removeItem(NAVIGATION_MARK_KEY);
    return completed.sample;
  } catch {
    return null;
  }
}
