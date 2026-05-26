import { eq, and, notInArray, lt, sql } from "drizzle-orm";
import type { Lead } from "@/domain/entities/lead";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import { db } from "@/infrastructure/db/client";
import { leads, conversations } from "@/infrastructure/db/schema";

export class DrizzleLeadRepository implements LeadRepository {
  async findById(id: string): Promise<Lead | null> {
    const row = await db.query.leads.findFirst({ where: eq(leads.id, id) });
    return row ? mapRow(row) : null;
  }

  async findByPhone(clinicId: string, phone: string): Promise<Lead | null> {
    const row = await db.query.leads.findFirst({
      where: and(eq(leads.clinicId, clinicId), eq(leads.phone, phone)),
    });
    return row ? mapRow(row) : null;
  }

  async findInactiveLeads(params: {
    clinicId: string;
    lastActivityBefore: Date;
  }): Promise<Lead[]> {
    const rows = await db
      .select({ lead: leads })
      .from(leads)
      .innerJoin(conversations, eq(conversations.leadId, leads.id))
      .where(
        and(
          eq(leads.clinicId, params.clinicId),
          notInArray(leads.status, ["lost", "won", "appointment_scheduled"]),
          lt(
            sql`COALESCE(${conversations.lastMessageAt}, ${conversations.updatedAt})`,
            params.lastActivityBefore,
          ),
        ),
      );
    return rows.map((r) => mapRow(r.lead));
  }

  async save(lead: Lead): Promise<void> {
    await db
      .insert(leads)
      .values({
        id: lead.id,
        clinicId: lead.clinicId,
        name: lead.name,
        phone: lead.phone,
        email: lead.email,
        channel: lead.channel,
        campaignId: lead.campaignId,
        treatmentInterest: lead.treatmentInterest,
        status: lead.status,
        temperature: lead.temperature,
        assignedToUserId: lead.assignedToUserId,
        nextActionAt: lead.nextActionAt,
        lostReason: lead.lostReason,
        createdAt: lead.createdAt,
        updatedAt: lead.updatedAt,
      })
      .onConflictDoUpdate({
        target: leads.id,
        set: {
          name: lead.name,
          phone: lead.phone,
          email: lead.email,
          status: lead.status,
          temperature: lead.temperature,
          treatmentInterest: lead.treatmentInterest,
          assignedToUserId: lead.assignedToUserId,
          nextActionAt: lead.nextActionAt,
          lostReason: lead.lostReason,
          updatedAt: lead.updatedAt,
        },
      });
  }
}

function mapRow(row: typeof leads.$inferSelect): Lead {
  return {
    id: row.id,
    clinicId: row.clinicId,
    name: row.name,
    phone: row.phone,
    email: row.email,
    channel: row.channel,
    campaignId: row.campaignId,
    treatmentInterest: row.treatmentInterest,
    status: row.status,
    temperature: row.temperature,
    assignedToUserId: row.assignedToUserId,
    nextActionAt: row.nextActionAt,
    lostReason: row.lostReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
