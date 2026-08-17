import { describe, expect, it } from "vitest";
import { buildLlmOutboundPaths } from "@/application/channel-safety/llm-outbound-graph";
import {
  LLM_OUTBOUND_REGISTRY,
  unprotectedAutonomousPaths,
} from "@/application/channel-safety/llm-outbound-registry";

// A auditoria do Ciclo B contou chamadores de `ResponseComposer.compose()` e
// concluiu que a superfície estava fechada. `cron/recovery-campaign` escrevia o
// próprio prompt, chamava a OpenAI direto e enfileirava para o lead sem tocar
// naquela classe. A métrica não enxergava o caminho.
//
// Este teste existe para que o próximo caminho assim não dependa de alguém
// lembrar de auditar: ele deriva a superfície do grafo de imports a cada
// `npm test` e exige declaração explícita de qualquer módulo que gere texto e
// alcance um canal externo.

const paths = buildLlmOutboundPaths(process.cwd());

describe("fronteira LLM → canal externo", () => {
  it("todo caminho descoberto está declarado no registro", () => {
    const undeclared = paths
      .map((path) => path.module)
      .filter((module) => !(module in LLM_OUTBOUND_REGISTRY));

    // Se este teste quebrou num PR: um módulo passou a poder gerar texto e
    // enviá-lo para fora. Declare-o em `llm-outbound-registry.ts` com a
    // classificação e o motivo. Se for `autonomous_external`, ele precisa antes
    // atravessar o `ConversationResponsePlanner`.
    expect(undeclared).toEqual([]);
  });

  it("nenhum caminho autônomo chega ao lead sem plano e validador", () => {
    expect(unprotectedAutonomousPaths(paths)).toEqual([]);
  });

  it("acusa autônomo declarado que não atravessa a fronteira", () => {
    // A asserção acima passa vazia hoje, que é o objetivo. Este caso prova que
    // ela não passa vazia por estar quebrada: dado um autônomo sem planner e sem
    // delegação, a função acusa. Verificado também de ponta a ponta, criando uma
    // rota falsa que importava openai e chamava enqueueOutboundMessage — o teste
    // "todo caminho descoberto está declarado" quebrou nomeando o módulo.
    expect(
      unprotectedAutonomousPaths([
        { module: "app/api/cron/recovery-campaign/route", usesPlanner: false },
      ]),
    ).toEqual(["app/api/cron/recovery-campaign/route"]);
    expect(
      unprotectedAutonomousPaths([
        { module: "app/api/cron/recovery-campaign/route", usesPlanner: true },
      ]),
    ).toEqual([]);
    // Delegar ao orquestrador é fronteira válida, e não é acusado.
    expect(
      unprotectedAutonomousPaths([
        { module: "app/api/whatsapp/zapi/route", usesPlanner: false },
      ]),
    ).toEqual([]);
  });

  it("o orquestrador, que os delegantes usam como fronteira, usa o planner", () => {
    // `boundary: "orchestrator"` só é aceitável enquanto isto for verdade.
    const orchestrator = paths.find(
      (path) => path.module === "core/pipeline/ConversationOrchestrator",
    );
    expect(orchestrator?.usesPlanner).toBe(true);
  });

  it("o handler live V2 usa o pipeline autorizado antes da outbox", () => {
    const liveV2 = paths.find(
      (path) => path.module === "application/conversation-v2/v2-live-conversation-handler",
    );
    expect(liveV2?.usesTurnPipeline).toBe(true);
    expect(
      unprotectedAutonomousPaths([
        {
          module: "application/conversation-v2/v2-live-conversation-handler",
          usesPlanner: false,
          usesTurnPipeline: false,
        },
      ]),
    ).toEqual(["application/conversation-v2/v2-live-conversation-handler"]);
  });

  it("os quatro caminhos autônomos conhecidos continuam sendo encontrados", () => {
    // Trava o outro lado: se alguém quebrar o analisador, ele para de encontrar
    // caminho nenhum e os testes acima passam vazios. Isto acusa.
    const discovered = new Set(paths.map((path) => path.module));
    for (const autonomous of [
      "core/pipeline/ConversationOrchestrator",
      "app/api/cron/appointment-reminder/route",
      "app/api/cron/follow-up-dispatcher/route",
      "app/api/cron/recovery-campaign/route",
    ]) {
      expect(discovered).toContain(autonomous);
    }
  });

  it("todo autônomo declara como alcança a fronteira", () => {
    for (const [module, declaration] of Object.entries(LLM_OUTBOUND_REGISTRY)) {
      if (declaration.classification !== "autonomous_external") continue;
      expect(declaration.boundary, `${module} sem boundary declarada`).toBeDefined();
    }
  });

  it("registro só carrega entrada manual para caminho que o grafo não vê", () => {
    // Texto de LLM que viaja pelo banco entre geração e envio não aparece no
    // grafo de imports. Declarar como `manualOnly` é o reconhecimento explícito
    // dessa limitação — e impede que a entrada vire lixo silencioso.
    const discovered = new Set(paths.map((path) => path.module));
    for (const [module, declaration] of Object.entries(LLM_OUTBOUND_REGISTRY)) {
      if (declaration.manualOnly) {
        expect(discovered, `${module} agora é visível ao grafo`).not.toContain(module);
      } else {
        expect(discovered, `${module} não é mais encontrado pelo grafo`).toContain(module);
      }
    }
  });

  it("a contagem por categoria é a que o gate do Ciclo B afirma", () => {
    const byClass = (classification: string) =>
      Object.values(LLM_OUTBOUND_REGISTRY).filter(
        (declaration) => declaration.classification === classification,
      ).length;

    expect(byClass("autonomous_external")).toBe(7);
    expect(byClass("human_approved_external")).toBe(2);
    expect(unprotectedAutonomousPaths(paths)).toHaveLength(0);
  });
});
