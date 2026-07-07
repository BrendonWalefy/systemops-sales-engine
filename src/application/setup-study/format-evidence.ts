export type EvidenceRole = "paciente" | "clinica" | "ia" | "sistema" | null;

export interface EvidenceSegment {
  role: EvidenceRole;
  text: string;
}

function mapRole(raw: string): EvidenceRole {
  switch (raw) {
    case "CLINICA":
      return "clinica";
    case "PACIENTE":
      return "paciente";
    case "IA(shadow)":
      return "ia";
    case "SISTEMA":
      return "sistema";
    default:
      return null;
  }
}

export function parseEvidenceSegments(evidence: string): EvidenceSegment[] {
  if (!evidence) return [];

  const parts = evidence.split(/(CLINICA|PACIENTE|IA\(shadow\)|SISTEMA):/);

  if (parts.length === 1) {
    return [{ role: null, text: evidence.trim() }];
  }

  const segments: EvidenceSegment[] = [];

  for (let i = 1; i < parts.length; i += 2) {
    const rawRole = parts[i];
    let text = parts[i + 1] || "";

    text = text.trim();
    while (text.startsWith("/")) {
      text = text.slice(1).trim();
    }
    while (text.endsWith("/")) {
      text = text.slice(0, -1).trim();
    }

    if (text.length > 0) {
      segments.push({
        role: mapRole(rawRole),
        text,
      });
    }
  }

  if (segments.length === 0) {
    return [{ role: null, text: evidence.trim() }];
  }

  return segments;
}
