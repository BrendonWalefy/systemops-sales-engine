export function inferReceptionistNameFromGreeting(
  greetingMessage?: string | null,
): string | null {
  const text = greetingMessage?.trim();
  if (!text) return null;

  const patterns = [
    /\b(?:sou|eu sou)\s+[ao]\s+([A-Za-zÀ-ÿ'-]+)/i,
    /\bmeu nome é\s+([A-Za-zÀ-ÿ'-]+)/i,
    /\bquem fala é\s+([A-Za-zÀ-ÿ'-]+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidate = match?.[1]?.replace(/[.,;:!?]+$/, "").trim();
    if (candidate) {
      return candidate.charAt(0).toUpperCase() + candidate.slice(1);
    }
  }

  return null;
}
