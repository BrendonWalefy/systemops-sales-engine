// Pré-visualização de link. O caso que motivou: o endereço enviado pela SystemOps
// chegava ao WhatsApp como link pelado, enquanto o mesmo link colado à mão vira um
// card com foto do prédio — porque quem monta o card é o app de quem envia, e a
// Z-API não faz esse passo.
import { describe, expect, it } from "vitest";
import {
  extractTrailingUrl,
  isFetchableUrl,
  parseLinkPreviewHtml,
} from "@/application/messaging/link-preview";

// Trecho fiel do que o Google devolveu para o link do operador da Vitalli quando
// puxado com user-agent de bot de pré-visualização. Repare na ORDEM: `content`
// vem ANTES de `property` — um parser que só cobrisse a ordem canônica não
// acharia nada exatamente no caso real.
const GOOGLE_MAPS_HTML = `
<html><head><title> Google Maps </title>
<meta content="Helbor Offices São Paulo II · Av. Adolfo Pinheiro, 1.029 - Santo Amaro, São Paulo - SP, 04733-100" property="og:title">
<meta content="★★★★★ · Área de escritórios" property="og:description">
<meta content="https://lh3.googleusercontent.com/gps-cs-s/AHRPTWmCW4qqdGHspuw-P-dWgzu5JA" property="og:image">
<meta content="900" property="og:image:width">
</head><body></body></html>`;

describe("parseLinkPreviewHtml", () => {
  it("extrai o card real do Google Maps, com content antes de property", () => {
    const preview = parseLinkPreviewHtml(GOOGLE_MAPS_HTML, "https://maps.google.com/x");
    expect(preview.title).toBe(
      "Helbor Offices São Paulo II · Av. Adolfo Pinheiro, 1.029 - Santo Amaro, São Paulo - SP, 04733-100",
    );
    expect(preview.description).toBe("★★★★★ · Área de escritórios");
    expect(preview.imageUrl).toBe("https://lh3.googleusercontent.com/gps-cs-s/AHRPTWmCW4qqdGHspuw-P-dWgzu5JA");
  });

  it("aceita a ordem canônica property→content", () => {
    const html = `<meta property="og:title" content="Clínica X"><meta property="og:image" content="https://cdn.x/y.jpg">`;
    const preview = parseLinkPreviewHtml(html, "https://x.com");
    expect(preview.title).toBe("Clínica X");
    expect(preview.imageUrl).toBe("https://cdn.x/y.jpg");
  });

  it("cai para <title> quando não há Open Graph", () => {
    const preview = parseLinkPreviewHtml("<html><head><title>Site simples</title></head></html>", "https://x.com");
    expect(preview.title).toBe("Site simples");
    expect(preview.imageUrl).toBeNull();
  });

  it("decodifica entidades — a URL da imagem do Google vem com &amp;", () => {
    const html = `<meta content="https://x.com/i?a=1&amp;b=2" property="og:image"><meta content="A &amp; B" property="og:title">`;
    const preview = parseLinkPreviewHtml(html, "https://x.com");
    expect(preview.imageUrl).toBe("https://x.com/i?a=1&b=2");
    expect(preview.title).toBe("A & B");
  });

  it("decodifica entidades NUMÉRICAS — o Instagram serve o título inteiro assim", () => {
    // Achado puxando o link de verdade: sem isto o card chega ao lead com
    // "v&#xed;deos" e "&#064;clinicavitalli" literais no texto.
    const html =
      `<meta content="Cl&#xed;nica (&#064;clinicavitalli) &#x2022; Fotos e v&#xed;deos" property="og:title">` +
      `<meta content="23 seguidores &#8212; veja" property="og:description">`;
    const preview = parseLinkPreviewHtml(html, "https://instagram.com/x");
    expect(preview.title).toBe("Clínica (@clinicavitalli) • Fotos e vídeos");
    expect(preview.description).toBe("23 seguidores — veja");
  });

  it("entidade numérica inválida não derruba o parser", () => {
    const html = `<meta content="A&#x110000;B&#99999999;C" property="og:title">`;
    expect(parseLinkPreviewHtml(html, "https://x.com").title).toBe("ABC");
  });

  it("página sem og:image ainda vira card — título é o requisito", () => {
    // O link encurtado do Maps (share.google) dá título e descrição mas não dá
    // imagem. Testado em produção: a Z-API aceita e o WhatsApp desenha o card
    // sem foto. Exigir imagem faria esse caso regredir para link pelado.
    const html = `<meta content="Helbor Offices São Paulo II · São Paulo - SP" property="og:title">` +
      `<meta content="4.5 ⭐ · Área de escritórios em São Paulo" property="og:description">`;
    const preview = parseLinkPreviewHtml(html, "https://share.google/x");
    expect(preview.title).toBeTruthy();
    expect(preview.imageUrl).toBeNull();
  });

  it("descarta imagem em host interno", () => {
    const html = `<meta content="Título" property="og:title"><meta content="http://127.0.0.1/x.png" property="og:image">`;
    expect(parseLinkPreviewHtml(html, "https://x.com").imageUrl).toBeNull();
  });

  it("mantém og:image longa — a do Google embute a origem em base64 (~1300 chars)", () => {
    // Bug real: a og:image do link da Ximendes tinha 1290 caracteres e o teto de
    // 1000 (feito para a URL que BUSCAMOS) derrubava a foto de todo link do Google.
    // A imagem nós só repassamos ao WhatsApp, nunca buscamos — comprimento não vale.
    const longImg = "https://dimg-pa.googleapis.com/ic/" + "A".repeat(1300);
    const html = `<meta content="Dr Gregorie" property="og:title"><meta content="${longImg}" property="og:image">`;
    const preview = parseLinkPreviewHtml(html, "https://share.google/x");
    expect(preview.imageUrl).toBe(longImg);
  });
});

describe("extractTrailingUrl", () => {
  it("reconhece o link no fim da resposta de endereço", () => {
    const msg =
      "📍 Estamos na Av. Adolfo Pinheiro, 1.029 - Santo Amaro.\n" +
      "Sala 124, Andar 12\n" +
      "https://maps.google.com/maps/place//data=!4m2!3m1!1s0x94ce50f9ce9af0e7:0xac33872639f0bf04?hl=pt";
    expect(extractTrailingUrl(msg)).toBe(
      "https://maps.google.com/maps/place//data=!4m2!3m1!1s0x94ce50f9ce9af0e7:0xac33872639f0bf04?hl=pt",
    );
  });

  it("link no MEIO não vira card — a Z-API exige o link no fim", () => {
    // Sem isso, o card sairia com a mensagem truncada ou não sairia.
    expect(extractTrailingUrl("Veja https://maps.google.com/x e me diga se dá certo")).toBeNull();
  });

  it("pontuação final não entra na URL", () => {
    expect(extractTrailingUrl("O endereço é https://maps.google.com/x.")).toBe("https://maps.google.com/x");
  });

  it("mensagem sem link nenhum", () => {
    expect(extractTrailingUrl("Bom dia! Podemos agendar?")).toBeNull();
  });
});

describe("isFetchableUrl — o servidor passa a buscar URL, então fecha o óbvio", () => {
  it("aceita http e https públicos", () => {
    expect(isFetchableUrl("https://maps.google.com/x")).toBe(true);
    expect(isFetchableUrl("http://exemplo.com.br")).toBe(true);
  });

  it("recusa endereço interno e metadados de nuvem", () => {
    for (const url of [
      "http://localhost:3000/admin",
      "http://127.0.0.1/x",
      "http://10.0.0.5/x",
      "http://192.168.0.1/x",
      "http://172.16.0.1/x",
      "http://169.254.169.254/latest/meta-data/",
      "http://metadata.google.internal/x",
    ]) {
      expect(isFetchableUrl(url), url).toBe(false);
    }
  });

  it("recusa esquema que não é http(s)", () => {
    expect(isFetchableUrl("file:///etc/passwd")).toBe(false);
    expect(isFetchableUrl("ftp://x.com/a")).toBe(false);
    expect(isFetchableUrl("javascript:alert(1)")).toBe(false);
  });

  it("recusa URL absurdamente longa", () => {
    expect(isFetchableUrl(`https://x.com/${"a".repeat(1200)}`)).toBe(false);
  });
});
