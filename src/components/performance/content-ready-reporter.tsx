"use client";

import { useEffect, useRef } from "react";
import {
  createContentReadySample,
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
  //
  // NÃO é usado para decidir o que emitir (ver `buildSample`): "primeiro
  // mount neste documento" não distingue uma abertura fria de uma navegação
  // suave para cá vinda de uma superfície sem `ContentReadyReporter` (ex.:
  // Dashboard → Inbox), porque em ambos os casos não existe marca e este É o
  // primeiro mount do documento. Construir um discriminador confiável de
  // primeira abertura é trabalho de um marco futuro; até lá o campo continua
  // aqui para essa implementação futura, mas não gera amostra nenhuma.
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
 * 2. Sem marca: não existe ponto de partida conhecido para ESTA superfície.
 *    Isso vale tanto para um carregamento duro quanto para uma navegação
 *    suave vinda de uma página sem `ContentReadyReporter` (ex.: Dashboard →
 *    Inbox) — os dois casos são indistinguíveis daqui (primeiro mount do
 *    documento, sem marca), e `performance.now()` aqui pode ser o tempo de
 *    SESSÃO inteiro, não o tempo desde a navegação. Emitir sob qualquer nome
 *    de operação criaria uma amostra cuja duração não mede o que a operação
 *    promete medir. Não emite.
 *
 *    (`app_first_open` continua definida no contrato para um marco futuro
 *    construir um discriminador correto de primeira abertura — não é isso
 *    aqui.)
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
