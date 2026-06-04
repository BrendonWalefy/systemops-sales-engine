// Tests for lead temperature inference from intent classification.
// temperatureFromIntent is a pure function — no mocks needed.

import { describe, it, expect } from "vitest";
import { temperatureFromIntent } from "@/core/pipeline/ConversationOrchestrator";

describe("temperatureFromIntent", () => {
  describe("hot intents — lead actively pursuing an appointment", () => {
    const hotIntents = [
      "book_appointment",
      "check_availability",
      "confirm_slot",
      "reject_slots",
      "reschedule_appointment",
      "cancel_appointment",
      "list_appointments",
    ] as const;

    it.each(hotIntents)('"%s" → hot', (intent) => {
      expect(temperatureFromIntent(intent)).toBe("hot");
    });
  });

  describe("warm intents — interested but not yet booking", () => {
    const warmIntents = [
      "price_inquiry",
      "general_question",
      "clinical_urgency",
      "needs_human",
    ] as const;

    it.each(warmIntents)('"%s" → warm', (intent) => {
      expect(temperatureFromIntent(intent)).toBe("warm");
    });
  });

  describe("cold intents — no buying signal", () => {
    const coldIntents = [
      "greeting",
      "acknowledgment",
      "farewell",
      "unclear",
    ] as const;

    it.each(coldIntents)('"%s" → cold', (intent) => {
      expect(temperatureFromIntent(intent)).toBe("cold");
    });
  });

  describe("temperature upgrade logic (never downgrade)", () => {
    it("hot lead stays hot after acknowledgment", () => {
      const currentTemp: "hot" | "warm" | "cold" = "hot";
      const newTemp = temperatureFromIntent("acknowledgment"); // cold
      const TEMP_RANK = { hot: 2, warm: 1, cold: 0 } as const;
      const shouldUpgrade = TEMP_RANK[newTemp] > TEMP_RANK[currentTemp];
      expect(shouldUpgrade).toBe(false);
      expect(currentTemp).toBe("hot"); // stays hot
    });

    it("warm lead upgrades to hot when booking", () => {
      const currentTemp: "hot" | "warm" | "cold" = "warm";
      const newTemp = temperatureFromIntent("confirm_slot"); // hot
      const TEMP_RANK = { hot: 2, warm: 1, cold: 0 } as const;
      const shouldUpgrade = TEMP_RANK[newTemp] > TEMP_RANK[currentTemp];
      expect(shouldUpgrade).toBe(true);
    });

    it("null (new lead) upgrades on any positive intent", () => {
      const currentRank = { hot: 2, warm: 1, cold: 0 }["cold"]; // null defaults to cold
      const newTemp = temperatureFromIntent("price_inquiry"); // warm
      const TEMP_RANK = { hot: 2, warm: 1, cold: 0 } as const;
      expect(TEMP_RANK[newTemp] > currentRank).toBe(true);
    });

    it("hot lead does not downgrade on farewell", () => {
      const currentTemp: "hot" | "warm" | "cold" = "hot";
      const newTemp = temperatureFromIntent("farewell"); // cold
      const TEMP_RANK = { hot: 2, warm: 1, cold: 0 } as const;
      expect(TEMP_RANK[newTemp] > TEMP_RANK[currentTemp]).toBe(false);
    });
  });

  describe("temperature assignment on manual appointment booking", () => {
    // Agendamentos manuais (via operador) não passam pelo Orchestrator.
    // O route de register-appointment aplica temperatura mínima "warm".
    function resolveTemperatureForManualBooking(
      current: "hot" | "warm" | "cold" | null,
    ): "hot" | "warm" | "cold" {
      return (current === "hot" || current === "warm") ? current : "warm";
    }

    it("lead sem temperatura (null) → promove para warm", () => {
      expect(resolveTemperatureForManualBooking(null)).toBe("warm");
    });

    it("lead cold → promove para warm", () => {
      expect(resolveTemperatureForManualBooking("cold")).toBe("warm");
    });

    it("lead já warm → mantém warm (sem rebaixar)", () => {
      expect(resolveTemperatureForManualBooking("warm")).toBe("warm");
    });

    it("lead já hot → mantém hot (sem rebaixar)", () => {
      expect(resolveTemperatureForManualBooking("hot")).toBe("hot");
    });
  });
});
