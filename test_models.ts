import { callAdvisorLLM } from "./src/infrastructure/llm/advisor-llm";

async function main() {
  try {
    console.log("Trying claude-sonnet-5...");
    const res1 = await callAdvisorLLM("Diga olá", { model: "claude-sonnet-5" });
    console.log("Res1:", res1);
  } catch (e) {
    console.error("Error 1:", e);
  }

  try {
    console.log("Trying claude-3-5-sonnet-20240620...");
    const res2 = await callAdvisorLLM("Diga olá", { model: "claude-3-5-sonnet-20240620" });
    console.log("Res2:", res2);
  } catch (e) {
    console.error("Error 2:", e);
  }

  process.exit(0);
}

main().catch(console.error);
