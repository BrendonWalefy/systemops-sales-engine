import { getSessionClinicId } from "@/application/tenancy/resolve-clinic";
import { parsePerformanceSample } from "@/application/observability/performance-telemetry";
import { createLogger } from "@/infrastructure/logging/logger";

const MAX_PAYLOAD_BYTES = 4096;

class PayloadTooLargeError extends Error {}

async function readJsonWithinLimit(request: Request): Promise<unknown> {
  if (!request.body) throw new SyntaxError("Missing JSON body");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_PAYLOAD_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new PayloadTooLargeError();
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

export async function POST(request: Request): Promise<Response> {
  if (process.env.PERFORMANCE_TELEMETRY_ENABLED !== "1") {
    return new Response(null, { status: 204 });
  }

  const clinicId = await getSessionClinicId();
  if (!clinicId) return new Response(null, { status: 401 });

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PAYLOAD_BYTES) {
    return new Response(null, { status: 413 });
  }

  try {
    const sample = parsePerformanceSample(await readJsonWithinLimit(request));
    if (
      sample.source !== "client"
      || !["soft_navigation", "content_ready", "app_first_open"].includes(sample.operation)
    ) {
      return new Response(null, { status: 400 });
    }

    try {
      createLogger({ scope: "PerformanceTelemetry", clinicId })
        .info("performance.sample", sample);
    } catch {
      // Logging failures must not make navigation telemetry observable to the client.
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    return new Response(null, {
      status: error instanceof PayloadTooLargeError ? 413 : 400,
    });
  }
}
