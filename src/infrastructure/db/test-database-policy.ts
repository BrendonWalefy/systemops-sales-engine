/**
 * Quem pode escrever no banco durante os testes.
 *
 * Motivo de existir: `src/__tests__/calendar-import.test.ts` era guardado só por
 * `describe.skipIf(!process.env.DATABASE_URL)`. Isso pergunta "existe um banco?",
 * nunca "esse banco pode ser sujado?" — então qualquer invocação no formato
 * `dotenv -e .env.local -- vitest run` escrevia calada no banco compartilhado que
 * guarda o histórico de Vitalli, Ximendes e NC Beauty. Acumularam 16 linhas de
 * `professionals` órfãs até o próprio teste falhar contra o resíduo que criou.
 *
 * A política troca essa pergunta: só existe autorização de escrita quando o dev
 * declara, explicitamente e em separado, *qual* host ele pretende sujar
 * (`TEST_DATABASE_HOST`) e *qual* host é produção (`PRODUCTION_DATABASE_HOST`).
 * Apontar teste para produção passa a exigir escrever a mentira duas vezes.
 *
 * Espelha `assertReplaySandboxEnvironment` de propósito: o repositório já resolve
 * "esse banco é o certo?" comparando host declarado contra host da conexão.
 */
export type TestDatabaseAccess =
  | { mode: "unavailable"; reason: string }
  | { mode: "authorized"; host: string; database: string };

/**
 * Só as três chaves que importam. Tipar como `NodeJS.ProcessEnv` obrigaria todo
 * caso de teste a carregar `NODE_ENV` só para satisfazer o tipo — ruído que
 * esconde qual variável cada caso está de fato exercitando.
 */
export type TestDatabaseEnvironment = {
  DATABASE_URL?: string;
  TEST_DATABASE_HOST?: string;
  PRODUCTION_DATABASE_HOST?: string;
  // Index signature para `process.env` (NodeJS.ProcessEnv) entrar direto.
  [key: string]: string | undefined;
};

export function resolveTestDatabaseAccess(env: TestDatabaseEnvironment): TestDatabaseAccess {
  const databaseUrl = env.DATABASE_URL?.trim();
  // Caminho do `npm run verify` e do CI: sem banco, os testes de integração são
  // pulados. Ausência de banco é a configuração segura, não um erro.
  if (!databaseUrl) {
    return { mode: "unavailable", reason: "DATABASE_URL is not set" };
  }

  // A partir daqui todo caminho de saída é `authorized` ou exceção: existe um
  // banco alcançável e é tarde demais para falhar em silêncio.
  const connection = parseConnection(databaseUrl);

  const testHost = required(
    env.TEST_DATABASE_HOST,
    "TEST_DATABASE_HOST is required when DATABASE_URL is set during tests: " +
      "declare which database host the tests are allowed to write to, " +
      "or unset DATABASE_URL to skip the integration tests",
  ).toLowerCase();

  if (connection.host !== testHost) {
    throw new Error(
      `DATABASE_URL host (${connection.host}) does not match TEST_DATABASE_HOST (${testHost})`,
    );
  }

  const productionHost = required(
    env.PRODUCTION_DATABASE_HOST,
    "PRODUCTION_DATABASE_HOST is required when tests may write: " +
      "the guardrail cannot tell a test branch from production without it",
  ).toLowerCase();

  if (testHost === productionHost) {
    throw new Error(
      `TEST_DATABASE_HOST (${testHost}) must differ from PRODUCTION_DATABASE_HOST`,
    );
  }

  return { mode: "authorized", host: connection.host, database: connection.database };
}

function parseConnection(databaseUrl: string): { host: string; database: string } {
  try {
    const url = new URL(databaseUrl);
    return {
      host: url.hostname.toLowerCase(),
      database: url.pathname.replace(/^\//, ""),
    };
    // A URL nunca entra na mensagem: ela carrega a senha do banco, e esse erro
    // termina em log de CI.
  } catch {
    throw new Error("DATABASE_URL is not a valid connection string");
  }
}

function required(value: string | undefined, message: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(message);
  return trimmed;
}
