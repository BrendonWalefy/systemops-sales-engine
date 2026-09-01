export const PAYMENT_METHOD_OPTIONS = Object.freeze([
  Object.freeze({ code: "pix", label: "Pix" }),
  Object.freeze({ code: "credit_card", label: "Cartão de crédito" }),
  Object.freeze({ code: "debit_card", label: "Cartão de débito" }),
  Object.freeze({ code: "cash", label: "Dinheiro" }),
  Object.freeze({ code: "bank_transfer", label: "Transferência bancária" }),
  Object.freeze({ code: "invoice", label: "Boleto" }),
] as const);

export type PaymentMethod = (typeof PAYMENT_METHOD_OPTIONS)[number]["code"];

export const PAYMENT_METHOD_CODES = Object.freeze(
  PAYMENT_METHOD_OPTIONS.map(({ code }) => code),
) as readonly PaymentMethod[];
