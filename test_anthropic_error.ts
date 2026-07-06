import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function run() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    const res = await client.messages.create({
      model: "",
      max_tokens: 10,
      messages: [{ role: "user", content: "oi" }],
    });
    console.log(res);
  } catch (err: any) {
    console.log("Empty model error:");
    console.log(err.message);
  }
}
run();
