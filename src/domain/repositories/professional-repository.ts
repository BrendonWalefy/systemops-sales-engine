import type { Professional } from "../entities/professional";

export type ProfessionalRepository = {
  listByClinic(clinicId: string): Promise<Professional[]>;
  findById(id: string): Promise<Professional | null>;
  // clinicId escopa a escrita ao tenant da sessão — retorna null se o profissional
  // não existir ou pertencer a outra clínica (nunca escreve/apaga fora do tenant).
  update(
    id: string,
    clinicId: string,
    data: Partial<Pick<Professional, "name" | "specialty" | "color" | "workSchedule" | "googleCalendarId" | "isActive">>,
  ): Promise<Professional | null>;
  delete(id: string, clinicId: string): Promise<void>;
};
