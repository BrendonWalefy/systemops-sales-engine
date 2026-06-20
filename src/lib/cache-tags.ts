export function clinicProfessionalsTag(clinicId: string): string {
  return `clinic:${clinicId}:professionals`;
}

export function clinicTreatmentsTag(clinicId: string): string {
  return `clinic:${clinicId}:treatments`;
}

export function clinicEquipeTag(clinicId: string): string {
  return `clinic:${clinicId}:equipe`;
}
