import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { aiUsageCosts } from "@/infrastructure/db/schema";
import type { OperationalAlert } from "@/application/health/operational-alerts";

// Monitor de créditos das integrações pagas (incidente 08/07/2026: OpenAI
// insufficient_quota derrubou as respostas por ~1h40). A OpenAI não expõe API de
// saldo, então o orçamento é vigiado pelo nosso próprio rastreio (ai_usage_costs)
// contra o teto mensal do auto-recharge. O ElevenLabs expõe o saldo real via
// /v1/user/subscription — a mesma chave de produção do TTS precisa da permissão
// User=Read além de Text to Speech=Access.

const ELEVENLABS_WARN_REMAINING_FRACTION = 0.25;
const ELEVENLABS_CRITICAL_REMAINING_FRACTION = 0.1;
const OPENAI_WARN_USED_FRACTION = 0.7;
const OPENAI_CRITICAL_USED_FRACTION = 0.9;
// Teto de recarga mensal configurado no painel da OpenAI. Se o valor mudar lá,
// atualizar OPENAI_MONTHLY_BUDGET_USD no Vercel para manter o alerta honesto.
const DEFAULT_OPENAI_MONTHLY_BUDGET_USD = 20;

const PLATFORM_ALERT_BASE = {
  clinicId: "platform",
  clinicName: "Plataforma",
  source: "credits",
} as const;

export type ElevenLabsCreditSnapshot = {
  usedCharacters: number;
  characterLimit: number;
  nextResetAt: Date | null;
};

export type OpenAiBudgetSnapshot = {
  monthToDateUsdMicros: number;
  monthlyBudgetUsd: number;
};

function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(0)}%`;
}

function formatUsd(micros: number): string {
  return `US$ ${(micros / 1_000_000).toFixed(2)}`;
}

export function evaluateElevenLabsCredits(
  snapshot: ElevenLabsCreditSnapshot,
): OperationalAlert[] {
  if (snapshot.characterLimit <= 0) return [];

  const remainingFraction = Math.max(
    0,
    (snapshot.characterLimit - snapshot.usedCharacters) / snapshot.characterLimit,
  );

  if (remainingFraction > ELEVENLABS_WARN_REMAINING_FRACTION) return [];

  const resetInfo = snapshot.nextResetAt
    ? `; renova em ${snapshot.nextResetAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
    : "";
  const level =
    remainingFraction <= ELEVENLABS_CRITICAL_REMAINING_FRACTION ? "critical" : "warn";

  return [
    {
      ...PLATFORM_ALERT_BASE,
      level,
      title:
        level === "critical"
          ? "Créditos ElevenLabs quase esgotados"
          : "Créditos ElevenLabs abaixo de 25%",
      detail:
        `${formatPercent(remainingFraction)} restante ` +
        `(${(snapshot.characterLimit - snapshot.usedCharacters).toLocaleString("pt-BR")} de ` +
        `${snapshot.characterLimit.toLocaleString("pt-BR")} créditos)${resetInfo}. ` +
        "Voz para de sair quando zera — considerar upgrade de plano ou reduzir modo de voz.",
    },
  ];
}

export function evaluateOpenAiBudget(
  snapshot: OpenAiBudgetSnapshot,
): OperationalAlert[] {
  if (snapshot.monthlyBudgetUsd <= 0) return [];

  const budgetMicros = snapshot.monthlyBudgetUsd * 1_000_000;
  const usedFraction = snapshot.monthToDateUsdMicros / budgetMicros;

  if (usedFraction < OPENAI_WARN_USED_FRACTION) return [];

  const level = usedFraction >= OPENAI_CRITICAL_USED_FRACTION ? "critical" : "warn";

  return [
    {
      ...PLATFORM_ALERT_BASE,
      level,
      title:
        level === "critical"
          ? "Orçamento OpenAI perto do teto mensal"
          : "Orçamento OpenAI acima de 70% do teto",
      detail:
        `${formatUsd(snapshot.monthToDateUsdMicros)} de ` +
        `US$ ${snapshot.monthlyBudgetUsd.toFixed(2)} estimados no mês (${formatPercent(usedFraction)}). ` +
        "Quando o teto é atingido o auto-recharge para e as respostas caem em fallback — " +
        "subir o teto no painel da OpenAI antes disso.",
    },
  ];
}

function monitoringFailureAlert(service: string, reason: string): OperationalAlert {
  return {
    ...PLATFORM_ALERT_BASE,
    level: "warn",
    title: `Não foi possível verificar créditos (${service})`,
    detail: `${reason}. O saldo pode estar baixo sem que o monitor perceba.`,
  };
}

export async function fetchElevenLabsCredits(): Promise<
  ElevenLabsCreditSnapshot | { error: string }
> {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) return { error: "ELEVENLABS_API_KEY não configurada" };

  try {
    const response = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
      headers: { "xi-api-key": apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return { error: `API respondeu ${response.status}` };
    }

    const body = (await response.json()) as {
      character_count?: number;
      character_limit?: number;
      next_character_count_reset_unix?: number;
    };

    return {
      usedCharacters: body.character_count ?? 0,
      characterLimit: body.character_limit ?? 0,
      nextResetAt: body.next_character_count_reset_unix
        ? new Date(body.next_character_count_reset_unix * 1000)
        : null,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function fetchOpenAiMonthToDateMicros(now: Date): Promise<number> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(${aiUsageCosts.estimatedCostUsdMicros}), 0)`,
    })
    .from(aiUsageCosts)
    .where(
      and(eq(aiUsageCosts.provider, "openai"), gte(aiUsageCosts.createdAt, monthStart)),
    );

  return Number(row?.total ?? 0);
}

export async function inspectCreditBalances(now = new Date()): Promise<OperationalAlert[]> {
  const alerts: OperationalAlert[] = [];

  const elevenLabs = await fetchElevenLabsCredits();
  if ("error" in elevenLabs) {
    alerts.push(monitoringFailureAlert("ElevenLabs", elevenLabs.error));
  } else {
    alerts.push(...evaluateElevenLabsCredits(elevenLabs));
  }

  try {
    const monthToDateUsdMicros = await fetchOpenAiMonthToDateMicros(now);
    const monthlyBudgetUsd = Number(
      process.env.OPENAI_MONTHLY_BUDGET_USD ?? DEFAULT_OPENAI_MONTHLY_BUDGET_USD,
    );
    alerts.push(
      ...evaluateOpenAiBudget({
        monthToDateUsdMicros,
        monthlyBudgetUsd: Number.isFinite(monthlyBudgetUsd)
          ? monthlyBudgetUsd
          : DEFAULT_OPENAI_MONTHLY_BUDGET_USD,
      }),
    );
  } catch (error) {
    alerts.push(
      monitoringFailureAlert(
        "OpenAI",
        error instanceof Error ? error.message : String(error),
      ),
    );
  }

  return alerts;
}
