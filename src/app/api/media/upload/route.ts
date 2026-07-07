import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { DrizzleMediaAssetRepository } from "@/infrastructure/repositories/drizzle-media-asset-repository";
import { DrizzleTreatmentRepository } from "@/infrastructure/repositories/drizzle-treatment-repository";
import type { MediaAssetType } from "@/domain/entities/media-asset";

export const dynamic = "force-dynamic";

// Vercel limita bodies de serverless functions a 4.5 MB por padrão.
// Para vídeos maiores, usamos multipart nativo do @vercel/blob.
export const maxDuration = 60;

const ALLOWED_TYPES: Record<string, MediaAssetType> = {
  "video/mp4": "video",
  "video/quicktime": "video",
  "video/webm": "video",
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
};

const MAX_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB
const MAX_ASSETS_PER_CLINIC = 10;

const mediaAssetRepo = new DrizzleMediaAssetRepository();
const treatmentRepo = new DrizzleTreatmentRepository();

export async function POST(request: NextRequest): Promise<NextResponse> {
  const clinicId = await getSessionClinicId();
  if (!clinicId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Campo 'file' obrigatório" }, { status: 400 });
  }

  const mediaType = ALLOWED_TYPES[file.type];
  if (!mediaType) {
    return NextResponse.json(
      { error: `Tipo não suportado: ${file.type}. Use MP4, MOV, WebM, JPEG, PNG ou WebP.` },
      { status: 422 },
    );
  }

  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json(
      { error: `Arquivo muito grande. Máximo: 100 MB.` },
      { status: 422 },
    );
  }

  // Teto de custo/storage da biblioteca — validado no servidor, nunca só na UI.
  const currentCount = await mediaAssetRepo.countByClinic(clinicId);
  if (currentCount >= MAX_ASSETS_PER_CLINIC) {
    return NextResponse.json(
      { error: `Limite de ${MAX_ASSETS_PER_CLINIC} mídias na biblioteca atingido. Remova uma mídia antes de adicionar outra.` },
      { status: 422 },
    );
  }

  // treatmentId é opcional (mídia geral); quando informado, precisa pertencer à
  // MESMA clínica da sessão — nunca aceitar um treatmentId "de fora" sem checar.
  const treatmentIdRaw = formData.get("treatmentId");
  let treatmentId: string | null = null;
  if (typeof treatmentIdRaw === "string" && treatmentIdRaw.trim()) {
    const clinicTreatments = await treatmentRepo.listByClinic(clinicId);
    const owned = clinicTreatments.find((t) => t.id === treatmentIdRaw.trim());
    if (!owned) {
      return NextResponse.json({ error: "Procedimento inválido para esta clínica." }, { status: 400 });
    }
    treatmentId = owned.id;
  }

  const folderRaw = formData.get("folder");
  const folder = typeof folderRaw === "string" && folderRaw.trim() ? folderRaw.trim() : null;

  const titleRaw = formData.get("title");
  const title =
    typeof titleRaw === "string" && titleRaw.trim()
      ? titleRaw.trim()
      : file.name.replace(/\.[^./]+$/, "") || "Sem título";

  const ext = file.name.split(".").pop() ?? "bin";
  const key = `media/clinic/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  try {
    const blob = await put(key, file, {
      access: "public",
      contentType: file.type,
      multipart: file.size > 5 * 1024 * 1024, // multipart para arquivos > 5 MB
    });

    const asset = await mediaAssetRepo.create({
      clinicId,
      treatmentId,
      title,
      url: blob.url,
      type: mediaType,
      mimeType: file.type,
      sizeBytes: file.size,
      folder,
    });

    return NextResponse.json({ asset });
  } catch (err) {
    console.error("[MediaUpload] Falha no upload para Vercel Blob:", err);
    return NextResponse.json({ error: "Falha no upload. Tente novamente." }, { status: 500 });
  }
}
