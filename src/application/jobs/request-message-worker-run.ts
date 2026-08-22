/**
 * Acorda o worker na hora em que o trabalho nasce, em vez de esperar o próximo
 * tick do cron.
 *
 * O caminho de resposta era: webhook grava o job -> cron de 1 em 1 minuto
 * descobre o job -> orquestrador responde. O primeiro salto custava até 60 s de
 * espera para o lead, e cobrar esse minuto de todo mundo tinha um segundo
 * preço: o cron precisava rodar a cada minuto MESMO quando não havia nada para
 * fazer, e um toque por minuto no Postgres impede o Neon de suspender o compute
 * (o autosuspend padrão é 300 s). Medido em 22/08/2026, o compute de produção
 * estava de pé sem interrupção desde 18/07 — 35 dias — com zero clínica com
 * resposta automática ligada.
 *
 * Com o webhook chamando o worker, o cron deixa de ser o caminho normal e vira
 * rede de segurança: quem cria trabalho é que anuncia o trabalho, e sem
 * trabalho o banco não é tocado.
 *
 * Regras deste módulo:
 *  - nunca lança: uma falha aqui degrada para o cron, não derruba o webhook;
 *  - nunca espera a resposta importar: o resultado é só para log/teste;
 *  - só é chamado quando o job era NOVO — webhook repetido não acorda ninguém.
 */

export type MessageWorkerRunRequest =
  | { requested: true; status: number }
  | { requested: false; reason: "disabled" | "no_base_url" | "no_secret" | "failed" };

type WorkerEnv = Record<string, string | undefined>;

export type RequestMessageWorkerRunDeps = {
  env?: WorkerEnv;
  fetchImpl?: typeof fetch;
};

/** Base pública desta instalação, sem barra no fim. */
export function resolveWorkerBaseUrl(env: WorkerEnv): string | null {
  const configured = env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  // Em preview/produção a Vercel injeta o host da própria implantação; é o
  // fallback certo para uma chamada que precisa cair NESTA versão do código.
  const vercelUrl = env.VERCEL_URL?.trim();
  if (vercelUrl) return `https://${vercelUrl.replace(/\/+$/, "")}`;
  return null;
}

export async function requestMessageWorkerRun(
  deps: RequestMessageWorkerRunDeps = {},
): Promise<MessageWorkerRunRequest> {
  const env = deps.env ?? process.env;
  if (env.DISABLE_WORKER_KICK === "1") return { requested: false, reason: "disabled" };

  const secret = env.CRON_SECRET?.trim();
  if (!secret) return { requested: false, reason: "no_secret" };

  const baseUrl = resolveWorkerBaseUrl(env);
  if (!baseUrl) return { requested: false, reason: "no_base_url" };

  const fetchImpl = deps.fetchImpl ?? fetch;
  // `ack=1`: o worker confirma o recebimento e drena a fila DEPOIS de
  // responder, no orçamento da própria invocação (maxDuration 300). Sem isso
  // esta chamada ficaria presa até o drenar inteiro terminar — segurando a
  // invocação do webhook por minutos, e pagando função duas vezes pelo mesmo
  // trabalho. Abortar por timeout também não serve: cortar a conexão no meio
  // é justamente o caso em que se corre o risco de matar o drenar.
  try {
    const response = await fetchImpl(`${baseUrl}/api/cron/message-worker?ack=1`, {
      method: "GET",
      headers: { authorization: `Bearer ${secret}` },
      cache: "no-store",
    });
    return { requested: true, status: response.status };
  } catch {
    // Rede fora, deploy trocando, worker indisponível: o cron cobre o que
    // sobrar. Nunca propaga para o webhook.
    return { requested: false, reason: "failed" };
  }
}

/**
 * Agenda o pedido para depois da resposta ao provedor.
 *
 * Envolvido em try/catch porque `after()` LANÇA fora de um escopo de
 * requisição — e o webhook não pode virar 500 por causa do atalho: um 500 faz
 * a Z-API e a Meta reentregarem a mensagem, transformando uma otimização de
 * latência numa fonte de trabalho duplicado. Se agendar falhar, o cron cobre.
 */
export function scheduleMessageWorkerKick(
  schedule: (task: () => Promise<void>) => void,
  onResult?: (result: MessageWorkerRunRequest) => void,
): void {
  try {
    schedule(async () => {
      const result = await requestMessageWorkerRun();
      onResult?.(result);
    });
  } catch {
    // Sem escopo de requisição (teste, runtime alternativo): segue sem atalho.
  }
}
