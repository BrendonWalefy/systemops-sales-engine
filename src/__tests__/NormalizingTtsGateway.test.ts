// O decorator NormalizingTtsGateway é o ponto único onde o texto é normalizado
// para fala. Garante que o gateway interno receba o texto já "falável" e que as
// opções sejam repassadas sem alteração.

import { describe, it, expect, vi } from "vitest";
import { NormalizingTtsGateway } from "@/infrastructure/adapters/ai/tts/normalizing-tts-gateway";
import type { TtsGateway } from "@/application/ports/tts-gateway";

describe("NormalizingTtsGateway", () => {
  it("normaliza o texto antes de delegar ao gateway interno", async () => {
    const synthesize = vi.fn().mockResolvedValue(new ArrayBuffer(8));
    const inner: TtsGateway = { synthesize };

    const gateway = new NormalizingTtsGateway(inner);
    await gateway.synthesize("Consulta às 14h por R$ 150 *confirmada* 😊");

    const [textArg] = synthesize.mock.calls[0];
    expect(textArg).toBe("Consulta às 14 horas por 150 reais confirmada");
  });

  it("repassa as opções (voz, formato, velocidade) sem alterar", async () => {
    const synthesize = vi.fn().mockResolvedValue(new ArrayBuffer(8));
    const inner: TtsGateway = { synthesize };

    const gateway = new NormalizingTtsGateway(inner);
    const options = { voice: "nova", format: "ogg" as const, speed: 1.1 };
    await gateway.synthesize("Olá", options);

    expect(synthesize).toHaveBeenCalledWith("Olá", options);
  });

  it("propaga o áudio retornado pelo gateway interno", async () => {
    const buffer = new ArrayBuffer(16);
    const inner: TtsGateway = { synthesize: vi.fn().mockResolvedValue(buffer) };

    const gateway = new NormalizingTtsGateway(inner);
    const result = await gateway.synthesize("teste");

    expect(result).toBe(buffer);
  });
});
