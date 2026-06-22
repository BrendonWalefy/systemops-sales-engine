import { afterEach, describe, expect, it, vi } from "vitest";
import { ElevenLabsTtsGateway } from "@/infrastructure/adapters/ai/tts/elevenlabs-tts-gateway";

describe("ElevenLabsTtsGateway", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ELEVENLABS_API_KEY;
  });

  it("usa um output_format suportado pela ElevenLabs para notas de voz", async () => {
    process.env.ELEVENLABS_API_KEY = "test-key";

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const gateway = new ElevenLabsTtsGateway("voice-id", 0.35, 0.85);
    await gateway.synthesize("Olá, isso é um teste.", { speed: 0.95 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("output_format=opus_48000_128");
  });

  it("fixa o idioma português para evitar pronúncia em inglês", async () => {
    process.env.ELEVENLABS_API_KEY = "test-key";

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const gateway = new ElevenLabsTtsGateway("voice-id");
    await gateway.synthesize("Olá, tudo bem?");

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.language_code).toBe("pt");
  });
});
