import type { StorageGateway, StorageUploadOptions } from "@/application/ports/storage-gateway";
import { put, del } from "@vercel/blob";

export class VercelBlobStorageGateway implements StorageGateway {
  async upload(key: string, data: ArrayBuffer, options: StorageUploadOptions): Promise<string> {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      throw new Error("BLOB_READ_WRITE_TOKEN não configurado — adicione no painel Vercel > Settings > Environment Variables");
    }
    const blob = await put(key, data, {
      access: "public",
      contentType: options.contentType,
      addRandomSuffix: true,
    });
    return blob.url;
  }

  async delete(url: string): Promise<void> {
    if (!process.env.BLOB_READ_WRITE_TOKEN) return;
    await del(url);
  }
}
