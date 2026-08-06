/**
 * MOTOR DE DEMO — roteiro "UAU" reproduzível para vendas.
 *
 * Reproduz uma conversa de lead ideal contra a IA REAL (endpoint
 * `/api/playbook/simulate`, modo `source: "production"` = espelho da produção),
 * usando o playbook da clínica demo "Odonto Marques". Imprime a transcrição
 * lead ↔ Marina com os "beats" de venda anotados — para ensaiar, verificar que a
 * demo sempre funciona, ou rodar ao vivo na frente do prospect.
 *
 * Pré-requisito: a clínica demo precisa existir no banco.
 *   npm run seed:demo         # (ou o botão "Carregar clínica demo" no painel owner)
 *
 * Uso (local, com o app em `npm run dev`):
 *   npm run demo:roteiro
 *
 * Contra produção:
 *   SYSTEMOPS_BASE_URL=https://app.systemops.com.br SIMULATE_API_KEY=... \
 *   npx dotenv -e .env.local -- npx tsx scripts/demo-roteiro.ts
 *
 * Variáveis:
 *   SYSTEMOPS_BASE_URL  base do app (default http://localhost:3000)
 *   SIMULATE_API_KEY    chave do endpoint de simulação (header x-simulate-key).
 *                       Local: pode-se usar SIMULATE_ALLOW_UNAUTHENTICATED=true no app.
 *   DEMO_CLINIC_ID      opcional; se ausente, resolve pela slug via DATABASE_URL.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../src/infrastructure/db/client";
import { organizations } from "../src/infrastructure/db/schema";
import { DEMO_CLINIC_SLUG, DEMO_CLINIC_NAME } from "../src/application/demo/seed-demo-clinic";

// ── O roteiro UAU ────────────────────────────────────────────────────────────
// Cada linha do lead expõe a IA num momento decisivo de venda.
type Beat = { lead: string; nota: string };

const ROTEIRO: Beat[] = [
  {
    lead:
      "Oi! Vi o Instagram de vocês agora à noite e me apaixonei pelas lentes. Ainda dá pra saber como funciona?",
    nota: "Fora do horário (à noite) a IA responde na hora — exatamente o lead que a clínica perderia dormindo.",
  },
  {
    lead: "Quanto fica pra fazer as lentes?",
    nota: "Dá o preço pela POLÍTICA da clínica ('a partir de R$1.800 por dente, após avaliação') — nunca inventa número.",
  },
  {
    lead: "Nossa, pra ser sincera achei um pouco caro...",
    nota: "Contorna a objeção com o script da própria clínica (parcelamento + plano montado na avaliação).",
  },
  {
    lead: "Entendi. E como eu faço pra marcar essa avaliação?",
    nota: "Oferece horários REAIS de avaliação, sem enrolação.",
  },
  {
    lead: "Quero o primeiro horário, por favor 😊",
    nota: "Fecha o agendamento sozinha e confirma — conversão completa, sem nenhum humano envolvido.",
  },
];

// Beat opcional para mostrar o handoff inteligente (rode com --handoff).
const HANDOFF_BEAT: Beat = {
  lead: "Na verdade, agora tô com uma dor forte no dente, o que eu faço?",
  nota: "Reconhece urgência clínica e passa para o humano na hora — sabe a hora de NÃO ser robô.",
};

// ── HTTP ─────────────────────────────────────────────────────────────────────
type HistItem = { role: "user" | "assistant"; text: string; intent?: string };
type SimulateResponse = { text: string; intent: string; slots?: { index: number; label: string }[] };

async function callSimulate(
  baseUrl: string,
  apiKey: string | undefined,
  clinicId: string,
  message: string,
  history: HistItem[],
): Promise<SimulateResponse> {
  const res = await fetch(`${baseUrl}/api/playbook/simulate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { "x-simulate-key": apiKey } : {}),
    },
    body: JSON.stringify({ message, history, clinicId, source: "production" }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`simulate respondeu ${res.status}: ${body}`);
  }
  return (await res.json()) as SimulateResponse;
}

async function resolveClinicId(): Promise<string> {
  if (process.env.DEMO_CLINIC_ID) return process.env.DEMO_CLINIC_ID;
  const row = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, DEMO_CLINIC_SLUG))
    .limit(1)
    .then((r) => r[0] ?? null);
  if (!row) {
    throw new Error(
      `Clínica demo "${DEMO_CLINIC_SLUG}" não encontrada no banco. ` +
        `Rode \`npm run seed:demo\` (ou o botão "Carregar clínica demo" no painel owner) antes.`,
    );
  }
  return row.id;
}

// ── Impressão ────────────────────────────────────────────────────────────────
const C = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  green: "\x1b[32m", cyan: "\x1b[36m", yellow: "\x1b[33m", gray: "\x1b[90m",
};

function printLead(text: string): void {
  console.log(`\n${C.cyan}${C.bold}👤 Lead:${C.reset} ${text}`);
}
function printMarina(text: string, slots?: { label: string }[]): void {
  const indented = text.split("\n").map((l) => `   ${l}`).join("\n");
  console.log(`${C.green}${C.bold}💬 Marina (IA):${C.reset}\n${C.green}${indented}${C.reset}`);
  if (slots?.length) {
    console.log(`${C.gray}   [horários oferecidos: ${slots.map((s) => s.label).join(" · ")}]${C.reset}`);
  }
}
function printNota(nota: string): void {
  console.log(`${C.yellow}   ▸ ${nota}${C.reset}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const baseUrl = process.env.SYSTEMOPS_BASE_URL ?? "http://localhost:3000";
  const apiKey = process.env.SIMULATE_API_KEY;
  const withHandoff = process.argv.includes("--handoff");
  const roteiro = withHandoff ? [...ROTEIRO, HANDOFF_BEAT] : ROTEIRO;

  const clinicId = await resolveClinicId();

  console.log(`${C.bold}══════════════════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}  Roteiro UAU — ${DEMO_CLINIC_NAME} (especialista comercial Marina)${C.reset}`);
  console.log(`${C.dim}  app: ${baseUrl}  ·  clinicId: ${clinicId}${C.reset}`);
  console.log(`${C.bold}══════════════════════════════════════════════════════════${C.reset}`);

  const history: HistItem[] = [];
  for (const beat of roteiro) {
    printLead(beat.lead);
    const resp = await callSimulate(baseUrl, apiKey, clinicId, beat.lead, history);
    history.push({ role: "user", text: beat.lead });
    history.push({ role: "assistant", text: resp.text, intent: resp.intent });
    printMarina(resp.text, resp.slots);
    printNota(beat.nota);
  }

  console.log(`\n${C.bold}══════════════════════════════════════════════════════════${C.reset}`);
  console.log(
    `${C.green}${C.bold}✓ Em ${roteiro.length} mensagens a IA fez: respondeu fora do horário, ` +
      `deu preço pela política, contornou objeção, ofereceu horário real e fechou o agendamento.${C.reset}`,
  );
  console.log(`${C.dim}  Feche a demo abrindo o dashboard da clínica: ROI, leads fora do horário e horas economizadas.${C.reset}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`\n${C.yellow}✗ ${err instanceof Error ? err.message : String(err)}${C.reset}`);
  process.exit(1);
});
