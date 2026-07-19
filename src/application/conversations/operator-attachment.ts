export type OperatorAttachmentType = "image" | "video" | "document";

export const MAX_OPERATOR_ATTACHMENT_BYTES = 100 * 1024 * 1024;

export const OPERATOR_ATTACHMENT_ACCEPT = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "application/pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".txt",
  ".csv",
].join(",");

const MIME_TYPES: Record<string, OperatorAttachmentType> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "video/mp4": "video",
  "video/quicktime": "video",
  "video/webm": "video",
  "application/pdf": "document",
  "application/msword": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
  "application/vnd.ms-excel": "document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "document",
  "application/vnd.ms-powerpoint": "document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "document",
  "text/plain": "document",
  "text/csv": "document",
};

export const OPERATOR_ATTACHMENT_CONTENT_TYPES = [
  ...Object.keys(MIME_TYPES),
  "application/octet-stream",
];

const EXTENSION_TYPES: Record<string, OperatorAttachmentType> = {
  jpg: "image",
  jpeg: "image",
  png: "image",
  webp: "image",
  mp4: "video",
  mov: "video",
  webm: "video",
  pdf: "document",
  doc: "document",
  docx: "document",
  xls: "document",
  xlsx: "document",
  ppt: "document",
  pptx: "document",
  txt: "document",
  csv: "document",
};

export type OperatorAttachmentInspection = {
  mediaType: OperatorAttachmentType;
  extension: string;
  safeFileName: string;
};

export function inspectOperatorAttachment(file: {
  name: string;
  type: string;
  size: number;
}): { value: OperatorAttachmentInspection } | { error: string } {
  if (file.size <= 0) return { error: "O arquivo está vazio." };
  if (file.size > MAX_OPERATOR_ATTACHMENT_BYTES) {
    return { error: "Arquivo muito grande. O limite é 100 MB." };
  }

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const typeFromExtension = EXTENSION_TYPES[extension];
  const normalizedMime = file.type.toLowerCase().trim();
  const typeFromMime = MIME_TYPES[normalizedMime];

  if (!typeFromExtension || (!typeFromMime && normalizedMime && normalizedMime !== "application/octet-stream")) {
    return { error: "Formato não suportado. Envie foto, vídeo, PDF ou documento Office." };
  }
  if (typeFromMime && typeFromMime !== typeFromExtension) {
    return { error: "A extensão do arquivo não corresponde ao seu conteúdo." };
  }

  const baseName = file.name
    .split(/[\\/]/)
    .pop()!
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"|?*]/g, "_")
    .trim()
    .slice(0, 120);
  const safeFileName = baseName || `anexo.${extension}`;

  return {
    value: {
      mediaType: typeFromMime ?? typeFromExtension,
      extension,
      safeFileName,
    },
  };
}

export function formatAttachmentSize(size: number): string {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1).replace(".0", "")} MB`;
}
