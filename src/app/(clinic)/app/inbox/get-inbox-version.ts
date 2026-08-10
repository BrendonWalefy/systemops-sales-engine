import { readClinicVersion } from "@/application/read-versions/clinic-read-version";

export async function getInboxVersion(clinicId: string): Promise<string> {
  return readClinicVersion(clinicId, "inbox");
}
