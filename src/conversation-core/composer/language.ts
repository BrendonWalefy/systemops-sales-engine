export type ValueFormat =
  | "text"
  | "integer"
  | "currency_minor_brl"
  | "boolean";

export type ResponseLanguageContribution = {
  locale: "pt-BR";
  factTerms: readonly {
    factKey: string;
    label: string;
    format: ValueFormat;
  }[];
  outcomeTerms: readonly {
    outcomeType: string;
    label: string;
    gender: "masculine" | "feminine";
  }[];
  subjectTerms: readonly {
    subjectType: string;
    label: string;
  }[];
};

function assertTerms(
  terms: readonly { label: string }[],
  identities: readonly string[],
): void {
  if (new Set(identities).size !== identities.length) {
    throw new Error("response language contains duplicate terms");
  }
  for (const { label } of terms) {
    if (
      label.length === 0 ||
      label.length > 60 ||
      label !== label.trim() ||
      /[\r\n.!?]/.test(label)
    ) {
      throw new Error("response language labels must be short noun phrases");
    }
  }
}

export function createResponseLanguageContribution(
  contribution: ResponseLanguageContribution,
): ResponseLanguageContribution {
  assertTerms(
    contribution.factTerms,
    contribution.factTerms.map(({ factKey }) => factKey),
  );
  assertTerms(
    contribution.outcomeTerms,
    contribution.outcomeTerms.map(({ outcomeType }) => outcomeType),
  );
  assertTerms(
    contribution.subjectTerms,
    contribution.subjectTerms.map(({ subjectType }) => subjectType),
  );
  return contribution;
}
