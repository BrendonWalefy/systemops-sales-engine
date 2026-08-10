import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { is, SQL } from "drizzle-orm";
import { clinicReadVersions } from "@/infrastructure/db/schema";

// `db` é mockado abaixo, então bumpClinicReadVersion/readClinicVersion nunca
// tocam um banco real. Os testes verificam a *forma* da query montada — SQL
// renderizado via PgDialect sem conexão — não o comportamento real do
// Postgres (se o upsert de fato resolve a corrida de concorrência). Isso é
// justamente o que a task pede para provar sem banco: que o incremento é uma
// expressão SQL (`version + 1` calculado pelo Postgres), não um número
// calculado em JavaScript, e que o alvo do conflito é a chave composta.

const dbMock = vi.hoisted(() => ({
  insert: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@/infrastructure/db/client", () => ({ db: dbMock }));

import { bumpClinicReadVersion, readClinicVersion } from "@/application/read-versions/clinic-read-version";

const dialect = new PgDialect();

function renderFragment(fragment: unknown) {
  return dialect.sqlToQuery(fragment as Parameters<PgDialect["sqlToQuery"]>[0]);
}

function insertChain() {
  return {
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  };
}

function selectChain(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
}

describe("clinic read versions table", () => {
  it("is keyed by clinic and resource", () => {
    const config = getTableConfig(clinicReadVersions);
    const pk = config.primaryKeys[0];
    expect(pk?.columns.map((c) => c.name)).toEqual(["organization_id", "resource"]);
  });

  it("stores a monotonic version and its update time", () => {
    const names = getTableConfig(clinicReadVersions).columns.map((c) => c.name);
    expect(names).toContain("version");
    expect(names).toContain("updated_at");
  });
});

describe("bumpClinicReadVersion", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is a single insert..onConflictDoUpdate statement targeting the composite (clinic, resource) key — never read-then-write", async () => {
    const chain = insertChain();
    dbMock.insert.mockReturnValue(chain);

    await bumpClinicReadVersion("clinic-1", "inbox");

    expect(dbMock.insert).toHaveBeenCalledOnce();
    expect(dbMock.insert).toHaveBeenCalledWith(clinicReadVersions);
    expect(dbMock.select).not.toHaveBeenCalled();
    expect(chain.values).toHaveBeenCalledWith({ clinicId: "clinic-1", resource: "inbox", version: 1 });
    expect(chain.onConflictDoUpdate).toHaveBeenCalledOnce();

    const call = chain.onConflictDoUpdate.mock.calls[0][0];
    expect(call.target).toEqual([clinicReadVersions.clinicId, clinicReadVersions.resource]);
  });

  it("expresses the increment as a database expression (version + 1), not a JavaScript-computed number", async () => {
    const chain = insertChain();
    dbMock.insert.mockReturnValue(chain);

    await bumpClinicReadVersion("clinic-1", "inbox");

    const call = chain.onConflictDoUpdate.mock.calls[0][0];
    // Se algum dia isso virasse `set.version = someJsNumber`, `is(..., SQL)`
    // falharia — é a diferença entre o Postgres calcular o incremento e o
    // Node calcular (e uma corrida entre bumps concorrentes derrubar um deles).
    expect(is(call.set.version, SQL)).toBe(true);
    const rendered = renderFragment(call.set.version);
    expect(rendered.sql).toBe('"clinic_read_versions"."version" + 1');
    expect(rendered.params).toEqual([]);
  });
});

describe("readClinicVersion", () => {
  beforeEach(() => vi.clearAllMocks());

  it("scopes the read by clinicId and resource", async () => {
    const chain = selectChain([]);
    dbMock.select.mockReturnValue(chain);

    await readClinicVersion("clinic-1", "inbox");

    expect(chain.where).toHaveBeenCalledOnce();
    const rendered = renderFragment(chain.where.mock.calls[0][0]);
    expect(rendered.sql).toBe(
      '("clinic_read_versions"."organization_id" = $1 and "clinic_read_versions"."resource" = $2)',
    );
    expect(rendered.params).toEqual(["clinic-1", "inbox"]);
  });

  it('returns "0" when no row exists yet for the clinic/resource pair', async () => {
    dbMock.select.mockReturnValue(selectChain([]));

    const version = await readClinicVersion("clinic-1", "inbox");

    expect(version).toBe("0");
  });

  it("returns the stored version as a string", async () => {
    dbMock.select.mockReturnValue(selectChain([{ version: 42 }]));

    const version = await readClinicVersion("clinic-1", "inbox");

    expect(version).toBe("42");
  });
});
