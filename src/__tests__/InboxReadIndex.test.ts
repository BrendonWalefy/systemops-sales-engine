import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { conversations } from "@/infrastructure/db/schema";

describe("conversations read index", () => {
  it("indexes the clinic + last message ordering used by the inbox", () => {
    const names = getTableConfig(conversations).indexes.map((i) => i.config.name);
    expect(names).toContain("conversations_org_last_message_idx");
  });

  // Nome + ordem das colunas sozinhos não são o contrato: um `.desc()` que
  // virasse `.asc()`, ou um NULLS FIRST em qualquer chave, passaria por esta
  // asserção e mesmo assim faria o planner ter que ordenar por cima do índice
  // (os pathkeys deixam de casar com o ORDER BY da página). Direção e
  // colocação de nulos entram na asserção junto com o nome.
  it("orders the index columns — direção e NULLS incluídos — to match the inbox keyset", () => {
    const index = getTableConfig(conversations).indexes.find(
      (i) => i.config.name === "conversations_org_last_message_idx",
    );
    const columns = index?.config.columns as
      | { name: string; indexConfig?: { order?: string; nulls?: string } }[]
      | undefined;

    expect(
      columns?.map((column) => ({
        name: column.name,
        order: column.indexConfig?.order,
        nulls: column.indexConfig?.nulls,
      })),
    ).toEqual([
      { name: "organization_id", order: "asc", nulls: "last" },
      { name: "last_message_at", order: "desc", nulls: "last" },
      { name: "id", order: "desc", nulls: "last" },
    ]);
  });
});
