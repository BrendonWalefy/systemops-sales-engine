// A versão materializada do Inbox só muda quando alguém ESCREVE. Existe uma
// classe inteira de transições da tela que não tem escrita nenhuma:
//
//  - `isRecoveryCandidate` vira true sozinho quando hoursWaiting >= 2;
//  - um `conversationStates.expiresAt` vencendo tira a linha de "Pendências";
//  - um `humanReviewRequests.expiresAt` vencendo faz o mesmo;
//  - `appointments.endsAt` passando reclassifica o agendamento como passado;
//  - `hoursWaiting` é calculado no render, então "aguardando há 1h" congela.
//
// Nenhuma delas bumpa nada. O refresh incondicional de 60s que a Task 6
// removeu era o que as cobria. Este arquivo fixa o teto que as cobre agora,
// sem ressuscitar aquele refresh: o custo continua sendo um poll barato de
// uma linha indexada, e só o REFRESH (caro) passa a ter piso de frequência.

import { describe, expect, it } from "vitest";
import {
  TOP_RUNG_POLLS_BEFORE_FORCED_REFRESH,
  nextPollDelayMs,
  shouldForceRefreshAfterHidden,
  shouldForceRefreshAfterUnchangedPolls,
  unchangedStreakAfterForcedRefresh,
} from "@/app/(clinic)/app/inbox/poll-schedule";

// Simula a sequência real do poller: o atraso do próximo poll vem da escada
// aplicada ao streak ATUAL, e cada poll sem mudança soma 1 ao streak.
function timeUntilForcedRefresh(startingStreak: number): { ms: number; polls: number } {
  let streak = startingStreak;
  let ms = 0;
  let polls = 0;

  while (!shouldForceRefreshAfterUnchangedPolls(streak)) {
    ms += nextPollDelayMs(streak);
    streak += 1;
    polls += 1;
    if (polls > 100) throw new Error("teto nunca alcançado — o refresh forçado não existe");
  }

  return { ms, polls };
}

describe("teto de obsolescência do Inbox (transições sem escrita)", () => {
  it("não força refresh enquanto o streak não chega ao teto", () => {
    expect(shouldForceRefreshAfterUnchangedPolls(0)).toBe(false);
    expect(shouldForceRefreshAfterUnchangedPolls(2)).toBe(false);
    expect(
      shouldForceRefreshAfterUnchangedPolls(1 + TOP_RUNG_POLLS_BEFORE_FORCED_REFRESH),
    ).toBe(false);
  });

  it("força refresh depois de N polls seguidos no degrau de 60s", () => {
    expect(
      shouldForceRefreshAfterUnchangedPolls(2 + TOP_RUNG_POLLS_BEFORE_FORCED_REFRESH),
    ).toBe(true);
  });

  it("o pior caso a partir da montagem é de minutos, não ilimitado", () => {
    const { ms, polls } = timeUntilForcedRefresh(0);

    // 15s + 30s + 4 polls de 60s = 285s (4min45). O antigo refresh
    // incondicional era 60s; o ponto aqui é que o teto exista e seja
    // pequeno, não que seja igual ao de antes.
    expect(ms).toBe(285_000);
    expect(polls).toBe(2 + TOP_RUNG_POLLS_BEFORE_FORCED_REFRESH);
    expect(ms).toBeLessThanOrEqual(5 * 60_000);
  });

  it("depois de um refresh forçado o streak volta ao TOPO da escada, não ao início", () => {
    // Reiniciar em 0 faria a escada voltar a 15s e desfaria o barateamento do
    // poll numa aba ociosa. O regime permanente é um refresh forçado a cada
    // N polls de 60s.
    const resumed = unchangedStreakAfterForcedRefresh();
    expect(nextPollDelayMs(resumed)).toBe(60_000);

    const { ms, polls } = timeUntilForcedRefresh(resumed);
    expect(polls).toBe(TOP_RUNG_POLLS_BEFORE_FORCED_REFRESH);
    expect(ms).toBe(TOP_RUNG_POLLS_BEFORE_FORCED_REFRESH * 60_000);
  });

  it("uma aba que ficou escondida além do degrau de topo volta com refresh forçado", () => {
    expect(shouldForceRefreshAfterHidden(60_000)).toBe(true);
    expect(shouldForceRefreshAfterHidden(3 * 3600_000)).toBe(true);
  });

  it("alt-tab rápido não força refresh — só o poll imediato", () => {
    expect(shouldForceRefreshAfterHidden(0)).toBe(false);
    expect(shouldForceRefreshAfterHidden(59_999)).toBe(false);
  });
});
