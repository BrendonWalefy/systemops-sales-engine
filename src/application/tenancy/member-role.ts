import { cookies } from "next/headers";
import { verifyToken, COOKIE_NAME, type MemberRole } from "@/lib/session";

export type { MemberRole };

export type MemberProfile = {
  email: string;
  sessionRole: "owner" | "clinic_admin";
  memberRole: MemberRole;
  clinicId: string;
  professionalId: string | null;
};

/**
 * Retorna o perfil completo do membro logado lendo memberRole e professionalId
 * diretamente do token — sem query ao banco.
 */
export async function getSessionMemberProfile(
  clinicId: string,
): Promise<MemberProfile | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await verifyToken(token);
  if (!session) return null;

  return {
    email: session.email,
    sessionRole: session.role,
    memberRole: session.memberRole,
    clinicId,
    professionalId: session.professionalId,
  };
}

export function canViewFinancials(profile: MemberProfile): boolean {
  return profile.memberRole === "owner" || profile.memberRole === "clinic_admin";
}

export function canViewOwnRevenue(profile: MemberProfile): boolean {
  return profile.memberRole === "professional";
}

export function canEditPrices(profile: MemberProfile): boolean {
  return profile.memberRole === "owner" || profile.memberRole === "clinic_admin";
}
