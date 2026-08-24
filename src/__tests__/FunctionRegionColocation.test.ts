// As funções e o banco precisam morar no mesmo lugar.
//
// O Neon de produção roda em `aws-sa-east-1` (São Paulo). O projeto da Vercel
// tinha `serverlessFunctionRegion = iad1` (Virgínia), então TODA ida ao banco
// atravessava o Atlântico. Medido em produção em 22/08/2026, com 25 amostras
// intercaladas entre duas rotas da mesma origem para cancelar a distância do
// cliente:
//
//   /api/cron/sender-worker  (401, não toca no banco)  p50 182 ms
//   /api/health              (2 rodadas sequenciais)   p50 444 ms
//
// 262 ms de diferença para 2 rodadas = ~131 ms por ida e volta sequencial. O
// mesmo endpoint Neon, de um cliente em São Paulo, responde `select 1` em
// 11 ms (mediana de 12 amostras).
//
// Nenhuma consulta ficou mais barata com esta linha: o que mudou foi a
// distância. E como o custo é por RODADA, é isso que torna o colapso de
// waterfall do Inbox (InboxReadWaterfall.test.ts) uma decisão de UX e não uma
// micro-otimização.
//
// Seleção de região é gratuita no plano Pro — custo recorrente adicional $0.

import { describe, expect, it } from "vitest";
import vercelConfig from "../../vercel.json";

describe("colocação das funções com o banco", () => {
  it("as funções rodam em gru1, a região do Neon de produção", () => {
    expect(vercelConfig.regions).toEqual(["gru1"]);
  });

  it("uma região só — duas regiões devolveriam metade do tráfego ao Atlântico", () => {
    expect(vercelConfig.regions).toHaveLength(1);
  });
});
