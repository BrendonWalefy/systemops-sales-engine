/**
 * Provisionamento automático de instância Z-API para o onboarding do owner.
 *
 * Cria a instância via API de parceiro integrador (Fase 1 de
 * docs/product/zapi-provisionamento-automatico.md), aplica o preset padrão
 * (notify-sent-by-me + ignorar grupos) e grava as credenciais já criptografadas
 * na clínica — o owner não precisa abrir o painel da Z-API.
 *
 * Tenant: clinicId é o parâmetro de rota. Duas credenciais de PLATAFORMA (env,
 * nunca de tenant, nunca gravadas com o mesmo valor uma na outra):
 * - ZAPI_PARTNER_TOKEN: só autentica os endpoints de parceiro (Bearer, criar/
 *   assinar/cancelar instância). Hoje é o Client-Token da conta; quando
 *   virarmos integrador oficial, troca pelo token definitivo de parceiro.
 * - ZAPI_ACCOUNT_CLIENT_TOKEN: o Client-Token da conta usado no header
 *   `Client-Token` de toda chamada por-instância (send, status, qr-code...).
 *   É o MESMO valor físico hoje (por isso o fallback abaixo), mas conceitualmente
 *   distinto — não muda quando o parceiro oficial chegar. Gravar o
 *   ZAPI_PARTNER_TOKEN futuro nessa coluna quebraria o envio de toda clínica
 *   provisionada por aqui.
 *
 * POST → cria a instância, salva as credenciais (nunca devolvidas ao client —
 * mesma regra da rota channel-pairing) e devolve
 * { success, instanceId, due?, presetWarning? }.
 */

import { type NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { organizations } from "@/infrastructure/db/schema";
import { verifyToken, COOKIE_NAME } from "@/lib/session";
import { encryptCredentialNullable } from "@/infrastructure/crypto/credential-vault";
import {
  createZApiInstance,
  applyZApiInstancePreset,
} from "@/infrastructure/adapters/channels/whatsapp/zapi-channel-adapter";

async function requireOwner(): Promise<boolean> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;
  return session?.role === "owner";
}

type RouteContext = { params: Promise<{ clinicId: string }> };

function buildWebhookUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.systemops.com.br";
  const url = `${base}/api/whatsapp/zapi`;
  const secret = process.env.ZAPI_WEBHOOK_SECRET;
  return secret ? `${url}?secret=${secret}` : url;
}

export async function POST(_request: NextRequest, { params }: RouteContext): Promise<NextResponse> {
  if (!(await requireOwner())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const partnerToken = process.env.ZAPI_PARTNER_TOKEN;
  if (!partnerToken) {
    return NextResponse.json(
      { error: "ZAPI_PARTNER_TOKEN não configurado no servidor" },
      { status: 500 },
    );
  }
  // Fallback intencional: hoje as duas env recebem o mesmo Client-Token da
  // conta. Ver nota de topo do arquivo sobre por que são conceitualmente
  // distintas e por que não usar `partnerToken` aqui quando divergirem.
  const accountClientToken = process.env.ZAPI_ACCOUNT_CLIENT_TOKEN ?? partnerToken;

  const { clinicId } = await params;
  const clinic = await db.query.organizations.findFirst({
    where: eq(organizations.id, clinicId),
    columns: { id: true, name: true, zapiInstanceId: true },
  });
  if (!clinic) {
    return NextResponse.json({ error: "Clinic not found" }, { status: 404 });
  }
  if (clinic.zapiInstanceId) {
    return NextResponse.json(
      { error: "Clínica já tem uma instância Z-API vinculada. Remova-a manualmente antes de criar outra." },
      { status: 409 },
    );
  }

  let created: Awaited<ReturnType<typeof createZApiInstance>>;
  try {
    created = await createZApiInstance(clinic.name, partnerToken, buildWebhookUrl());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao criar instância Z-API" },
      { status: 502 },
    );
  }

  // Credenciais são salvas mesmo se o preset falhar — a instância já existe e
  // já está sendo cobrada; perder o vínculo com a clínica criaria uma órfã.
  await db
    .update(organizations)
    .set({
      channelProvider: "z_api",
      zapiInstanceId: created.instanceId,
      zapiToken: encryptCredentialNullable(created.token),
      zapiClientToken: encryptCredentialNullable(accountClientToken),
      updatedAt: new Date(),
    })
    .where(eq(organizations.id, clinicId));

  let presetWarning: string | undefined;
  try {
    await applyZApiInstancePreset({
      instanceId: created.instanceId,
      token: created.token,
      clientToken: accountClientToken,
    });
  } catch (error) {
    presetWarning = error instanceof Error ? error.message : "Falha ao aplicar preset padrão";
  }

  return NextResponse.json({
    success: true,
    instanceId: created.instanceId,
    due: created.due ?? null,
    presetWarning,
  });
}
