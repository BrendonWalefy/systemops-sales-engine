-- Anti-double-booking no nível do banco: a unique (clinic_id, starts_at) só
-- bloqueia colisão EXATA de início — duas reservas sobrepostas com starts_at
-- diferentes (ex: 13:00-14:00 e 13:30-14:30) passavam. O pré-check de overlap
-- no SlotReservationService é check-then-insert (TOCTOU) e não segura
-- concorrência. A exclusion constraint torna o INSERT/UPDATE atômico.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
-- Higiene prévia: libera reservas pendentes já expiradas para a constraint aplicar
UPDATE "slot_reservations" SET "status" = 'released' WHERE "status" = 'pending' AND "expires_at" < now();--> statement-breakpoint
ALTER TABLE "slot_reservations" ADD CONSTRAINT "slot_reservations_no_overlap"
  EXCLUDE USING gist ("clinic_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&)
  WHERE ("status" IN ('pending', 'confirmed'));
