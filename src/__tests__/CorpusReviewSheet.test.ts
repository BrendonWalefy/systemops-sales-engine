import { describe, expect, it } from "vitest";
import {
  compareReviews,
  parseReviewSheet,
  renderReviewSheet,
  selectCalibrationSample,
} from "@/application/corpus/review-sheet";
import { loadCorpus } from "@/application/corpus/corpus-index";

const corpus = loadCorpus("evals/corpus");
const sample = corpus.cases.slice(0, 3);

describe("folha de revisão", () => {
  it("mostra turno, contexto, fatos do tenant e as duas respostas", () => {
    const sheet = renderReviewSheet({
      cases: sample,
      tenantConfigDirectory: "evals/corpus/tenant-configs",
    });

    expect(sheet).toContain(sample[0]!.caseId);
    expect(sheet).toContain("Fatos disponíveis do tenant");
    expect(sheet).toContain("Resposta da IA");
    expect(sheet).toContain("Resposta humana");
  });

  // Ancorar o segundo revisor no rótulo do primeiro destrói a medida de
  // concordância: ele passa a conferir uma resposta em vez de dar a dele.
  // A segunda revisão marcou quatro divergências que não eram julgamento: a
  // folha simplesmente não mostrava o fato. Estes são os fatos que faltavam.
  it("mostra a data do turno, sem a qual 'correto no momento' não se responde", () => {
    const sheet = renderReviewSheet({
      cases: sample,
      tenantConfigDirectory: "evals/corpus/tenant-configs",
    });

    expect(sheet).toContain(sample[0]!.source.capturedAt.slice(0, 10));
  });

  // A revisão do C.7 marcou "te enviei um vídeo" como afirmação sem lastro num
  // caso cujo side effect de mídia está gravado no corpus, com fonte. O lastro
  // existia; a folha é que não o mostrava.
  it("mostra o side effect observado com o que ele foi e de onde se sabe", () => {
    const withSideEffect = corpus.cases.filter(
      (entry) => (entry.observed.sideEffects ?? []).length > 0,
    );
    expect(withSideEffect.length).toBeGreaterThan(0);
    const sheet = renderReviewSheet({
      cases: withSideEffect.slice(0, 1),
      tenantConfigDirectory: "evals/corpus/tenant-configs",
    });
    const effect = withSideEffect[0]!.observed.sideEffects![0]!;

    expect(sheet).toContain(effect.detail);
    expect(sheet).toContain(effect.source);
  });

  // Sem saber se o catálogo é completo, o revisor não consegue julgar uma
  // negativa: "não trabalhamos com porcelana" tem lastro em catálogo fechado e
  // não tem em catálogo de completude desconhecida.
  it("diz se o catálogo do tenant é fechado ou de completude desconhecida", () => {
    const sheet = renderReviewSheet({
      cases: corpus.cases.slice(0, 3),
      tenantConfigDirectory: "evals/corpus/tenant-configs",
    });

    expect(sheet).toMatch(/completude do catálogo/i);
  });

  // Ausência precisa ser estado declarado, não silêncio. Sem esta linha, "o
  // turno não registrou agendamento" e "a folha não mostra side effect" ficam
  // indistinguíveis — e o revisor não tem como julgar "Agendado!".
  it("declara quando o turno não registrou ação nenhuma", () => {
    const semSideEffect = corpus.cases.filter(
      (entry) => (entry.observed.sideEffects ?? []).length === 0,
    );
    expect(semSideEffect.length).toBeGreaterThan(0);
    const sheet = renderReviewSheet({
      cases: semSideEffect.slice(0, 1),
      tenantConfigDirectory: "evals/corpus/tenant-configs",
    });

    expect(sheet).toContain("Nenhuma ação registrada neste turno");
  });

  // Mesma revisão marcou uma comparação de técnicas como inventada. Os dois
  // atributos estavam escritos em `services[].description` da fixture, e a folha
  // imprimia só quantos serviços têm descrição.
  // A folha ganhou side effect e descrição de serviço; cada campo novo é uma
  // chance nova de vazar o gabarito junto. Esta é a guarda que sobrevive às
  // próximas mudanças do renderer.
  it("não vaza rótulo, parecer, entendimento nem tag de revisor anterior", () => {
    const sheet = renderReviewSheet({
      cases: corpus.cases,
      tenantConfigDirectory: "evals/corpus/tenant-configs",
    });

    for (const entry of corpus.cases) {
      for (const assessment of [
        entry.labels.prose.ai,
        entry.labels.prose.human,
      ]) {
        if (assessment) expect(sheet).not.toContain(assessment.rationale);
      }
      if (entry.labels.understanding.notes) {
        expect(sheet).not.toContain(entry.labels.understanding.notes);
      }
      // Tag de uma palavra só repete o nome da jornada, que a folha mostra de
      // propósito; o que não pode vazar é a tag que carrega julgamento.
      for (const tag of entry.tags.filter((value) => /[-:]/.test(value))) {
        expect(sheet).not.toContain(tag);
      }
      expect(sheet).not.toContain(entry.labels.expectedActionResult.type);
      if (entry.validity) expect(sheet).not.toContain(entry.validity.reason);
    }
    for (const word of ["anti-pattern", "betterResponder", "golden"]) {
      expect(sheet).not.toContain(word);
    }
  });

  // Escopado à seção de fatos de propósito: a resposta sob julgamento também
  // contém essas palavras, e afirmar contra a folha inteira daria verde mesmo
  // se a fixture continuasse invisível — que é justamente o defeito.
  const factsSectionOf = (sheet: string): string =>
    sheet.slice(
      sheet.indexOf("**Fatos disponíveis do tenant"),
      sheet.indexOf("**Resposta da IA**"),
    );

  it("mostra a descrição do serviço que o turno menciona", () => {
    const comparison = corpus.cases.filter(
      (entry) => entry.caseId === "comparison-0001",
    );
    const facts = factsSectionOf(
      renderReviewSheet({
        cases: comparison,
        tenantConfigDirectory: "evals/corpus/tenant-configs",
      }),
    );

    expect(facts).toContain("resina nacional");
    expect(facts).toContain("resina importada");
  });

  // Descrição é evidência, não enchimento: despejar o catálogo inteiro em cada
  // caso afoga o fato que decide o julgamento.
  it("não despeja descrição de serviço que o turno não menciona", () => {
    const comparison = corpus.cases.filter(
      (entry) => entry.caseId === "comparison-0001",
    );
    const facts = factsSectionOf(
      renderReviewSheet({
        cases: comparison,
        tenantConfigDirectory: "evals/corpus/tenant-configs",
      }),
    );

    expect(facts).not.toContain("dentes trincados, lascados ou com cárie");
  });

  it("mostra flag comercial da fixture, não só nome e preço", () => {
    const sheet = renderReviewSheet({
      cases: corpus.cases.filter((c) => c.input.tenantConfigRef === "dental-a"),
      tenantConfigDirectory: "evals/corpus/tenant-configs",
    });

    expect(sheet).toMatch(/Avaliação Clínica Inicial.*sem custo/);
  });

  it("declara a mídia presente no turno em vez de deixá-la invisível", () => {
    const withMedia = corpus.cases.filter((entry) =>
      /\[MIDIA:/.test(entry.input.leadMessage),
    );
    expect(withMedia.length).toBeGreaterThan(0);

    const sheet = renderReviewSheet({
      cases: withMedia,
      tenantConfigDirectory: "evals/corpus/tenant-configs",
    });

    expect(sheet).toContain("Mídia neste turno");
  });

  it("lista os horários que já apareceram no fio, que são a evidência de agenda", () => {
    const withSlots = corpus.cases.filter((entry) =>
      entry.input.history.some(
        (turn) => turn.author !== "lead" && /\b\d{1,2}h(?:\d{2})?\b/.test(turn.body),
      ),
    );
    expect(withSlots.length).toBeGreaterThan(0);

    const sheet = renderReviewSheet({
      cases: withSlots,
      tenantConfigDirectory: "evals/corpus/tenant-configs",
    });

    expect(sheet).toContain("Horários já citados no fio");
  });

  // Sem isto, "a folha não mostrou" e "o tenant não tem" ficam indistinguíveis —
  // e foi assim que a segunda revisão marcou uma resposta correta como sem lastro.
  it("declara o que o tenant NÃO fornece, em vez de calar", () => {
    const atelier = corpus.cases.filter(
      (entry) => entry.input.tenantConfigRef === "atelier-a",
    );
    expect(atelier.length).toBeGreaterThan(0);

    const sheet = renderReviewSheet({
      cases: atelier,
      tenantConfigDirectory: "evals/corpus/tenant-configs",
    });

    expect(sheet).toContain("Não fornecido pela configuração");
    expect(sheet).toMatch(/atributo de serviço/i);
  });

  it("mostra a fonte do fato, que é como se responde 'de onde o sistema saberia'", () => {
    const sheet = renderReviewSheet({
      cases: sample,
      tenantConfigDirectory: "evals/corpus/tenant-configs",
    });

    expect(sheet).toContain("fonte:");
  });

  it("não vaza o rótulo nem o parecer do primeiro revisor", () => {
    const sheet = renderReviewSheet({
      cases: sample,
      tenantConfigDirectory: "evals/corpus/tenant-configs",
    });

    for (const entry of sample) {
      expect(sheet).not.toContain(entry.labels.prose.ai?.rationale ?? " ");
      expect(sheet).not.toContain(entry.labels.prose.human?.rationale ?? " ");
    }
    expect(sheet).not.toContain("anti-pattern");
  });

  // `synthetic_regression` no cabeçalho entrega o gabarito: caso sintético foi
  // escrito para ser defeito, e quem lê isso já sabe o rótulo antes de julgar.
  it("não revela a origem do caso", () => {
    const sheet = renderReviewSheet({
      cases: corpus.cases,
      tenantConfigDirectory: "evals/corpus/tenant-configs",
    });

    expect(sheet).not.toContain("synthetic_regression");
    expect(sheet).not.toContain("curated_demo");
    expect(sheet).not.toContain("historical");
  });

  // O segundo revisor também rotula entendimento e ação esperada. Mostrar os do
  // primeiro revisor transformaria a tarefa em conferência.
  it("pede Understanding e ActionResult em branco, sem mostrar os do primeiro", () => {
    const sheet = renderReviewSheet({
      cases: sample,
      tenantConfigDirectory: "evals/corpus/tenant-configs",
    });

    expect(sheet).toContain("UND:");
    expect(sheet).toContain("ACT:");
    for (const entry of sample) {
      expect(sheet).not.toContain(entry.labels.understanding.request);
      expect(sheet).not.toContain(entry.labels.expectedActionResult.type);
    }
  });

  // Dois casos dependem de um fato que não está nem no histórico nem no
  // catálogo — objeção cadastrada no playbook, e o conteúdo extra que veio no
  // nome de exibição. Sem ele o revisor julga com menos fato do que o primeiro
  // revisor teve; com ele, o fato tem de entrar sem o enquadramento de ninguém.
  it("renderiza fatos extras do caso na seção de fatos disponíveis", () => {
    const sheet = renderReviewSheet({
      cases: sample,
      tenantConfigDirectory: "evals/corpus/tenant-configs",
      extraFacts: { [sample[0]!.caseId]: ["Fato objetivo do caso."] },
    });

    const block = sheet.split("\n## ")[1] ?? "";
    const factsSection = block.slice(
      block.indexOf("Fatos disponíveis"),
      block.indexOf("**Resposta da IA**"),
    );
    expect(factsSection).toContain("Fato objetivo do caso.");
  });

  it("não renderiza fatos extras para casos que não os declaram", () => {
    const sheet = renderReviewSheet({
      cases: sample,
      tenantConfigDirectory: "evals/corpus/tenant-configs",
      extraFacts: { "nao-existe-0001": ["Nunca deve aparecer."] },
    });

    expect(sheet).not.toContain("Nunca deve aparecer.");
  });

  it("não carrega tag de regressão, que nomeia o defeito", () => {
    const sheet = renderReviewSheet({
      cases: corpus.cases,
      tenantConfigDirectory: "evals/corpus/tenant-configs",
    });

    expect(sheet).not.toMatch(/regression:/);
  });

  it("lê as marcas S e N da folha preenchida", () => {
    const answers = parseReviewSheet(`
price-0001 IA  [S] [N] [N] [N]
price-0001 HUM [S] [S] [S] [S]
price-0001 OBS: preço da estratificada não bate com o catálogo
`);

    expect(answers).toEqual([
      {
        caseId: "price-0001",
        ai: [true, false, false, false],
        human: [true, true, true, true],
        understanding: "",
        actionResult: "",
        notes: "preço da estratificada não bate com o catálogo",
      },
    ]);
  });

  // O segundo revisor escreve entendimento e ação em texto livre. Descartá-los
  // no parse jogaria fora metade do trabalho dele sem avisar ninguém.
  it("preserva o entendimento e a ação escritos pelo revisor", () => {
    const answers = parseReviewSheet(`
price-0001 UND: price-of-service · repeats · servico=lentes
price-0001 ACT: responder preço das duas técnicas
`);

    expect(answers[0]!.understanding).toBe(
      "price-of-service · repeats · servico=lentes",
    );
    expect(answers[0]!.actionResult).toBe("responder preço das duas técnicas");
  });

  // Caixa em branco é "não revisei", não "respondi não". Contar as duas coisas
  // como a mesma inventaria divergência onde houve silêncio.
  it("trata linha sem nenhuma marca como não revisada", () => {
    const answers = parseReviewSheet("price-0001 IA  [ ] [ ] [ ] [ ]");

    expect(answers[0]!.ai).toBeNull();
  });
});

describe("amostra estratificada de calibração", () => {
  // A primeira folha saiu por ordem alfabética de shard e não continha `price`
  // nem `objection` — as duas jornadas de julgamento mais difícil ficaram fora
  // justamente da amostra que existe para calibrar o julgamento.
  it("respeita a cota por grupo de jornadas", () => {
    const sample = selectCalibrationSample(corpus.cases, [
      { journeys: ["price"], count: 4 },
      { journeys: ["objection"], count: 3 },
      { journeys: ["availability", "scheduling"], count: 3 },
      { journeys: ["injection"], count: 1 },
    ]);

    expect(sample.filter((c) => c.journey === "price")).toHaveLength(4);
    expect(sample.filter((c) => c.journey === "objection")).toHaveLength(3);
    expect(
      sample.filter((c) => ["availability", "scheduling"].includes(c.journey)),
    ).toHaveLength(3);
    expect(sample).toHaveLength(11);
  });

  // Um grupo servido só por casos sintéticos ensina o revisor a reconhecer o
  // formato do defeito em vez de julgar a resposta.
  it("varia a origem dentro do grupo antes de repetir uma origem", () => {
    const sample = selectCalibrationSample(corpus.cases, [
      { journeys: ["price"], count: 3 },
    ]);
    const kinds = new Set(sample.map((entry) => entry.source.kind));

    expect(kinds.size).toBeGreaterThanOrEqual(3);
  });

  // Calibrar contra um caso estruturalmente inválido mede o defeito do caso.
  it("exclui da calibração o caso marcado como inválido", () => {
    const invalid = corpus.cases.filter((entry) => entry.validity);
    expect(invalid.length).toBeGreaterThan(0);

    const sample = selectCalibrationSample(
      corpus.cases,
      invalid.map((entry) => ({ journeys: [entry.journey], count: 20 })),
    );

    for (const entry of invalid) {
      expect(sample.map((c) => c.caseId)).not.toContain(entry.caseId);
    }
  });

  it("é determinística", () => {
    const quota = [{ journeys: ["price" as const], count: 4 }];
    const first = selectCalibrationSample(corpus.cases, quota).map((c) => c.caseId);
    const second = selectCalibrationSample([...corpus.cases].reverse(), quota).map(
      (c) => c.caseId,
    );

    expect(first).toEqual(second);
  });

  it("não completa a cota de um grupo com caso de outro", () => {
    const sample = selectCalibrationSample(corpus.cases, [
      { journeys: ["ambiguity"], count: 5 },
    ]);

    expect(sample.every((entry) => entry.journey === "ambiguity")).toBe(true);
  });
});

describe("concordância entre revisores", () => {
  const [first] = corpus.cases.filter((entry) => entry.labels.prose.ai);

  it("mede por campo do checklist, não por caso inteiro", () => {
    const mine = first!.labels.prose.ai!.checklist;
    const report = compareReviews({
      cases: [first!],
      answers: [
        {
          caseId: first!.caseId,
          ai: [
            mine.factuallyCorrect,
            !mine.addressedWhatTheLeadRaised,
            mine.advancedTheJourney,
            mine.wouldRepeatToday,
          ],
          human: null,
          understanding: "",
          actionResult: "",
          notes: "",
        },
      ],
    });

    expect(report.byField.factuallyCorrect!.rate).toBe(1);
    expect(report.byField.addressedWhatTheLeadRaised!.rate).toBe(0);
    expect(report.disagreements).toHaveLength(1);
    expect(report.disagreements[0]!.field).toBe("addressedWhatTheLeadRaised");
  });

  it("ignora caso que o segundo revisor não tocou", () => {
    const report = compareReviews({
      cases: [first!],
      answers: [
        {
          caseId: first!.caseId,
          ai: null,
          human: null,
          understanding: "",
          actionResult: "",
          notes: "",
        },
      ],
    });

    expect(report.reviewedCases).toBe(0);
  });
});
