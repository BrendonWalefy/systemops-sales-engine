import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { MAX_OPERATOR_ATTACHMENT_BYTES } from "@/application/conversations/operator-attachment";

const mocks = vi.hoisted(() => ({
  getSessionClinicId: vi.fn(),
  handleUpload: vi.fn(),
  db: { select: vi.fn() },
}));

vi.mock("@/application/tenancy/resolve-clinic", () => ({
  getSessionClinicId: mocks.getSessionClinicId,
}));
vi.mock("@/infrastructure/db/client", () => ({ db: mocks.db }));
vi.mock("@vercel/blob/client", () => ({ handleUpload: mocks.handleUpload }));

import { POST } from "@/app/api/conversations/[conversationId]/attachment-upload/route";

function query(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
}

function request(payload: {
  pathname: string;
  fileName: string;
  contentType: string;
  size: number;
}) {
  return new NextRequest("http://systemops.test/api/conversations/conversation-1/attachment-upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

const ctx = { params: Promise.resolve({ conversationId: "conversation-1" }) };

describe("operator attachment upload route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionClinicId.mockResolvedValue("clinic-1");
    mocks.db.select.mockReturnValue(query([{ id: "conversation-1" }]));
    mocks.handleUpload.mockImplementation(async (options) => {
      const body = options.body as {
        pathname: string;
        fileName: string;
        contentType: string;
        size: number;
      };
      const tokenOptions = await options.onBeforeGenerateToken(
        body.pathname,
        JSON.stringify({
          fileName: body.fileName,
          contentType: body.contentType,
          size: body.size,
        }),
        body.size > 5 * 1024 * 1024,
      );
      return { type: "blob.generate-client-token", clientToken: "upload-token", tokenOptions };
    });
  });

  it("exige sessão e conversa pertencente à clínica", async () => {
    mocks.getSessionClinicId.mockResolvedValue(null);
    const unauthorized = await POST(request({
      pathname: "media/inbox/conversation-1/foto.jpg",
      fileName: "foto.jpg",
      contentType: "image/jpeg",
      size: 100,
    }), ctx);
    expect(unauthorized.status).toBe(401);

    mocks.getSessionClinicId.mockResolvedValue("clinic-1");
    mocks.db.select.mockReturnValue(query([]));
    const missing = await POST(request({
      pathname: "media/inbox/conversation-1/foto.jpg",
      fileName: "foto.jpg",
      contentType: "image/jpeg",
      size: 100,
    }), ctx);
    expect(missing.status).toBe(404);
    expect(mocks.handleUpload).not.toHaveBeenCalled();
  });

  it("autoriza upload válido com limite e tipos definidos no servidor", async () => {
    const response = await POST(request({
      pathname: "media/inbox/conversation-1/video.mp4",
      fileName: "video.mp4",
      contentType: "video/mp4",
      size: 8 * 1024 * 1024,
    }), ctx);

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.clientToken).toBe("upload-token");
    expect(json.tokenOptions).toMatchObject({
      maximumSizeInBytes: MAX_OPERATOR_ATTACHMENT_BYTES,
      addRandomSuffix: true,
    });
    expect(json.tokenOptions.allowedContentTypes).toContain("video/mp4");
  });

  it("recusa pathname de outra conversa e arquivo não suportado", async () => {
    const wrongConversation = await POST(request({
      pathname: "media/inbox/conversation-2/foto.jpg",
      fileName: "foto.jpg",
      contentType: "image/jpeg",
      size: 100,
    }), ctx);
    expect(wrongConversation.status).toBe(400);

    const executable = await POST(request({
      pathname: "media/inbox/conversation-1/programa.exe",
      fileName: "programa.exe",
      contentType: "application/octet-stream",
      size: 100,
    }), ctx);
    expect(executable.status).toBe(400);
  });
});
