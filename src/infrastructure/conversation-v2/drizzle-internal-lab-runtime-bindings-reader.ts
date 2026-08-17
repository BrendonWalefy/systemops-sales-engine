import { getClinicModules } from "@/application/modules/module-gate";
import {
  computeInternalLabRuntimeBindings,
  INTERNAL_LAB_RUNTIME_ARTIFACT_SCHEMA,
  type InternalLabRuntimeBindingsReader,
} from "@/application/conversation-v2/internal-lab-runtime-bindings";
import { DrizzleLiveConversationContextReader } from "@/infrastructure/repositories/drizzle-live-conversation-context-reader";
import { DrizzleTreatmentRepository } from "@/infrastructure/repositories/drizzle-treatment-repository";

export class DrizzleInternalLabRuntimeBindingsReader
implements InternalLabRuntimeBindingsReader {
  constructor(
    private readonly context = new DrizzleLiveConversationContextReader(),
    private readonly treatments = new DrizzleTreatmentRepository(),
  ) {}

  async resolve(clinicId: string) {
    const clinic = await this.context.findOrganization(clinicId);
    if (!clinic) throw new Error("Internal Lab tenant configuration unavailable");
    const [editorial, modules, treatments] = await Promise.all([
      this.context.resolveEditorialConfig(clinicId),
      getClinicModules(clinicId),
      this.treatments.listByClinic(clinicId),
    ]);
    return computeInternalLabRuntimeBindings({
      schemaVersion: INTERNAL_LAB_RUNTIME_ARTIFACT_SCHEMA,
      clinic: this.context.getOrganizationRow(clinic) as Record<string, unknown>,
      editorial,
      modules,
      treatments: treatments
        .filter((treatment) => treatment.clinicId === clinicId)
        .map((treatment) => treatment as unknown as Record<string, unknown>),
    });
  }
}
