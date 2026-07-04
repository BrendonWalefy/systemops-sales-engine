/**
 * Sobe as fotos/vídeos de `scripts/demo-media/` para o Vercel Blob e reescreve
 * `src/application/demo/demo-media-manifest.ts` com as URLs públicas.
 *
 * O prefixo `demo-media/` é PERMANENTE (o cron cleanup-tts-blobs só apaga `tts/`).
 * O título de cada item é derivado do nome do arquivo (kebab/underscore → texto),
 * e é por ele que os roteiros selecionam a mídia via `mediaQuery`.
 *
 * Uso:
 *   1. Coloque os arquivos em scripts/demo-media/ (ex.: lentes.mp4, implante.mp4)
 *   2. npx dotenv -e .env.local -- npx tsx scripts/upload-demo-media.ts
 *   3. Rode o seed: npm run seed:demo
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, extname, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { VercelBlobStorageGateway } from "../src/infrastructure/adapters/storage/vercel-blob-storage-gateway";
import type { DemoMediaItem } from "../src/application/demo/demo-media-manifest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEDIA_DIR = join(__dirname, "demo-media");
const MANIFEST_PATH = join(__dirname, "..", "src", "application", "demo", "demo-media-manifest.ts");

const CONTENT_TYPES: Record<string, { contentType: string; type: DemoMediaItem["type"] }> = {
  ".mp4": { contentType: "video/mp4", type: "video" },
  ".mov": { contentType: "video/quicktime", type: "video" },
  ".webm": { contentType: "video/webm", type: "video" },
  ".jpg": { contentType: "image/jpeg", type: "image" },
  ".jpeg": { contentType: "image/jpeg", type: "image" },
  ".png": { contentType: "image/png", type: "image" },
  ".webp": { contentType: "image/webp", type: "image" },
};

function titleFromFilename(file: string): string {
  const raw = basename(file, extname(file)).replace(/[-_]+/g, " ").trim();
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

async function main(): Promise<void> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("BLOB_READ_WRITE_TOKEN não definido — rode com dotenv -e .env.local");
    process.exit(1);
  }
  if (!existsSync(MEDIA_DIR)) {
    mkdirSync(MEDIA_DIR, { recursive: true });
    console.log(`Pasta criada: ${MEDIA_DIR}\nColoque suas fotos/vídeos nela e rode de novo.`);
    process.exit(0);
  }

  const files = readdirSync(MEDIA_DIR).filter((f) => CONTENT_TYPES[extname(f).toLowerCase()]);
  if (files.length === 0) {
    console.log(`Nenhum arquivo suportado em ${MEDIA_DIR} (aceita: ${Object.keys(CONTENT_TYPES).join(", ")}).`);
    process.exit(0);
  }

  const storage = new VercelBlobStorageGateway();
  const items: DemoMediaItem[] = [];
  for (const file of files) {
    const ext = extname(file).toLowerCase();
    const { contentType, type } = CONTENT_TYPES[ext];
    const data = readFileSync(join(MEDIA_DIR, file));
    process.stdout.write(`↑ ${file} (${(data.length / 1024 / 1024).toFixed(1)} MB)… `);
    const url = await storage.upload(
      `demo-media/${basename(file, ext)}${ext}`,
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
      { contentType },
    );
    items.push({ id: randomUUID(), title: titleFromFilename(file), url, type });
    console.log("ok");
  }

  const header = readFileSync(MANIFEST_PATH, "utf8").split("export const DEMO_MEDIA_MANIFEST")[0];
  writeFileSync(
    MANIFEST_PATH,
    `${header}export const DEMO_MEDIA_MANIFEST: DemoMediaItem[] = ${JSON.stringify(items, null, 2)};\n`,
  );
  console.log(`\n${items.length} itens no manifest → ${MANIFEST_PATH}`);
  console.log("Agora rode: npm run seed:demo");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
