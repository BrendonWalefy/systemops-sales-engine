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

  it("derives the enrichment id lists from the bounded page window only", async () => {
    const source = await readPageSource();
    // `pageIds` sai de selectInboxPageWindow, que é limitado a
    // INBOX_PAGE_SIZE. Se o inArray do enriquecimento voltar a ser alimentado
    // por qualquer outra lista, ele volta a crescer com o histórico da clínica.
    expect(source).toMatch(/const pageIds = pageWindow\.ids/);
    for (const match of source.matchAll(/inArray\((\w+)\.(\w+), (\w+)\)/g)) {
      expect(match[3]).toBe("pageIds");
    }
  });

  it("does not re-read clinic-wide enrichment the segment scan already paid for", async () => {
    const source = await readPageSource();
    // Agendamentos e revisões humanas saem de segmentIndex.reads. Um
    // `.from(appointments)`/`.from(humanReviewRequests)` de volta aqui é a
    // mesma consulta da varredura repetida uma segunda vez por render.
    expect(source).not.toMatch(/\.from\(appointments\)/);
    expect(source).not.toMatch(/\.from\(humanReviewRequests\)/);
  });
});
