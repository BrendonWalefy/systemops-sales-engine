export function avatarInitial(value: string | null | undefined): string {
  const match = value?.trim().match(/[\p{L}\p{N}]/u);
  return match?.[0]?.toLocaleUpperCase("pt-BR") ?? "?";
}
