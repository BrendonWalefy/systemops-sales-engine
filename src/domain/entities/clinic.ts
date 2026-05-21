export type Clinic = {
  id: string;
  name: string;
  specialty: string;
  city: string | null;
  toneOfVoice: string | null;
  commercialPolicy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

