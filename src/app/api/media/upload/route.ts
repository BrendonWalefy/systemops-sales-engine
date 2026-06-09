import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { put } from "@vercel/blob";
import { verifyToken, COOKIE_NAME } from "@/lib/session";

export const dynamic = "force-dynamic";

// Vercel limita bodies de serverless functions a 4.5 MB por padrão.
// Para vídeos maiores, usamos multipart nativo do @vercel/blob.
export const maxDuration = 60;

const ALLOWED_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "image/jpeg",
  "image/png",
  "image/webp",
];

const MAX_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB

export async function POST(request: NextRequest): Promise<NextResponse> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const session = token ? await verifyToken(token) : null;
  if (!session) {
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

  if (!ALLOWED_TYPES.includes(file.type)) {
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

  const ext = file.name.split(".").pop() ?? "bin";
  const key = `media/clinic/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  try {
    const blob = await put(key, file, {
      access: "public",
      contentType: file.type,
      multipart: file.size > 5 * 1024 * 1024, // multipart para arquivos > 5 MB
    });

    return NextResponse.json({ url: blob.url, name: file.name });
  } catch (err) {
    console.error("[MediaUpload] Falha no upload para Vercel Blob:", err);
    return NextResponse.json({ error: "Falha no upload. Tente novamente." }, { status: 500 });
  }
}
