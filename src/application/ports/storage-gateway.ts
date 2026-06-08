export type StorageUploadOptions = {
  contentType: string;
  /** TTL in seconds. Provider may ignore if not supported. */
  ttlSeconds?: number;
  folder?: string;
};

export type StorageGateway = {
  upload(key: string, data: ArrayBuffer, options: StorageUploadOptions): Promise<string>;
  delete(url: string): Promise<void>;
};
