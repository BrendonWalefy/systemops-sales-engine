import { describe, expect, it, vi } from "vitest";
import {
  assertRegisteredLiveDentalUnderstanding,
  createLiveDentalUnderstanding,
  LiveDentalUnderstanding,
} from "@/infrastructure/adapters/ai/live-dental-understanding";

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

const input = {
  leadMessage: "Quanto custa?",
  history: [],
  state: null,
  catalog: [],
} as const;

async function invokeAfterRegistration(value: LiveDentalUnderstanding): Promise<void> {
  assertRegisteredLiveDentalUnderstanding(value);
  await value.understand(input);
}

describe("live Dental Understanding identity", () => {
  it("binds the closed identity to the actual OpenAI request", async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(rawUnderstanding) } }],
    });
    const understanding = createLiveDentalUnderstanding({
      chat: { completions: { create } },
    });

    expect(() => assertRegisteredLiveDentalUnderstanding(understanding)).not.toThrow();
    await expect(understanding.understand(input)).resolves.toMatchObject({ request: "price-of-service" });

    expect(understanding.modelId).toBe("gpt-4o-mini");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gpt-4o-mini" }),
    );
  });

  it("rejects Reflect.construct prototype forgery before the fake provider can run", async () => {
    const fakeUnderstand = vi.fn().mockResolvedValue(rawUnderstanding);
    const forged = Reflect.construct(LiveDentalUnderstanding, [{
      understand: fakeUnderstand,
    }]) as LiveDentalUnderstanding;

    await expect(invokeAfterRegistration(forged)).rejects.toThrow(
      "unregistered live dental understanding provider",
    );
    expect(fakeUnderstand).not.toHaveBeenCalled();
  });

  it("rejects Object.create prototype forgery before the fake provider can run", async () => {
    const fakeUnderstand = vi.fn().mockResolvedValue(rawUnderstanding);
    const forged = Object.create(LiveDentalUnderstanding.prototype) as LiveDentalUnderstanding;
    Object.defineProperties(forged, {
      modelId: { value: "gpt-4o-mini", enumerable: true },
      provider: { value: { understand: fakeUnderstand }, enumerable: false },
    });
    Object.freeze(forged);

    await expect(invokeAfterRegistration(forged)).rejects.toThrow(
      "unregistered live dental understanding provider",
    );
    expect(fakeUnderstand).not.toHaveBeenCalled();
  });
});
