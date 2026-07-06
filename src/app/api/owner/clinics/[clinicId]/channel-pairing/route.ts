/**
 * Rota de pareamento de canal para o onboarding do owner.
 *
 * Expõe QR code, código de telefone e status de conexão Z-API SEM vazar
 * tokens para o cliente. O token da clínica é resolvido internamente a partir
 * do clinicId da rota, nunca serializado na resposta.
 *
 * Tenant: clinicId é o parâmetro de rota — nunca env.
 * Auth: requer role=owner (cookie de sessão).
 *
 * GET  ?action=qr-code     → { status: "qr"|"connected"|"expired"|"error", base64? }
 * GET  ?action=phone-code  → { status: "code"|"connected"|"error", code?, requires: phone }
 * GET  ?action=status      → { connected: boolean }
 * POST ?action=record-pairing → grava channelPairedAt = NOW() se ainda null
 */

import { type NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { organizations } from "@/infrastructure/db/schema";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { resolveChannelConfig } from "@/infrastructure/adapters/channels/whatsapp/channel-config";
import {
  getZApiQrCodeImage,
  getZApiPhoneCode,
  getZApiInstanceStatus,
} from "@/infrastructure/adapters/channels/whatsapp/zapi-channel-adapter";

async function requireOwner(): Promise<boolean> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;
  return session?.role === "owner";
}

type RouteContext = { params: Promise<{ clinicId: string }> };

async function resolveClinicCreds(clinicId: string) {
  const clinic = await db.query.organizations.findFirst({
    where: eq(organizations.id, clinicId),
    columns: {
      channelProvider: true,
      zapiInstanceId: true,
      zapiToken: true,
      zapiClientToken: true,
      channelPairedAt: true,
    },
  });
  return clinic ?? null;
}

export async function GET(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  if (!(await requireOwner())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { clinicId } = await params;
  const action = request.nextUrl.searchParams.get("action");

  const clinic = await resolveClinicCreds(clinicId);
  if (!clinic) {
    return NextResponse.json({ error: "Clinic not found" }, { status: 404 });
  }

  const channelConfig = resolveChannelConfig(clinic);

  if (channelConfig.provider !== "z_api" || !channelConfig.zapi) {
    return NextResponse.json(
      { error: "Pareamento por QR/código disponível apenas para provider z_api" },
      { status: 400 },
    );
  }

  const creds = channelConfig.zapi;

  // ── GET ?action=qr-code ─────────────────────────────────────────────────────
  if (action === "qr-code") {
    const result = await getZApiQrCodeImage(creds);
    // Nunca serializar o token — só base64 do QR e status.
    return NextResponse.json(result);
  }

  // ── GET ?action=phone-code&phone={phone} ────────────────────────────────────
  if (action === "phone-code") {
    const phone = request.nextUrl.searchParams.get("phone");
    if (!phone) {
      return NextResponse.json({ error: "Parâmetro 'phone' obrigatório" }, { status: 400 });
    }
    const result = await getZApiPhoneCode(creds, phone);
    return NextResponse.json(result);
  }

  // ── GET ?action=status ───────────────────────────────────────────────────────
  if (action === "status") {
    const result = await getZApiInstanceStatus(creds);
    return NextResponse.json({
      connected: result.connected ?? false,
      smartphoneConnected: result.smartphoneConnected ?? false,
    });
  }

  return NextResponse.json({ error: "Parâmetro 'action' inválido" }, { status: 400 });
}

export async function POST(request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  if (!(await requireOwner())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { clinicId } = await params;
  const action = request.nextUrl.searchParams.get("action");

  // ── POST ?action=record-pairing ─────────────────────────────────────────────
  if (action === "record-pairing") {
    const clinic = await resolveClinicCreds(clinicId);
    if (!clinic) {
      return NextResponse.json({ error: "Clinic not found" }, { status: 404 });
    }

    // Idempotente: só grava se ainda não foi registrado.
    if (!clinic.channelPairedAt) {
      await db
        .update(organizations)
        .set({ channelPairedAt: new Date(), updatedAt: new Date() })
        .where(eq(organizations.id, clinicId));
    }

    return NextResponse.json({ recorded: true, pairedAt: clinic.channelPairedAt ?? new Date() });
  }

  return NextResponse.json({ error: "Parâmetro 'action' inválido" }, { status: 400 });
}
