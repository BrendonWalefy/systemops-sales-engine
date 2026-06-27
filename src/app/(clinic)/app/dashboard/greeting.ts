// Deriva o nome amigável usado na saudação do dashboard ("Olá, {nome}!").
//
// Prioridade (funciona para qualquer clínica):
//   1. display_name explícito do membro (override consciente do admin);
//   2. nome do profissional vinculado ("Dra. Helena Marques" → "Dra. Helena");
//   3. primeiro nome derivado do e-mail.

export function emailToFirstName(email: string): string {
  const local = email.split("@")[0];
  const first = local.split(/[._\-0-9]/)[0];
  if (!first) return "você";
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

// "Dra. Helena Marques" → "Dra. Helena"; "João Pereira" → "João".
export function greetingFromProfessionalName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "você";
  if (/^(dr|dra)\.?$/i.test(parts[0]) && parts[1]) {
    return `${parts[0]} ${parts[1]}`;
  }
  return parts[0];
}

export function resolveGreetingName(opts: {
  displayName?: string | null;
  professionalName?: string | null;
  email?: string | null;
}): string {
  const explicit = opts.displayName?.trim();
  if (explicit) return explicit;
  if (opts.professionalName?.trim()) {
    return greetingFromProfessionalName(opts.professionalName);
  }
  if (opts.email?.trim()) return emailToFirstName(opts.email);
  return "você";
}
