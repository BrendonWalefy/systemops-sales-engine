// Mensagem de localização escrita pela clínica. Campo livre de propósito: o sistema
// nunca calcula nada com "onde fica o estacionamento" — só imprime. Estruturar isso
// seria chumbar o formato de UMA clínica num prédio comercial.
import { describe, expect, it } from "vitest";
import { buildAddressAnswer } from "@/core/conversation/AddressBlock";

// Texto real da Aurora, escrito por quem o Silva contratou.
const AURORA = `🏢 Helbor Offices São Paulo II – Torre Sul

📍Av. Adolfo Pinheiro, 1.029 – Santo Amaro, Sala 124 – 12º andar
São Paulo/SP – CEP 04733-100

*🚗 Para acessar estacionamento do Prédio colocar endereço "Helbor Offices R. Nove de Julho número N72"*

🚊 Aproximadamente 10 minutos das estações Adolfo Pinheiro e Alto da Boa Vista.

🗺️ Localização:
https://maps.google.com/maps/place//data=!4m2!3m1!1s0x94ce50f9ce9af0e7:0xac33872639f0bf04?hl=pt`;

describe("buildAddressAnswer", () => {
  it("o texto da clínica sai INTEIRO, sem costura nossa em volta", () => {
    const answer = buildAddressAnswer({
      address: "Av. Adolfo Pinheiro, 1.029",
      addressComplement: "Sala 124",
      mapsUrl: "https://maps.google.com/outro",
      locationMessage: AURORA,
    });
    expect(answer).toBe(AURORA);
    // nada do template automático vaza para dentro
    expect(answer).not.toContain("Estamos na");
  });

  it("termina no link — é o que faz o encurtador e o card entrarem", () => {
    const answer = buildAddressAnswer({ address: "X", locationMessage: AURORA });
    expect(answer.trimEnd().endsWith("hl=pt")).toBe(true);
  });

  it("sem o campo, compõe do endereço como sempre — ninguém regride", () => {
    const answer = buildAddressAnswer({
      address: "Rua Guararapes, 1894 — Brooklin Novo",
      addressComplement: "Sala 3",
      mapsUrl: "https://maps.google.com/x",
    });
    expect(answer).toBe("📍 Estamos na Rua Guararapes, 1894 — Brooklin Novo.\nSala 3\nhttps://maps.google.com/x");
  });

  it("campo só com espaço não conta como preenchido", () => {
    const answer = buildAddressAnswer({ address: "Rua X", locationMessage: "   \n  " });
    expect(answer).toBe("📍 Estamos na Rua X.");
  });

  it("sem nada cadastrado, não inventa", () => {
    expect(buildAddressAnswer({ address: null, locationMessage: null })).toBe("");
  });
});
