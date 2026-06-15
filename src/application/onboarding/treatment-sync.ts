export function resolveTreatmentIdsToDelete(
  existingIds: string[],
  incomingIds: string[],
): string[] {
  return existingIds.filter((id) => !incomingIds.includes(id));
}
