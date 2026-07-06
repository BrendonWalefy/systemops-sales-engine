import { callAdvisorLLM, SETUP_STUDY_MODEL } from "./src/infrastructure/llm/advisor-llm";

async function main() {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  
  console.log("Calling Claude natively with basic prompt...");
  try {
    const res = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 4000,
      messages: [{ role: "user", content: "Diga olá e me mostre a sua estrutura de resposta JSON" }],
    });
    console.log(JSON.stringify(res, null, 2));
  } catch (e) {
    console.error("Error:", e);
  }

  process.exit(0);
}

main().catch(console.error);
