export const USD_TO_BRL = 5.15;
export const VERCEL_PRO_PLATFORM_FEE_USD_CENTS = 2_000;

export function usdCentsToBrlCents(usdCents: number): number {
  return Math.round((usdCents / 100) * USD_TO_BRL * 100);
}

// Vercel Spend Management sends these integer amounts in whole USD.
export function vercelSpendUsdToBrlCents(usd: number): number {
  return Math.round(usd * USD_TO_BRL * 100);
}
