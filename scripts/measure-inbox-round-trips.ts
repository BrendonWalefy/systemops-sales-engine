/**
 * Mede o custo REAL da leitura do Inbox: quantas idas ao Postgres a página faz,
 * quantas delas estão em fila uma atrás da outra, e quantos bytes voltam.
 *
 * Por que estas três grandezas e não só o relógio: a função serverless
 * (`iad1`) e o banco (`aws-sa-east-1`) não estão na mesma região, então cada
 * ida-e-volta ao banco custa ~130 ms de rede em produção, contra ~11 ms quando
 * medida de São Paulo. O relógio desta máquina, portanto, SUBESTIMA a
 * produção — o número que se transporta entre ambientes é
 * `rodadas_sequenciais x RTT_da_região`, e é ele que este script mede.
 *
 * `sequential_rounds` é a profundidade do waterfall: consultas disparadas em
 * paralelo contam como UMA rodada, porque é isso que o usuário espera.
 *
 * Uso (leitura apenas — nenhuma escrita):
 *
 *   npm run measure:inbox -- --clinic <clinicId>
 *   npm run measure:inbox -- --clinic <clinicId> --conversation <conversationId>
 *
 * O script exige DATABASE_URL explícito e nunca escreve nada.
 */

type RoundTrip = { startedAt: number; endedAt: number; bytes: number; statement: string };

const roundTrips: RoundTrip[] = [];
const originalFetch = globalThis.fetch;

function installProbe(): void {
  globalThis.fetch = (async (input: Parameters<typeof originalFetch>[0], init?: Parameters<typeof originalFetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    if (!url.includes("neon.tech")) return originalFetch(input, init);

    let statement = "";
    try {
      const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string };
      statement = (body.query ?? "").replace(/\s+/g, " ").trim();
    } catch {
      statement = "<batch>";
    }

    const startedAt = performance.now();
    const response = await originalFetch(input, init);
    const payload = await response.clone().arrayBuffer();
    roundTrips.push({ startedAt, endedAt: performance.now(), bytes: payload.byteLength, statement });
    return response;
  }) as typeof originalFetch;
}

/**
 * Rodadas sequenciais: percorre as chamadas por horário de início e conta uma
 * rodada nova só quando a chamada começou DEPOIS da anterior ter terminado.
 * Um lote disparado junto (Promise.all) vira uma rodada só.
 */
export function countSequentialRounds(calls: Array<{ startedAt: number; endedAt: number }>): number {
  const ordered = [...calls].sort((a, b) => a.startedAt - b.startedAt);
  let rounds = 0;
  let openUntil = Number.NEGATIVE_INFINITY;
  for (const call of ordered) {
    if (call.startedAt >= openUntil) {
      rounds += 1;
      openUntil = call.endedAt;
    }
  }
  return rounds;
}

function report(label: string, wallMs: number): void {
  const bytes = roundTrips.reduce((total, call) => total + call.bytes, 0);
  const rounds = countSequentialRounds(roundTrips);
  console.log(`\n=== ${label} ===`);
  console.log(
    `wall_ms=${wallMs.toFixed(0)}  db_round_trips=${roundTrips.length}  ` +
      `sequential_rounds=${rounds}  db_payload_bytes=${bytes}`,
  );
  const origin = Math.min(...roundTrips.map((call) => call.startedAt));
  for (const call of [...roundTrips].sort((a, b) => a.startedAt - b.startedAt)) {
    const at = (call.startedAt - origin).toFixed(0).padStart(5);
    const took = (call.endedAt - call.startedAt).toFixed(0).padStart(4);
    console.log(`  t+${at}ms ${took}ms ${String(call.bytes).padStart(8)}B  ${call.statement.slice(0, 110)}`);
  }
}

function argOf(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

  const clinicId = argOf("--clinic");
  const conversationId = argOf("--conversation");
  if (!clinicId && !conversationId) {
    throw new Error("informe --clinic <id> e/ou --conversation <id>");
  }

  installProbe();

  if (clinicId) {
    const { prepareInboxPage } = await import("@/app/(clinic)/app/inbox/page");
    const startedAt = performance.now();
    await prepareInboxPage(clinicId, {});
    report(`INBOX LIST — clinic ${clinicId}`, performance.now() - startedAt);
    roundTrips.length = 0;
  }

  if (conversationId) {
    const page = await import("@/app/(clinic)/app/inbox/[conversationId]/page");
    const startedAt = performance.now();
    await page.default({ params: Promise.resolve({ conversationId }) });
    report(`CONVERSATION — ${conversationId}`, performance.now() - startedAt);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
