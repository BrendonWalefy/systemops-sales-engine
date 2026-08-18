import type { EditorialConfig } from "@/application/config/editorial-config";
import type { Organization } from "@/domain/entities/clinic";

export interface LiveConversationContextReader {
  findOrganization(clinicId: string): Promise<Organization | null>;
  resolveEditorialConfig(clinicId: string): Promise<EditorialConfig | null>;
}
