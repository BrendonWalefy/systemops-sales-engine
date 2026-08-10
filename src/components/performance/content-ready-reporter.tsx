"use client";

import { useEffect, useRef } from "react";
import {
  createContentReadySample,
  createFirstOpenSample,
  MAX_CLIENT_SAMPLES_PER_SESSION,
  type PerformanceSample,
  type PerformanceSurface,
} from "@/application/observability/performance-contract";
import {
  MAX_NAVIGATION_DURATION_MS,
  NAVIGATION_COUNT_KEY,
  peekNavigationStartForSurface,
  type NavigationStorage,
} from "@/application/observability/navigation-timing";

type Props = { surface: PerformanceSurface };

type EmitDeps = {
  storage: NavigationStorage;
  fetch: typeof globalThis.fetch;
  now(): number;
  // Instante em que a navegação para esta superfície começou, gravado no
  // clique por `markNavigationStartInSession`. null numa navegação dura ou
  // quando a marca não existe/é de outra superfície.
  navigationStartedAt: number | null;
  // Primeiro content-ready DESTE documento — ou seja, o render que veio junto
  // com o carregamento da página, não uma navegação suave posterior.
  isFirstInDocument: boolean;
};

function readSampleCount(storage: NavigationStorage): number {
  const count = Number(storage.getItem(NAVIGATION_COUNT_KEY));
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

/**
 * Decide O QUE esta medição significa antes de decidir o número.
 *
 * 1. Com marca de navegação: o tempo é `now - startedAt`, ou seja da navegação
 *    até o conteúdo pintado. É o que `content_ready` promete medir.
 * 2. Sem marca, primeiro render do documento: é um carregamento duro, e aí o
 *    `timeOrigin` de `performance.now()` É o início da navegação. O número
 *    vale — e o que ele mede é "abrir o app do zero até ver conteúdo", que é
 *    `app_first_open`, não `content_ready`.
 * 3. Sem marca e não é o primeiro render: não existe ponto de partida
 *    conhecido. `performance.now()` aqui é o tempo de SESSÃO, que não mede
 *    nada que qualquer uma das duas operações promete. Não emite.
 */
function buildSample(
  surface: PerformanceSurface,
  deps: EmitDeps,
): PerformanceSample | null {
  const now = deps.now();

  if (deps.navigationStartedAt !== null) {
    const durationMs = now - deps.navigationStartedAt;
    if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > MAX_NAVIGATION_DURATION_MS) {
      return null;
    }
    return createContentReadySample(surface, Math.round(durationMs));
  }

  if (deps.isFirstInDocument) {
    if (!Number.isFinite(now) || now < 0 || now > MAX_NAVIGATION_DURATION_MS) return null;
    return createFirstOpenSample(surface, Math.round(now));
  }

  return null;
}

export function emitContentReadySample(
  surface: PerformanceSurface,
  deps: EmitDeps,
): void {
  try {
    const sample = buildSample(surface, deps);
    if (!sample) return;

    // O orçamento só é consumido por amostra realmente enviada: descartar
    // por falta de ponto de partida não pode gastar a cota da sessão.
    const count = readSampleCount(deps.storage);
    if (count >= MAX_CLIENT_SAMPLES_PER_SESSION) return;
    deps.storage.setItem(NAVIGATION_COUNT_KEY, String(count + 1));

    void deps.fetch("/api/telemetry/performance", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sample),
      keepalive: true,
    }).catch(() => {
      // Telemetria nunca pode quebrar a tela que está medindo.
    });
  } catch {
    // Telemetria nunca pode quebrar a tela que está medindo.
  }
}

// Escopo de MÓDULO, não do componente: "primeiro do documento" é uma
// propriedade do documento carregado, e cada navegação suave monta um
// ContentReadyReporter novo dentro do MESMO documento.
let firstContentReadyInDocument = true;

export function ContentReadyReporter({ surface }: Props) {
  const reported = useRef(false);

  useEffect(() => {
    if (reported.current) return;
    reported.current = true;

    // A marca é lida AQUI, no corpo do effect, e não dentro do
    // requestAnimationFrame: o NavigationPerformanceReporter montado no
    // layout CONSOME (remove) essa marca no effect dele. Effects de filho
    // rodam antes dos do pai, então esta leitura acontece antes da remoção;
    // o rAF, que só roda depois de todos os effects, chegaria tarde demais.
    let navigationStartedAt: number | null = null;
    try {
      navigationStartedAt = peekNavigationStartForSurface(surface, window.sessionStorage);
    } catch {
      navigationStartedAt = null;
    }
    const isFirstInDocument = firstContentReadyInDocument;
    firstContentReadyInDocument = false;

    const frame = requestAnimationFrame(() => {
      emitContentReadySample(surface, {
        storage: window.sessionStorage,
        fetch: globalThis.fetch.bind(globalThis),
        now: () => performance.now(),
        navigationStartedAt,
        isFirstInDocument,
      });
    });

    return () => cancelAnimationFrame(frame);
  }, [surface]);

  return null;
}
