import { describe, expect, it } from "vitest";
import type { Lead } from "@/domain/entities/lead";
import type { LeadRepository } from "@/domain/repositories/lead-repository";
import { ResolveWhatsAppLead, sanitizeLeadName } from "@/application/whatsapp/resolve-whatsapp-lead";

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
      phone: "5511900000002",
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
        phone: "5511900000002",
        whatsappLid: "200000000000002@lid",
      },
      name: "Karen",
      channel: "whatsapp",
      now,
      idGenerator,
    });

    expect(lead.id).toBe("lead-1");
    expect(lead.phone).toBe("5511900000002");
    expect(lead.whatsappLid).toBe("200000000000002@lid");
  });

  it("faz merge quando telefone e @lid apontam para leads diferentes", async () => {
    const repo = new MemoryLeadRepository();
    repo.leads.set("phone-lead", {
      id: "phone-lead",
      clinicId: "clinic-1",
      name: "Karen",
      phone: "5511900000002",
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
      whatsappLid: "200000000000002@lid",
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
        phone: "5511900000002",
        whatsappLid: "200000000000002@lid",
      },
      channel: "whatsapp",
      now,
      idGenerator,
    });

    expect(lead.id).toBe("phone-lead");
    expect(lead.whatsappLid).toBe("200000000000002@lid");
    expect(await repo.findById("lid-lead")).toBeNull();
  });

  // Cenário real: lead "🧜‍♂️🧚🏽‍♀️" (29/06) recebeu saudação da IA usando o
  // emoji como nome literal, pois o pushname do WhatsApp era só emoji.
  describe("sanitizeLeadName — nomes de perfil do WhatsApp sem letras", () => {
    it("rejeita nome só com emoji", () => {
      expect(sanitizeLeadName("🧜‍♂️🧚🏽‍♀️")).toBeNull();
    });

    it("rejeita nome só com símbolos/pontuação", () => {
      expect(sanitizeLeadName("🔥🔥🔥")).toBeNull();
      expect(sanitizeLeadName("...")).toBeNull();
      expect(sanitizeLeadName("---")).toBeNull();
    });

    it("rejeita string vazia, só espaço ou undefined/null", () => {
      expect(sanitizeLeadName("")).toBeNull();
      expect(sanitizeLeadName("   ")).toBeNull();
      expect(sanitizeLeadName(undefined)).toBeNull();
      expect(sanitizeLeadName(null)).toBeNull();
    });

    it("aceita nomes reais, com acento, e ajusta espaços nas bordas", () => {
      expect(sanitizeLeadName("Tarcísio Meira")).toBe("Tarcísio Meira");
      expect(sanitizeLeadName("  Carla  ")).toBe("Carla");
    });

    it("aceita nome com emoji misturado a letras (ex: apelido decorado)", () => {
      expect(sanitizeLeadName("Carla 💖")).toBe("Carla 💖");
    });

    it("lead novo criado via WhatsApp com pushname só-emoji recebe name null, não o emoji", async () => {
      const repo = new MemoryLeadRepository();
      const resolver = new ResolveWhatsAppLead(repo);
      const lead = await resolver.execute({
        clinicId: "clinic-1",
        identifiers: { phone: "5511900000003", whatsappLid: null },
        name: "🧜‍♂️🧚🏽‍♀️",
        channel: "whatsapp",
        now,
        idGenerator,
      });
      expect(lead.name).toBeNull();
    });

    it("lead existente com nome válido não é sobrescrito por um pushname inválido em mensagem seguinte", async () => {
      const repo = new MemoryLeadRepository();
      repo.leads.set("lead-1", {
        id: "lead-1",
        clinicId: "clinic-1",
        name: "Rogger Tenorio",
        phone: "5513900000004",
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
        identifiers: { phone: "5513900000004", whatsappLid: null },
        name: "🔥🔥🔥",
        channel: "whatsapp",
        now,
        idGenerator,
      });

      expect(lead.name).toBe("Rogger Tenorio");
    });
  });
});
