-- ADR-001 Camada 2: renomear clinics→organizations e clinic_id→organization_id
-- Todas as operações são transacionais no PostgreSQL (DDL atômico).
-- FKs são atualizadas automaticamente pelo Postgres no RENAME TABLE.

-- ── 1. Renomear tabela principal ──────────────────────────────────────────────
ALTER TABLE "clinics" RENAME TO "organizations";

-- ── 2. Renomear clinic_id → organization_id em todas as tabelas filhas ────────
ALTER TABLE "treatments"               RENAME COLUMN "clinic_id" TO "organization_id";
ALTER TABLE "leads"                    RENAME COLUMN "clinic_id" TO "organization_id";
ALTER TABLE "conversations"            RENAME COLUMN "clinic_id" TO "organization_id";
ALTER TABLE "inbound_events"           RENAME COLUMN "clinic_id" TO "organization_id";
ALTER TABLE "outbound_messages"        RENAME COLUMN "clinic_id" TO "organization_id";
ALTER TABLE "agent_recommendations"    RENAME COLUMN "clinic_id" TO "organization_id";
ALTER TABLE "follow_ups"               RENAME COLUMN "clinic_id" TO "organization_id";
ALTER TABLE "professionals"            RENAME COLUMN "clinic_id" TO "organization_id";
ALTER TABLE "rooms"                    RENAME COLUMN "clinic_id" TO "organization_id";
ALTER TABLE "appointments"             RENAME COLUMN "clinic_id" TO "organization_id";
ALTER TABLE "calendar_blocks"          RENAME COLUMN "clinic_id" TO "organization_id";
ALTER TABLE "ai_usage_costs"           RENAME COLUMN "clinic_id" TO "organization_id";
ALTER TABLE "tts_usage_costs"          RENAME COLUMN "clinic_id" TO "organization_id";
ALTER TABLE "whatsapp_message_costs"   RENAME COLUMN "clinic_id" TO "organization_id";
ALTER TABLE "push_subscriptions"       RENAME COLUMN "clinic_id" TO "organization_id";
ALTER TABLE "playbook_versions"        RENAME COLUMN "clinic_id" TO "organization_id";
ALTER TABLE "clinic_metrics"           RENAME COLUMN "clinic_id" TO "organization_id";
ALTER TABLE "slot_reservations"        RENAME COLUMN "clinic_id" TO "organization_id";
ALTER TABLE "clinic_members"           RENAME COLUMN "clinic_id" TO "organization_id";
ALTER TABLE "clinic_modules"           RENAME COLUMN "clinic_id" TO "organization_id";
ALTER TABLE "clinic_operational_insights" RENAME COLUMN "clinic_id" TO "organization_id";
ALTER TABLE "treatment_gap_reports"    RENAME COLUMN "clinic_id" TO "organization_id";

-- ── 3. Renomear indexes que contêm "clinic" no nome ───────────────────────────
ALTER INDEX "treatments_clinic_name_idx"                      RENAME TO "treatments_org_name_idx";
ALTER INDEX "leads_clinic_status_idx"                         RENAME TO "leads_org_status_idx";
ALTER INDEX "leads_clinic_phone_idx"                          RENAME TO "leads_org_phone_idx";
ALTER INDEX "leads_clinic_whatsapp_lid_idx"                   RENAME TO "leads_org_whatsapp_lid_idx";
ALTER INDEX "conversations_clinic_category_idx"               RENAME TO "conversations_org_category_idx";
ALTER INDEX "inbound_events_clinic_received_at_idx"           RENAME TO "inbound_events_org_received_at_idx";
ALTER INDEX "follow_ups_clinic_due_at_idx"                    RENAME TO "follow_ups_org_due_at_idx";
ALTER INDEX "follow_ups_lead_reason_due_at_idx"               RENAME TO "follow_ups_org_lead_reason_due_at_idx";
ALTER INDEX "professionals_clinic_idx"                        RENAME TO "professionals_org_idx";
ALTER INDEX "rooms_clinic_idx"                                RENAME TO "rooms_org_idx";
ALTER INDEX "appointments_clinic_starts_at_idx"               RENAME TO "appointments_org_starts_at_idx";
ALTER INDEX "appointments_clinic_professional_idx"            RENAME TO "appointments_org_professional_idx";
ALTER INDEX "calendar_blocks_clinic_starts_at_idx"            RENAME TO "calendar_blocks_org_starts_at_idx";
ALTER INDEX "ai_usage_costs_clinic_created_at_idx"            RENAME TO "ai_usage_costs_org_created_at_idx";
ALTER INDEX "tts_usage_costs_clinic_created_at_idx"           RENAME TO "tts_usage_costs_org_created_at_idx";
ALTER INDEX "whatsapp_message_costs_clinic_created_at_idx"    RENAME TO "whatsapp_message_costs_org_created_at_idx";
ALTER INDEX "push_subscriptions_clinic_idx"                   RENAME TO "push_subscriptions_org_idx";
ALTER INDEX "playbook_versions_clinic_status_idx"             RENAME TO "playbook_versions_org_status_idx";
ALTER INDEX "slot_reservations_clinic_starts_at_idx"          RENAME TO "slot_reservations_org_starts_at_idx";
ALTER INDEX "slot_reservations_clinic_lead_idx"               RENAME TO "slot_reservations_org_lead_idx";
ALTER INDEX "slot_reservations_clinic_starts_at_unique"       RENAME TO "slot_reservations_org_starts_at_unique";
ALTER INDEX "clinic_members_email_clinic_idx"                 RENAME TO "org_members_email_org_idx";
ALTER INDEX "clinic_members_email_idx"                        RENAME TO "org_members_email_idx";
ALTER INDEX "idx_clinic_modules_clinic"                       RENAME TO "idx_org_modules_org";
ALTER INDEX "clinic_operational_insights_clinic_active_idx"   RENAME TO "org_operational_insights_org_active_idx";
ALTER INDEX "treatment_gap_reports_clinic_created_idx"        RENAME TO "treatment_gap_reports_org_created_idx";
