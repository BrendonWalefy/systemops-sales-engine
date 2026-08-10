import { describe, expect, it } from "vitest";

const PAGE_SOURCE = "src/app/(clinic)/app/inbox/page.tsx";

async function readPageSource(): Promise<string> {
  const fs = await import("node:fs/promises");
  return fs.readFile(PAGE_SOURCE, "utf8");
}

describe("inbox page bounding", () => {
  it("delegates the base read to the paginated query", async () => {
    const source = await readPageSource();
    expect(source).toContain("listClinicConversations");
  });

  it("keeps the unbounded base select out of the page", async () => {
    const source = await readPageSource();
    expect(source).not.toMatch(/\.from\(conversations\)/);
  });

  it("derives the enrichment id lists from the returned page only", async () => {
    const source = await readPageSource();
    // conversationIds/salesLeadIds precisam sair de page.rows. Se voltarem a
    // sair de um select próprio, o inArray volta a crescer com o histórico.
    expect(source).toMatch(/const rows = page\.rows/);
    expect(source).toMatch(/const conversationIds = rows\.map/);
  });
});
