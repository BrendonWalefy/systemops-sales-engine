// Encurtador dos links que saem no WhatsApp. Motivo: o WhatsApp sempre mostra a
// URL por escrito, e a do Maps que o operador usa tem ~180 caracteres — cinco
// linhas embaixo do card. O link curto do próprio Google resolve o tamanho mas
// perde a foto (medido: devolve og:title e og:description, não devolve og:image),
// então encurtar por conta própria é o único caminho para texto curto E foto.
import { describe, expect, it } from "vitest";
import {
  SHORTEN_THRESHOLD,
  buildShortUrl,
  shouldShorten,
  slugForUrl,
} from "@/application/messaging/short-link";

const MAPS_LONGO =
  "https://maps.google.com/maps/place//data=!4m2!3m1!1s0x94ce50f9ce9af0e7:0xac33872639f0bf04?entry=s&sa=X&ved=2ahUKEwil_KHf8PqUAxVTIbkGHYfrJTYQ4kB6BAghEAA&hl=pt";

describe("slugForUrl", () => {
  it("é determinístico — o mesmo endereço enviado 137 vezes gera UMA linha", () => {
    expect(slugForUrl(MAPS_LONGO)).toBe(slugForUrl(MAPS_LONGO));
  });

  it("URLs diferentes geram slugs diferentes", () => {
    expect(slugForUrl(MAPS_LONGO)).not.toBe(slugForUrl(`${MAPS_LONGO}&x=1`));
  });

  it("slug é curto e seguro para URL", () => {
    const slug = slugForUrl(MAPS_LONGO);
    expect(slug).toHaveLength(7);
    expect(slug).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("shouldShorten", () => {
  it("encurta o link real do operador", () => {
    expect(MAPS_LONGO.length).toBeGreaterThan(SHORTEN_THRESHOLD);
    expect(shouldShorten(MAPS_LONGO)).toBe(true);
  });

  it("não encurta link que já é curto — trocaria legível por opaco", () => {
    expect(shouldShorten("https://share.google/NRzU7M2A74cL1gsev")).toBe(false);
    expect(shouldShorten("https://instagram.com/clinicaaurora")).toBe(false);
  });

  it("não encurta o que não é buscável", () => {
    expect(shouldShorten(`http://127.0.0.1/${"a".repeat(80)}`)).toBe(false);
    expect(shouldShorten(`file:///tmp/${"a".repeat(80)}`)).toBe(false);
  });
});

describe("buildShortUrl", () => {
  it("monta a URL pública com o domínio do app", () => {
    expect(buildShortUrl("abc1234")).toMatch(/^https?:\/\/.+\/l\/abc1234$/);
  });

  it("o resultado cabe em uma linha do WhatsApp", () => {
    expect(buildShortUrl(slugForUrl(MAPS_LONGO)).length).toBeLessThan(45);
  });
});
