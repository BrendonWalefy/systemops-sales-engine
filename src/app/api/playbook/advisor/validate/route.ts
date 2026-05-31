import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BASELINE_SCENARIOS = [
  { message: "oi", history: [] as never[], expectedIntent: "greeting" },
  { message: "quero agendar uma consulta", history: [] as never[], expectedIntent: "book_appointment" },
  { message: "quanto custa a avaliação", history: [] as never[], expectedIntent: "price_inquiry" },
  { message: "estou com muita dor", history: [] as never[], expectedIntent: "clinical_urgency" },
  { message: "obrigado tchau", history: [] as never[], expectedIntent: "farewell" },
];

type ProposedPlaybook = {
  specialty: string;
  procedureDescription: string;
  toneOfVoice: string;
  differentials: string[];
  commercialPolicy: string;
  objections: Array<{ objection: string; response: string }>;
  greetingMessage: string;
};

type ScenarioResult = {
  scenario: string;
  expectedIntent: string;
  actualIntent: string;
  passed: boolean;
};

async function runScenario(
  baseUrl: string,
  simulateKey: string,
  playbook: ProposedPlaybook,
  scenario: (typeof BASELINE_SCENARIOS)[0],
): Promise<ScenarioResult> {
  // First message needs empty history to trigger greeting
  // For non-greeting scenarios, seed with a prior greeting exchange
  const history =
    scenario.expectedIntent === "greeting"
      ? []
      : [
          { role: "user" as const, text: "oi", intent: undefined },
          { role: "assistant" as const, text: playbook.greetingMessage || "Olá!", intent: "greeting" },
        ];

  const res = await fetch(`${baseUrl}/api/playbook/simulate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-simulate-key": simulateKey,
    },
    body: JSON.stringify({ message: scenario.message, history, playbook }),
  });

  if (!res.ok) {
    return { scenario: scenario.message, expectedIntent: scenario.expectedIntent, actualIntent: "error", passed: false };
  }

  const data = (await res.json()) as { intent: string };
  return {
    scenario: scenario.message,
    expectedIntent: scenario.expectedIntent,
    actualIntent: data.intent,
    passed: data.intent === scenario.expectedIntent,
  };
}

// POST /api/playbook/advisor/validate
// Body: { proposedPlaybook: ProposedPlaybook }
// Runs 5 baseline scenarios against the proposed playbook via simulate.
export async function POST(req: NextRequest) {
  const SIMULATE_API_KEY = process.env.SIMULATE_API_KEY;
  if (!SIMULATE_API_KEY) {
    return NextResponse.json({ error: "SIMULATE_API_KEY not configured" }, { status: 500 });
  }

  const body = (await req.json()) as { proposedPlaybook: ProposedPlaybook };
  if (!body.proposedPlaybook) {
    return NextResponse.json({ error: "proposedPlaybook required" }, { status: 400 });
  }

  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

  const scenarioResults = await Promise.all(
    BASELINE_SCENARIOS.map((s) => runScenario(baseUrl, SIMULATE_API_KEY, body.proposedPlaybook, s)),
  );

  const passed = scenarioResults.filter((r) => r.passed).length;

  return NextResponse.json({
    passed,
    total: BASELINE_SCENARIOS.length,
    failures: scenarioResults.filter((r) => !r.passed),
    results: scenarioResults,
  });
}
