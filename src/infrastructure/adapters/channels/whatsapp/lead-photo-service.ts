import { eq } from "drizzle-orm";
import { db } from "@/infrastructure/db/client";
import { leads } from "@/infrastructure/db/schema";
import { VercelBlobStorageGateway } from "@/infrastructure/adapters/storage/vercel-blob-storage-gateway";
import type { ZapiCreds } from "./channel-config";

async function fetchZApiProfilePicture(phone: string, creds: ZapiCreds): Promise<string | null> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (creds.clientToken) headers["Client-Token"] = creds.clientToken;

  let res: Response;
  try {
    res = await fetch(
      `https://api.z-api.io/instances/${creds.instanceId}/token/${creds.token}/profile-picture?phone=${encodeURIComponent(phone)}`,
      { method: "GET", headers, signal: AbortSignal.timeout(10_000) },
    );
  } catch {
    return null;
  }

  if (!res.ok) return null;

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return null;
  }

  const entry = Array.isArray(data) ? data[0] : data;
  const link = entry && typeof entry === "object" ? (entry as { link?: unknown }).link : undefined;
  if (typeof link !== "string" || !link.startsWith("http")) return null;
  return link;
}

/**
 * Busca a foto de perfil do lead via Z-API, re-hospeda no Vercel Blob
 * (URL permanente, pois URLs do WhatsApp expiram em ~48h) e atualiza
 * leads.profile_pic_url.
 *
 * Projetada para fire-and-forget: nunca lança exceção.
 */
export async function fetchAndPersistLeadPhoto(
  leadId: string,
  phone: string,
  creds: ZapiCreds,
): Promise<void> {
  const photoUrl = await fetchZApiProfilePicture(phone, creds);
  if (!photoUrl) return;

  let permanentUrl: string;
  try {
    const res = await fetch(photoUrl, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return;
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const bytes = await res.arrayBuffer();
    const storage = new VercelBlobStorageGateway();
    permanentUrl = await storage.upload(`lead-avatars/${leadId}`, bytes, { contentType });
  } catch {
    return;
  }

  try {
    await db
      .update(leads)
      .set({ profilePicUrl: permanentUrl, updatedAt: new Date() })
      .where(eq(leads.id, leadId));
  } catch {
    // silently ignore — next message will retry
  }
}
