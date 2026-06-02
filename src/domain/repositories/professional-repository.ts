import type { Professional } from "../entities/professional";

export type ProfessionalRepository = {
  listByClinic(clinicId: string): Promise<Professional[]>;
  findById(id: string): Promise<Professional | null>;
  create(data: Omit<Professional, "id" | "createdAt" | "updatedAt">): Promise<Professional>;
  update(id: string, data: Partial<Pick<Professional, "name" | "specialty" | "color" | "workSchedule" | "googleCalendarId" | "isActive">>): Promise<Professional>;
  delete(id: string): Promise<void>;
};
