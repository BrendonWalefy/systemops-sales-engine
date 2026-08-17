import { describe, expect, it, vi } from "vitest";
import { createLiveDentalUnderstanding } from "@/infrastructure/adapters/ai/live-dental-understanding";

const rawUnderstanding = {
  version: "understanding.v1",
  request: "price-of-service",
  dialogueMove: "new_topic",
  entities: {
    service: "clareamento",
    date: null,
    period: null,
    time: null,
    serviceCandidates: null,
    quantity: null,
    ordinal: null,
  },
  signals: {
    purchaseIntent: null,
    priceSensitivity: null,
    sentiment: null,
    objection: null,
  },
  safety: { optOut: false, requestsHuman: false, emergency: false },
  confidence: 1,
  ambiguity: null,
};

describe("live Dental Understanding identity", () => {
  it("binds the closed identity to the actual OpenAI request", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(rawUnderstanding) } }],
    });
    const understanding = createLiveDentalUnderstanding({
      chat: { completions: { create } },
    });

    await expect(understanding.understand({
      leadMessage: "Quanto custa?",
      history: [],
      state: null,
      catalog: [],
    })).resolves.toMatchObject({ request: "price-of-service" });

    expect(understanding.modelId).toBe("gpt-4o-mini");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4o-mini" }),
    );
  });
});
