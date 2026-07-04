"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

type ReliableAutosaveOptions<TPayload> = {
  delayMs: number;
  save: (payload: TPayload) => Promise<void>;
};

export function useReliableAutosave<TPayload>({
  delayMs,
  save,
}: ReliableAutosaveOptions<TPayload>) {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const latestPayloadRef = useRef<TPayload | null>(null);
  const hasPendingPayloadRef = useRef(false);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const setSafeStatus = useCallback((next: AutosaveStatus) => {
    if (mountedRef.current) setStatus(next);
  }, []);

  const clearTimer = useCallback(() => {
    if (!timerRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const flush = useCallback(async () => {
    clearTimer();
    if (savingRef.current || !hasPendingPayloadRef.current || latestPayloadRef.current === null) {
      return;
    }

    savingRef.current = true;
    setSafeStatus("saving");

    try {
      while (hasPendingPayloadRef.current && latestPayloadRef.current !== null) {
        const payload = latestPayloadRef.current;
        hasPendingPayloadRef.current = false;
        await saveRef.current(payload);
      }
      setSafeStatus("saved");
    } catch (error) {
      hasPendingPayloadRef.current = true;
      console.error("[settings-autosave] Failed to save settings:", error);
      setSafeStatus("error");
    } finally {
      savingRef.current = false;
    }
  }, [clearTimer, setSafeStatus]);

  const scheduleSave = useCallback(
    (payload: TPayload) => {
      latestPayloadRef.current = payload;
      hasPendingPayloadRef.current = true;
      setSafeStatus(savingRef.current ? "saving" : "pending");
      clearTimer();
      timerRef.current = setTimeout(() => {
        void flush();
      }, delayMs);
    },
    [clearTimer, delayMs, flush, setSafeStatus],
  );

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasPendingPayloadRef.current && !savingRef.current) return;
      void flush();
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [flush]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      void flush();
    };
  }, [flush]);

  return {
    status,
    scheduleSave,
    flush,
    saving: status === "saving",
    saved: status === "saved",
    pending: status === "pending",
    error: status === "error",
  };
}
