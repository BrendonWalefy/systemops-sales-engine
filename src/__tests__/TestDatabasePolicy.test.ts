import { describe, expect, it } from "vitest";
import {
  resolveTestDatabaseAccess,
  type TestDatabaseEnvironment,
} from "@/infrastructure/db/test-database-policy";

// Ambiente autorizado mínimo: o host da DATABASE_URL é o mesmo que o dev
// declarou em TEST_DATABASE_HOST, e ele é diferente do host de produção.
const authorized = {
  DATABASE_URL: "postgres://user:secret@test-branch.neon.tech/neondb",
  TEST_DATABASE_HOST: "test-branch.neon.tech",
  PRODUCTION_DATABASE_HOST: "prod-branch.neon.tech",
} satisfies TestDatabaseEnvironment;

describe("política de banco para testes", () => {
  it("sem DATABASE_URL, testes de integração ficam indisponíveis e são pulados", () => {
    // Esse é o caminho do `npm run verify` e do CI: nenhum banco, nenhum risco.
    expect(resolveTestDatabaseAccess({})).toEqual({
      mode: "unavailable",
      reason: "DATABASE_URL is not set",
    });
    expect(
      resolveTestDatabaseAccess({ DATABASE_URL: "   " }),
    ).toEqual({ mode: "unavailable", reason: "DATABASE_URL is not set" });
  });

  it("autoriza escrita quando o host declarado bate com a DATABASE_URL", () => {
    expect(resolveTestDatabaseAccess(authorized)).toEqual({
      mode: "authorized",
      host: "test-branch.neon.tech",
      database: "neondb",
    });
  });

  // O caso que produziu o resíduo: `dotenv -e .env.local -- vitest run`. Antes
  // desta política isso rodava calado contra o banco compartilhado.
  it("recusa DATABASE_URL sem declaração explícita de host de teste", () => {
    expect(() =>
      resolveTestDatabaseAccess({
        DATABASE_URL: authorized.DATABASE_URL,
      }),
    ).toThrow(/TEST_DATABASE_HOST is required/);
  });

  it("recusa quando a DATABASE_URL aponta para outro host que não o declarado", () => {
    expect(() =>
      resolveTestDatabaseAccess({
        ...authorized,
        DATABASE_URL: "postgres://user:secret@shared-db.neon.tech/neondb",
      }),
    ).toThrow(/does not match TEST_DATABASE_HOST/);
  });

  it("recusa quando o host de produção não foi declarado", () => {
    expect(() =>
      resolveTestDatabaseAccess({ ...authorized, PRODUCTION_DATABASE_HOST: undefined }),
    ).toThrow(/PRODUCTION_DATABASE_HOST is required/);
  });

  it("recusa quando o host de teste é o próprio host de produção", () => {
    expect(() =>
      resolveTestDatabaseAccess({
        ...authorized,
        PRODUCTION_DATABASE_HOST: "test-branch.neon.tech",
      }),
    ).toThrow(/must differ from PRODUCTION_DATABASE_HOST/);
  });

  it("ignora maiúsculas e espaços na comparação de host", () => {
    expect(
      resolveTestDatabaseAccess({
        ...authorized,
        TEST_DATABASE_HOST: "  TEST-Branch.neon.tech  ",
      }),
    ).toMatchObject({ mode: "authorized", host: "test-branch.neon.tech" });
  });

  it("recusa DATABASE_URL que não é uma URL", () => {
    expect(() =>
      resolveTestDatabaseAccess({ ...authorized, DATABASE_URL: "not-a-url" }),
    ).toThrow(/DATABASE_URL is not a valid connection string/);
  });

  it("nunca vaza a credencial da connection string na mensagem de erro", () => {
    // O erro é lido em log de CI e colado em issue — não pode carregar a senha.
    try {
      resolveTestDatabaseAccess({
        DATABASE_URL: "postgres://user:sup3rs3cret@shared-db.neon.tech/neondb",
      });
      throw new Error("deveria ter lançado");
    } catch (error) {
      expect((error as Error).message).not.toContain("sup3rs3cret");
    }
  });
});
