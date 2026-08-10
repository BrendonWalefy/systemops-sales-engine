import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { conversations } from "@/infrastructure/db/schema";

describe("conversations read index", () => {
  it("indexes the clinic + last message ordering used by the inbox", () => {
    const names = getTableConfig(conversations).indexes.map((i) => i.config.name);
    expect(names).toContain("conversations_org_last_message_idx");
  });

  it("orders the index columns to match the inbox keyset", () => {
    const index = getTableConfig(conversations).indexes.find(
      (i) => i.config.name === "conversations_org_last_message_idx",
    );
    expect(index?.config.columns.map((c) => (c as { name: string }).name)).toEqual([
      "organization_id",
      "last_message_at",
      "id",
    ]);
  });
});
