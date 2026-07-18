#!/usr/bin/env tsx
/**
 * Config da Vitalli para as 4 melhorias conversacionais (PRs #171–#174).
 *
 * ⚠️ GATED: dry-run por padrão. Só grava com `--apply`. Requer que as migrações
 * 0068–0070 já tenham rodado em produção (colunas quantity_prices, booking_windows,
 * deposit_*). Idempotente: rodar de novo apenas reafirma os valores.
 *
 *   Dry-run:  npx dotenv -e .env.local -- npx tsx scripts/apply-vitalli-conversation-config.ts
 *   Aplicar:  npx dotenv -e .env.local -- npx tsx scripts/apply-vitalli-conversation-config.ts --apply
 *
 * Valores CONFIRMADOS (memória prospect-vitalli, promo vigente). Quantidades ad-hoc que
 * a Gleice cotou fora da tabela (9=1.600, 16=1.800, 10-inferior=1.700) ficam DE FORA de
 * propósito — caem no escalonamento "confirmo com a equipe" (comportamento seguro) até o
 * Victor confirmar a regra.
 */
import "dotenv/config";
import { db } from "../src/infrastructure/db/client";
import { organizations, treatments } from "../src/infrastructure/db/schema";
import { and, eq } from "drizzle-orm";
import type {
  TreatmentQuantityPrice,
  TreatmentBookingWindow,
} from "../src/domain/entities/treatment";

const VITALLI_ID = "d24a584a-faac-4a46-9750-a718d0f8e686";
const APPLY = process.argv.includes("--apply");

// Lentes só começam 09:00 e 16:00 (Seg-Sáb, herdando os dias do businessHours).
const LENTES_WINDOWS: TreatmentBookingWindow[] = [
  { startHour: 9, startMinute: 0 },
  { startHour: 16, startMinute: 0 },
];

// Preços por quantidade — PROMO VIGENTE (confirmado).
const SIMPLIFICADA_QTY: TreatmentQuantityPrice[] = [
  { quantity: 10, priceCents: 150000 },
  { quantity: 20, priceCents: 180000 },
];
const ESTRATIFICADA_QTY: TreatmentQuantityPrice[] = [
  { quantity: 10, priceCents: 180000 },
  { quantity: 20, priceCents: 200000 },
];

// Nome do tratamento → { quantityPrices?, bookingWindows? }
const TREATMENT_CONFIG: Record<string, {
  quantityPrices?: TreatmentQuantityPrice[];
  bookingWindows?: TreatmentBookingWindow[];
  priceUnit?: string;
}> = {
  "Técnica Simplificada": { quantityPrices: SIMPLIFICADA_QTY, bookingWindows: LENTES_WINDOWS, priceUnit: "lentes" },
  "Técnica Estratificada": { quantityPrices: ESTRATIFICADA_QTY, bookingWindows: LENTES_WINDOWS, priceUnit: "lentes" },
  "Lentes em Resina Composta": { bookingWindows: LENTES_WINDOWS },
  "Avaliação Clínica Inicial": { bookingWindows: LENTES_WINDOWS },
  "Remoção de lentes": { bookingWindows: LENTES_WINDOWS },
};

const DEPOSIT_CONFIG = {
  depositEnabled: true,
  depositAmountCents: 3000,
  depositPixKey: "54659849000109",
  depositPixKeyType: "cnpj" as const,
  depositRecipientName: "Dr. Victor Cavalcante",
  depositTtlHours: 24,
  depositNotes: "O valor do sinal é integralmente abatido do procedimento no dia.",
  depositConfirmationNotes:
    "• Chegue com 10 minutos de antecedência.\n• Reagendamentos com no mínimo 24h de antecedência.\n• Evite trazer acompanhante.",
};

async function main() {
  console.log(`\n=== Config conversacional Vitalli — ${APPLY ? "APLICANDO" : "DRY-RUN (use --apply)"} ===\n`);

  const rows = await db
    .select({ id: treatments.id, name: treatments.name, priceUnit: treatments.priceUnit })
    .from(treatments)
    .where(eq(treatments.clinicId, VITALLI_ID));

  for (const [name, cfg] of Object.entries(TREATMENT_CONFIG)) {
    const t = rows.find((r) => r.name === name);
    if (!t) {
      console.log(`  ⚠️  tratamento não encontrado: "${name}" — pulando`);
      continue;
    }
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (cfg.quantityPrices) patch.quantityPrices = cfg.quantityPrices;
    if (cfg.bookingWindows) patch.bookingWindows = cfg.bookingWindows;
    if (cfg.priceUnit && !t.priceUnit) patch.priceUnit = cfg.priceUnit;

    console.log(`  ${name}:`);
    if (cfg.quantityPrices) console.log(`     quantityPrices = ${cfg.quantityPrices.map((q) => `${q.quantity}=R$${q.priceCents / 100}`).join(", ")}`);
    if (cfg.bookingWindows) console.log(`     bookingWindows = ${cfg.bookingWindows.map((w) => `${w.startHour}:${String(w.startMinute).padStart(2, "0")}`).join(", ")}`);

    if (APPLY) {
      await db.update(treatments).set(patch).where(and(eq(treatments.id, t.id), eq(treatments.clinicId, VITALLI_ID)));
    }
  }

  console.log(`\n  organizations (deposit):`);
  console.log(`     ${DEPOSIT_CONFIG.depositAmountCents / 100} via Pix ${DEPOSIT_CONFIG.depositPixKey} (${DEPOSIT_CONFIG.depositRecipientName}), TTL ${DEPOSIT_CONFIG.depositTtlHours}h`);
  if (APPLY) {
    await db.update(organizations).set({ ...DEPOSIT_CONFIG, updatedAt: new Date() }).where(eq(organizations.id, VITALLI_ID));
  }

  console.log(`\n${APPLY ? "✅ Aplicado." : "ℹ️  Dry-run — nada gravado. Rode com --apply para efetivar."}`);
  console.log("\n⚠️  PENDENTE (manual, fora deste script):");
  console.log("   - Nova versão de playbook com preços 10/20 explícitos (sem 'informado acima')");
  console.log("     e objeção 'vocês me passaram um preço menor antes'. Fazer pelo painel/owner.");
  console.log("   - Confirmar com o Victor a regra de quantidades ad-hoc (9, 16, só-superior).\n");

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
