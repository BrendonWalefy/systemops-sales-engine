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

declare const validatedLanguageContribution: unique symbol;
export type ValidatedResponseLanguageContribution = ResponseLanguageContribution & {
  readonly [validatedLanguageContribution]: true;
};

const validatedContributions = new WeakSet<object>();

export function assertValidatedResponseLanguageContribution(
  contribution: ValidatedResponseLanguageContribution,
): void {
  if (!validatedContributions.has(contribution)) {
    throw new Error("language contribution was not validated");
  }
}

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
): ValidatedResponseLanguageContribution {
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
  const snapshot = Object.freeze({
    locale: contribution.locale,
    factTerms: Object.freeze(contribution.factTerms.map((term) => Object.freeze({ ...term }))),
    outcomeTerms: Object.freeze(contribution.outcomeTerms.map((term) => Object.freeze({ ...term }))),
    subjectTerms: Object.freeze(contribution.subjectTerms.map((term) => Object.freeze({ ...term }))),
  }) as ValidatedResponseLanguageContribution;
  validatedContributions.add(snapshot);
  return snapshot;
}
