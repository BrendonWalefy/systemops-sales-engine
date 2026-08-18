import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LLM_OUTBOUND_REGISTRY } from "@/application/channel-safety/llm-outbound-registry";

// `human_approved_external` só é aceitável se a aprovação for real: geração e
// envio precisam ser operações separadas, o envio precisa de ação humana, e
// nenhum cron pode contornar. Sem prova, a classificação é só uma promessa —
// e foi exatamente uma promessa dessas (as regras em prosa do prompt de
// recovery) que deixou o caminho autônomo aberto.

const repoRoot = process.cwd();
const read = (relative: string) => readFileSync(path.join(repoRoot, relative), "utf-8");

const CRON_ROUTES_DIR = "src/app/api/cron";

describe("recovery manual do inbox — gerar não envia", () => {
  const source = read("src/app/(clinic)/app/inbox/recovery-actions.ts");

  it("gerar e enviar são Server Actions distintas", () => {
    expect(source).toContain("export async function composeRecoveryMessageAction");
    expect(source).toContain("export async function sendRecoveryMessageAction");
  });

  it("a action que gera não alcança sink externo nenhum", () => {
    // Corta o arquivo na fronteira entre as duas actions: tudo antes do
    // `sendRecoveryMessageAction` é o caminho de geração.
    const generationOnly = source.slice(
      source.indexOf("export async function composeRecoveryMessageAction"),
      source.indexOf("export async function sendRecoveryMessageAction"),
    );

    expect(generationOnly).toContain("openai.chat.completions.create");
    expect(generationOnly).not.toContain("enqueueOutboundMessage(");
    expect(generationOnly).not.toContain("sendTextMessage(");
  });

  it("a action que envia recebe o texto de quem chamou, não do modelo", () => {
    // O operador edita o campo antes de clicar; o texto enviado é o da tela.
    expect(source).toMatch(/sendRecoveryMessageAction\(\s*\n\s*convId: string,\s*\n\s*message: string,/);
    const sendOnly = source.slice(source.indexOf("export async function sendRecoveryMessageAction"));
    expect(sendOnly).not.toContain("openai");
  });

  it("nenhum cron chama as actions de recovery manual", () => {
    const callers = grepRepo(["composeRecoveryMessageAction(", "sendRecoveryMessageAction("]);
    expect(callers.filter((file) => file.startsWith(CRON_ROUTES_DIR))).toEqual([]);
    // Quem chama é a tela do inbox, e mais nada.
    expect(callers).toEqual(["src/app/(clinic)/app/inbox/InboxClient.tsx"]);
  });
});

describe("campanha de reativação — rascunho não sai sem dupla aprovação", () => {
  const dispatch = read("src/application/reactivation/dispatch-campaign.ts");

  it("exige campanha aprovada e alvo aprovado antes de enfileirar", () => {
    expect(dispatch).toContain("if (!campaign.approvedAt)");
    expect(dispatch).toContain("t.status = 'approved'");
  });

  it("gerar rascunho não enfileira nada", () => {
    const generate = read("src/application/reactivation/generate-drafts.ts");
    expect(generate).toContain("callAdvisorLLMWithUsage");
    expect(generate).not.toContain("enqueueOutboundMessage");
    expect(generate).not.toContain("sendTextMessage");
  });

  it("nenhum cron dispara a campanha", () => {
    const callers = grepRepo(["dispatchCampaign(", "generateDraftsForCampaign("]);
    expect(callers.filter((file) => file.startsWith(CRON_ROUTES_DIR))).toEqual([]);
    expect(callers).toEqual(["src/app/(clinic)/app/campanhas/actions.ts"]);
  });

  it("a aprovação é registrada com o e-mail de quem aprovou", () => {
    // Aprovação anônima não seria aprovação humana provável, só um booleano.
    expect(read("src/application/reactivation/create-campaign.ts")).toContain(
      "approvedByEmail: input.approvedByEmail",
    );
  });
});

describe("caminhos internos — não alcançam o lead", () => {
  it("o simulador de playbook compõe e não envia", () => {
    const source = read("src/app/api/playbook/simulate/route.ts");
    expect(source).toContain("new ResponseComposer().compose(");
    expect(source).not.toContain("enqueueOutboundMessage");
    expect(source).not.toContain("sendTextMessage");
    expect(source).not.toContain("appendMessage");
  });

  it("o gerador de conversa de demo compõe e não envia", () => {
    const source = read("src/application/demo/generate-demo-conversation.ts");
    expect(source).toContain("composer.compose(");
    expect(source).not.toContain("enqueueOutboundMessage");
    expect(source).not.toContain("sendTextMessage");
  });

  it("a sugestão de resposta do inbox só devolve JSON", () => {
    const source = read("src/app/api/conversations/[conversationId]/suggest-reply/route.ts");
    expect(source).toContain("openai.chat.completions.create");
    expect(source).toContain("NextResponse.json({ suggestion })");
    expect(source).not.toContain("enqueueOutboundMessage");
  });

  it("os insights operacionais gravam em tabela, não em canal", () => {
    const source = read("src/app/api/cron/conversation-insights/route.ts");
    expect(source).toContain("callAdvisorLLM");
    expect(source).toContain("clinicOperationalInsights");
    expect(source).not.toContain("enqueueOutboundMessage");
    expect(source).not.toContain("sendTextMessage");
  });
});

describe("registro e realidade", () => {
  it("todo human_approved tem prova neste arquivo", () => {
    const humanApproved = Object.entries(LLM_OUTBOUND_REGISTRY)
      .filter(([, declaration]) => declaration.classification === "human_approved_external")
      .map(([module]) => module);

    expect(humanApproved.sort()).toEqual([
      "app/(clinic)/app/inbox/recovery-actions",
      "application/reactivation/dispatch-campaign",
    ]);
  });
});

/**
 * Arquivos que **chamam** algum dos símbolos, excluindo onde são definidos.
 * Procura a forma de chamada (`nome(`) e não a menção: o registro de
 * `channel-safety` cita esses nomes em prosa e não é chamador de nada.
 */
function grepRepo(symbols: string[]): string[] {
  const found = new Set<string>();
  for (const symbol of symbols) {
    let output = "";
    try {
      output = execFileSync(
        "grep",
        ["-rl", "--include=*.ts", "--include=*.tsx", "-F", symbol, "src"],
        { cwd: repoRoot, encoding: "utf-8" },
      );
    } catch {
      continue; // grep sai 1 quando não acha
    }
    for (const file of output.split("\n").filter(Boolean)) {
      if (file.includes("__tests__")) continue;
      const source = read(file);
      // Só conta como chamador quem não é o próprio módulo que define o símbolo.
      const defines =
        source.includes(`export async function ${symbol.replace("(", "")}`)
        || source.includes(`export function ${symbol.replace("(", "")}`);
      if (!defines) found.add(file);
    }
  }
  return [...found].sort();
}
