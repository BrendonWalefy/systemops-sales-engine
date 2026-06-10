import { describe, expect, it } from "vitest";
import type { Lead } from "@/domain/entities/lead";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import { ResolveWhatsAppLead } from "@/application/whatsapp/resolve-whatsapp-lead";

class MemoryLeadRepository implements LeadRepository {
  readonly leads = new Map<string, Lead>();

  async findById(id: string): Promise<Lead | null> {
    return this.leads.get(id) ?? null;
  }

  async findByPhone(clinicId: string, phone: string): Promise<Lead | null> {
    return (
      Array.from(this.leads.values()).find(
        (lead) => lead.clinicId === clinicId && lead.phone === phone,
      ) ?? null
    );
  }

  async findByWhatsAppLid(clinicId: string, whatsappLid: string): Promise<Lead | null> {
    return (
      Array.from(this.leads.values()).find(
        (lead) => lead.clinicId === clinicId && lead.whatsappLid === whatsappLid,
      ) ?? null
    );
  }

  async findInactiveLeads(): Promise<Lead[]> {
    return [];
  }

  async save(lead: Lead): Promise<void> {
    const existing = Array.from(this.leads.values()).find(
      (row) =>
        row.clinicId === lead.clinicId &&
        ((lead.phone && row.phone === lead.phone) ||
          (lead.whatsappLid && row.whatsappLid === lead.whatsappLid)),
    );
    if (existing) {
      this.leads.set(existing.id, { ...existing, ...lead, id: existing.id });
      return;
    }
    this.leads.set(lead.id, lead);
  }

  async mergeDuplicateLeads(params: {
    canonicalLeadId: string;
    duplicateLeadId: string;
  }): Promise<Lead> {
    const canonical = this.leads.get(params.canonicalLeadId);
    const duplicate = this.leads.get(params.duplicateLeadId);
    if (!canonical || !duplicate) throw new Error("lead missing");

    const merged: Lead = {
      ...canonical,
      whatsappLid: canonical.whatsappLid ?? duplicate.whatsappLid,
      phone: canonical.phone ?? duplicate.phone,
      name: canonical.name ?? duplicate.name,
    };
    this.leads.set(canonical.id, merged);
    this.leads.delete(duplicate.id);
    return merged;
  }
}

describe("ResolveWhatsAppLead", () => {
  const now = new Date("2026-06-06T12:00:00Z");
  let seq = 0;
  const idGenerator = () => `lead-${++seq}`;

  it("enriquece lead existente com @lid quando webhook traz ambos", async () => {
    const repo = new MemoryLeadRepository();
    repo.leads.set("lead-1", {
      id: "lead-1",
      clinicId: "clinic-1",
      name: "Karen",
      phone: "5511979663668",
      whatsappLid: null,
      email: null,
      channel: "whatsapp",
      campaignId: null,
      treatmentInterest: null,
      profilePicUrl: null,
      status: "waiting_response",
      temperature: null,
      assignedToUserId: null,
      nextActionAt: null,
      lostReason: null,
      createdAt: now,
      updatedAt: now,
    });

    const resolver = new ResolveWhatsAppLead(repo);
    const lead = await resolver.execute({
      clinicId: "clinic-1",
      identifiers: {
        phone: "5511979663668",
        whatsappLid: "271295921025045@lid",
      },
      name: "Karen",
      channel: "whatsapp",
      now,
      idGenerator,
    });

    expect(lead.id).toBe("lead-1");
    expect(lead.phone).toBe("5511979663668");
    expect(lead.whatsappLid).toBe("271295921025045@lid");
  });

  it("faz merge quando telefone e @lid apontam para leads diferentes", async () => {
    const repo = new MemoryLeadRepository();
    repo.leads.set("phone-lead", {
      id: "phone-lead",
      clinicId: "clinic-1",
      name: "Karen",
      phone: "5511979663668",
      whatsappLid: null,
      email: null,
      channel: "whatsapp",
      campaignId: null,
      treatmentInterest: null,
      profilePicUrl: null,
      status: "waiting_response",
      temperature: null,
      assignedToUserId: null,
      nextActionAt: null,
      lostReason: null,
      createdAt: now,
      updatedAt: now,
    });
    repo.leads.set("lid-lead", {
      id: "lid-lead",
      clinicId: "clinic-1",
      name: "Karen",
      phone: null,
      whatsappLid: "271295921025045@lid",
      email: null,
      channel: "whatsapp",
      campaignId: null,
      treatmentInterest: null,
      profilePicUrl: null,
      status: "waiting_response",
      temperature: null,
      assignedToUserId: null,
      nextActionAt: null,
      lostReason: null,
      createdAt: now,
      updatedAt: now,
    });

    const resolver = new ResolveWhatsAppLead(repo);
    const lead = await resolver.execute({
      clinicId: "clinic-1",
      identifiers: {
        phone: "5511979663668",
        whatsappLid: "271295921025045@lid",
      },
      channel: "whatsapp",
      now,
      idGenerator,
    });

    expect(lead.id).toBe("phone-lead");
    expect(lead.whatsappLid).toBe("271295921025045@lid");
    expect(await repo.findById("lid-lead")).toBeNull();
  });
});
