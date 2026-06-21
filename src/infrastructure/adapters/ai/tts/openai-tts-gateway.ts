import type { TtsGateway, TtsRequest } from "@/application/ports/tts-gateway";

// nova: voz feminina calorosa, ótima para PT-BR conversacional
// shimmer: alternativa mais leve/expressiva
const VOICE_DEFAULT = "nova";
const FORMAT_DEFAULT = "mp3";
const TIMEOUT_MS = 20_000;
// 0.92 soa mais natural em português brasileiro do que o padrão 1.0
const SPEED_DEFAULT = 0.92;

/**
 * Remove formatação markdown e emojis antes de enviar ao TTS.
 * WhatsApp usa *negrito*, _itálico_ e emojis — o modelo TTS lê esses caracteres
 * literalmente ou produz pausas indesejadas.
 */
// Ordinais 1º..10º / 1ª..10ª por extenso (índice = número).
const ORDINAIS_MASC = ["", "primeiro", "segundo", "terceiro", "quarto", "quinto", "sexto", "sétimo", "oitavo", "nono", "décimo"];
const ORDINAIS_FEM = ["", "primeira", "segunda", "terceira", "quarta", "quinta", "sexta", "sétima", "oitava", "nona", "décima"];

export function sanitizeForTts(text: string): string {
  return text
    // Converte R$ <valor> por extenso (ex: R$2.500 -> 2.500 reais) para melhor pronúncia no TTS
    .replace(/R\$\s*(\d+(?:\.\d{3})*)(?:,(\d{2}))?\b/gi, (match, integerPart, centsPart) => {
      const rawInt = integerPart.replace(/\./g, "");
      const valInt = parseInt(rawInt, 10);
      if (isNaN(valInt)) return match;

      const isSingularInt = valInt === 1;
      const isZeroInt = valInt === 0;

      let result = "";
      if (!isZeroInt) {
        result += `${integerPart} ${isSingularInt ? "real" : "reais"}`;
      }

      if (centsPart && centsPart !== "00") {
        const valCents = parseInt(centsPart, 10);
        const isSingularCents = valCents === 1;
        const centsText = `${valCents} ${isSingularCents ? "centavo" : "centavos"}`;
        if (result) {
          result += ` e ${centsText}`;
        } else {
          result = centsText;
        }
      } else if (isZeroInt) {
        result = "0 reais";
      }

      return result;
    })
    // Converte datas abreviadas por extenso (ex: 22/06 -> 22 de junho, 22/06/2026 -> 22 de junho de 2026)
    .replace(/\b([0-2]?\d|3[01])\/(0?\d|1[0-2])(?:\/(\d{2,4}))?\b/g, (match, dayStr, monthStr, yearStr) => {
      const day = parseInt(dayStr, 10);
      const month = parseInt(monthStr, 10);
      if (day === 0 || month === 0) return match;

      // Evita confundir frações simples como "1/2" ou "3/4" com datas, a menos que venham com ano (ex: "1/2/26")
      const isSingleDigitFraction = dayStr.length === 1 && monthStr.length === 1 && !yearStr;
      if (isSingleDigitFraction) return match;

      const monthsFull = [
        "", "janeiro", "fevereiro", "março", "abril", "maio", "junho",
        "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"
      ];

      let result = `${day} de ${monthsFull[month]}`;
      if (yearStr) {
        const year = yearStr.length === 2 ? `20${yearStr}` : yearStr;
        result += ` de ${year}`;
      }
      return result;
    })
    // Converte horários para a forma falada (ex: 14h -> "14 horas", 14h30 -> "14 horas e 30 minutos",
    // 9:00 -> "9 horas"). Sem isso o TTS lê "14h" como "catorze agá" e erra "14:30".
    .replace(/\b([01]?\d|2[0-3])(?:h([0-5]\d)?|:([0-5]\d))(?![a-zA-Z\d])/g, (match, hStr, hMin, colonMin) => {
      const hour = parseInt(hStr, 10);
      const minStr = hMin ?? colonMin;
      const hourWord = hour === 1 ? "hora" : "horas";
      if (!minStr || minStr === "00") return `${hour} ${hourWord}`;
      const min = parseInt(minStr, 10);
      const minWord = min === 1 ? "minuto" : "minutos";
      return `${hour} ${hourWord} e ${min} ${minWord}`;
    })
    // Títulos e abreviações comuns (exigem o ponto para não estragar nomes como "Drummond")
    .replace(/\bDra\./gi, "doutora")
    .replace(/\bDr\./gi, "doutor")
    .replace(/\bSra\./gi, "senhora")
    .replace(/\bSr\./gi, "senhor")
    // "nº 5" / "n° 5" -> "número 5" (só o símbolo ordinal, nunca a palavra "no")
    .replace(/n[º°]\s*(?=\d)/gi, "número ")
    // "50%" -> "50 por cento"
    .replace(/(\d+)\s*%/g, "$1 por cento")
    // "A & B" -> "A e B"
    .replace(/\s*&\s*/g, " e ")
    // Ordinais 1º..10º / 1ª..10ª por extenso (fora dessa faixa fica inalterado)
    .replace(/\b(\d{1,2})([ºª°])/g, (match, numStr, marker) => {
      const num = parseInt(numStr, 10);
      if (num < 1 || num > 10) return match;
      return marker === "ª" ? ORDINAIS_FEM[num] : ORDINAIS_MASC[num];
    })
    // Remove emojis (blocos Unicode de símbolos e pictogramas)
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}]/gu, "")
    // Remove marcação WhatsApp: *negrito*, _itálico_, ~tachado~, `código`
    .replace(/[*_~`]/g, "")
    // Remove bullet points (• e variantes) — lidos literalmente pelo TTS
    .replace(/[•·–—]/g, "")
    // Parágrafo duplo → pausa de frase (ponto)
    .replace(/\n{2,}/g, ". ")
    // Quebra simples → espaço; vírgula causaria "dois ponto cinco vírgula um ponto Seg..."
    .replace(/\n/g, " ")
    // Colapsa espaços múltiplos
    .replace(/  +/g, " ")
    // Ponto duplicado que pode surgir da transformação acima
    .replace(/\.\s*\./g, ".")
    .trim();
}

export class OpenAiTtsGateway implements TtsGateway {
  async synthesize(text: string, options?: TtsRequest): Promise<ArrayBuffer> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY must be set");

    const cleanText = sanitizeForTts(text);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "tts-1-hd",
          input: cleanText,
          voice: options?.voice ?? VOICE_DEFAULT,
          response_format: options?.format ?? FORMAT_DEFAULT,
          speed: options?.speed ?? SPEED_DEFAULT,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI TTS failed (${res.status}): ${err}`);
    }

    return res.arrayBuffer();
  }
}
