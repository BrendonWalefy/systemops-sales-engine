import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Rota legada mantida apenas por compatibilidade temporária com clientes antigos
// e com os tipos gerados do Next durante a transição do realtime global.
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { error: "Deprecated" },
    { status: 410, headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
