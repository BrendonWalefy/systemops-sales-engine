export type Professional = {
  id: string;
  clinicId: string;
  name: string;
  specialty: string | null;
  color: string;
  workSchedule: unknown | null;
  googleCalendarId: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};
