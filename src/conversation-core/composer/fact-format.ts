import type { FactValue } from "@/conversation-core/decision";

/** Como um valor autorizado chega aos olhos do leitor. */
export function formatFactValue(value: FactValue): string {
  if (value.kind === "display_text") return value.value;
  if (value.kind === "money") {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: value.currency,
    }).format(value.amountInMinor / 100).replace(/\u00a0/g, " ");
  }
  if (value.kind === "boolean") return value.value ? "sim" : "não";
  return String(value.value);
}
