import type {
  SalesAgentGateway,
  SalesAgentInput,
  SalesAgentOutput,
} from "@/application/ports/sales-agent-gateway";

export class LlmSalesAgentGateway implements SalesAgentGateway {
  async analyze(input: SalesAgentInput): Promise<SalesAgentOutput> {
    void input;
    throw new Error("Sales agent LLM gateway not implemented yet");
  }
}
