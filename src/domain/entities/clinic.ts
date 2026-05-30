export type Clinic = {
  id: string;
  name: string;
  specialty: string;
  city: string | null;
  timezone: string;
  toneOfVoice: string | null;
  commercialPolicy: string | null;
  playbook: string | null;
  greetingMessage: string | null;
  businessHours: string | null;
  googleCalendarId: string | null;
  takeoverTtlHours: number;
  postAppointmentBufferMinutes: number;
  defaultAppointmentDurationMinutes: number;
  createdAt: Date;
  updatedAt: Date;
};
