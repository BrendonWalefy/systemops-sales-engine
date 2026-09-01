/** Exact installment for a registered flat card rate, in the principal minor unit. */
export function calculateFlatInstallment(
  principal: number,
  flatRatePercent: number,
  installments: number,
): number {
  return Math.ceil(principal / (1 - flatRatePercent / 100) / installments);
}
