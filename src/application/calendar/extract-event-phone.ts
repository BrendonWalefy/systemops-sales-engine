/**
 * Telefone do paciente a partir do texto livre do evento do Google Calendar.
 *
 * O bloqueio medido (Aurora, 21/07): o import cria o lead com `phone: null`,
 * porque o evento da agenda não carrega contato. Resultado — das 6 próximas
 * consultas de lentes, **5 não têm telefone**. O cuidado pós-lente e o lembrete
 * de 24h existem, disparam, e não têm para onde ir.
 *
 * A descrição do evento já chega no import (o gateway mapeia `description`) e
 * nunca foi lida. Combinado com o cliente em 21/07: o operador passa a escrever
 * o número na descrição do evento.
 *
 * O texto é livre e mistura valor, data, hora e observação — então o extrator
 * precisa recusar o que PARECE telefone antes de aceitar o que é. Um falso
 * positivo aqui não é um número inválido: é a mensagem de pós-operatório de uma
 * paciente indo para o WhatsApp de um estranho.
 */

import { normalizeManualWhatsAppPhone } from "@/core/whatsapp/WhatsAppContactIdentity";

/**
 * Trechos que nunca são telefone, mascarados antes da busca.
 *
 * Sem isso, "20 lentes R$ 2.000 — 22/07/2026 16:00" oferece dígitos suficientes
 * para o extrator montar um número plausível a partir de pedaços de coisas
 * diferentes. Mascarar é mais seguro que tentar desambiguar depois: o que foi
 * reconhecido como valor/data/hora sai do jogo.
 */
const RUIDOS: RegExp[] = [
  /R\$\s*[\d.,]+/gi, // valor: R$ 2.000, R$1.500,00
  /\b\d{1,2}\s*\/\s*\d{1,2}(?:\s*\/\s*\d{2,4})?\b/g, // data: 22/07, 22/07/2026
  /\b\d{1,2}\s*[:h]\s*\d{2}\b/gi, // hora: 16:00, 16h30
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, // CPF
  /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, // CNPJ
];

/**
 * Candidato a telefone: DDI opcional, DDD (com ou sem parênteses), corpo de 8
 * ou 9 dígitos. Aceita espaço, ponto e hífen como separador — que é como o
 * número é digitado à mão.
 *
 * Sticky de propósito: a varredura testa CADA posição do texto. Com busca
 * global, um candidato inválido é consumido e leva junto o número válido que
 * vinha logo depois ("2000 11900000007" casava "00 11921525" primeiro, com DDD
 * "00", e o telefone real morria no resto). Reavaliar posição a posição custa
 * uma passada linear numa descrição curta.
 */
const CANDIDATO = /(?:\+\s?)?(?:55[\s.-]?)?\(?\s?\d{2}\s?\)?[\s.-]?9?[\s.-]?\d{4}[\s.-]?\d{4}/y;

/** DDDs brasileiros existentes: 11–19, 21–24, 27–28, 31–38, … 91–99. */
function dddValido(ddd: string): boolean {
  const n = Number(ddd);
  if (n < 11 || n > 99) return false;
  // O dígito final 0 nunca é DDD; o resto da faixa é conservador de propósito —
  // recusar um DDD real custa um telefone não importado, aceitar um falso custa
  // uma mensagem clínica para a pessoa errada.
  return n % 10 !== 0;
}

/** 11111111111, 99999999999: preenchimento, não contato. */
function digitosRepetidos(digits: string): boolean {
  return new Set(digits).size <= 1;
}

/**
 * Valida a forma brasileira depois de reduzir a dígitos:
 *  10 = DDD + 8 (fixo) · 11 = DDD + 9 (móvel) · 12/13 = 55 + os anteriores.
 * Móvel brasileiro começa com 9 desde 2016 — exigir isso descarta sequências
 * de 11 dígitos que só por acaso têm o tamanho certo.
 */
function formaBrasileiraValida(digits: string): boolean {
  if (digitosRepetidos(digits)) return false;

  const semDdi = digits.startsWith("55") && (digits.length === 12 || digits.length === 13)
    ? digits.slice(2)
    : digits;

  if (semDdi.length !== 10 && semDdi.length !== 11) return false;
  if (!dddValido(semDdi.slice(0, 2))) return false;

  const corpo = semDdi.slice(2);
  // Móvel brasileiro começa com 9 desde 2016.
  if (corpo.length === 9 && !corpo.startsWith("9")) return false;
  // Fixo: primeiro dígito 2–5 (0/1 não iniciam assinante; 6–9 são móveis).
  if (corpo.length === 8 && !/^[2-5]/.test(corpo)) return false;

  return true;
}

/**
 * Devolve o telefone em E.164 sem "+" (5511999999999), ou null.
 *
 * Com mais de um candidato válido, vence o PRIMEIRO — a descrição escrita à mão
 * põe o contato do paciente antes de qualquer número de referência, e escolher
 * o último inverteria essa ordem sem ganho.
 */
export function extractEventPhone(text: string | null | undefined): string | null {
  if (!text) return null;

  let limpo = text;
  for (const ruido of RUIDOS) limpo = limpo.replace(ruido, " ");

  const scanner = new RegExp(CANDIDATO.source, "y");

  for (let i = 0; i < limpo.length; i += 1) {
    scanner.lastIndex = i;
    const achado = scanner.exec(limpo);
    if (!achado) continue;

    // Recorte no meio de uma sequência maior não é telefone: é pedaço de outra
    // coisa (código, id, sequência numérica) do tamanho certo por acaso.
    const antes = limpo[i - 1];
    const depois = limpo[i + achado[0].length];
    if (/\d/.test(antes ?? "") || /\d/.test(depois ?? "")) continue;

    const digits = achado[0].replace(/\D/g, "");
    if (!formaBrasileiraValida(digits)) continue;

    const normalizado = normalizeManualWhatsAppPhone(digits);
    if (normalizado) return normalizado;
  }

  return null;
}

/**
 * Telefone do evento, preferindo a descrição.
 *
 * O título é o que o operador digita com pressa e é onde mora o texto comercial
 * ("20 lentes R$ 2.000"); a descrição é o campo combinado para o contato. Ler os
 * dois amplia a captura, mas a ordem importa: descrição primeiro.
 */
export function extractCalendarEventPhone(event: {
  description?: string | null;
  summary?: string | null;
}): string | null {
  return extractEventPhone(event.description) ?? extractEventPhone(event.summary);
}
