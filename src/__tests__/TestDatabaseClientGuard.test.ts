import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Segunda camada da proteção. A política (TestDatabasePolicy.test.ts) responde
// "essa configuração é autorizada?". Este teste prova que a resposta é
// *aplicada* no único ponto por onde todo acesso a banco real passa: o cliente
// Drizzle. Isso é o que estende a proteção a testes que ainda não existem — um
// teste futuro que importe `db` sem mock não precisa lembrar de nada.

const originalEnv = { ...process.env };

async function loadClient() {
  vi.resetModules();
  return import("@/infrastructure/db/client");
}

function setEnv(env: Record<string, string | undefined>) {
  for (const key of ["DATABASE_URL", "TEST_DATABASE_HOST", "PRODUCTION_DATABASE_HOST"]) {
    delete process.env[key];
  }
  Object.assign(process.env, env);
}

beforeEach(() => {
  setEnv({});
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("cliente de banco sob teste", () => {
  it("recusa a conexão quando o host de teste não foi declarado", async () => {
    // Exatamente `dotenv -e .env.local -- vitest run`: a DATABASE_URL de
    // produção entra no processo e nada mais é declarado.
    setEnv({ DATABASE_URL: "postgres://user:secret@shared-db.neon.tech/neondb" });
    const { db } = await loadClient();

    expect(() => db.query).toThrow(/TEST_DATABASE_HOST is required/);
  });

  it("recusa quando o host declarado é o de produção", async () => {
    setEnv({
      DATABASE_URL: "postgres://user:secret@shared-db.neon.tech/neondb",
      TEST_DATABASE_HOST: "shared-db.neon.tech",
      PRODUCTION_DATABASE_HOST: "shared-db.neon.tech",
    });
    const { db } = await loadClient();

    expect(() => db.query).toThrow(/must differ from PRODUCTION_DATABASE_HOST/);
  });

  it("conecta quando o host declarado é uma branch de teste própria", async () => {
    setEnv({
      DATABASE_URL: "postgres://user:secret@test-branch.neon.tech/neondb",
      TEST_DATABASE_HOST: "test-branch.neon.tech",
      PRODUCTION_DATABASE_HOST: "shared-db.neon.tech",
    });
    const { db } = await loadClient();

    // O driver HTTP do Neon não abre conexão na construção — nenhuma query sai
    // daqui, só provamos que o guardrail deixou o cliente ser criado.
    expect(() => db.query).not.toThrow();
  });

  it("mantém a mensagem original quando não há banco nenhum", async () => {
    setEnv({});
    const { db } = await loadClient();

    expect(() => db.query).toThrow(/DATABASE_URL is not set/);
  });
});
