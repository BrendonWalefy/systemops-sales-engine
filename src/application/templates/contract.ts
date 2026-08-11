export const PLACEHOLDER_KINDS = ["blocking", "defaulted"] as const;
export type PlaceholderKind = typeof PLACEHOLDER_KINDS[number];

export const PRICE_CHANNELS = ["text", "media", "human"] as const;
export type PriceChannel = typeof PRICE_CHANNELS[number];

// Os únicos destinos que um plano pode escrever. Qualquer outro é defeito de
// contrato: o runtime lê destas tabelas, e uma segunda dona da mesma
// informação é exatamente o que sources-of-truth.md proíbe.
export const CANONICAL_OWNERS = [
  "organizations",
  "treatments",
  "playbook_versions",
] as const;
export type CanonicalOwner = typeof CANONICAL_OWNERS[number];

export type Placeholder = {
  key: string;
  kind: PlaceholderKind;
  label: string;
  /** Presente somente quando kind === "defaulted". */
  defaultValue?: unknown;
};

export type TemplateVariant = {
  /** Slug interno estável. NUNCA o nome comercial da clínica. */
  slug: "base" | "enhanced";
  displayNamePlaceholder: string;
  priceChannel: PriceChannel;
  priceKind: "fixed" | "from";
  /** Obrigatório quando priceChannel === "media". */
  mediaAssetPlaceholder?: string;
};

export type TemplateManifest = {
  id: string;
  version: string;
  segment: string;
  variants: TemplateVariant[];
  placeholders: Placeholder[];
  objections: Array<{ objection: string; response: string; appliesToVariant?: "base" | "enhanced" }>;
  qualificationQuestions: string[];
  handoffReasons: string[];
};

export type InstallOperation = {
  owner: CanonicalOwner;
  clinicId: string;
  description: string;
  values: Record<string, unknown>;
};

export type InstallPlan = {
  templateId: string;
  templateVersion: string;
  clinicId: string;
  operations: InstallOperation[];
  customFields: string[];
};

export type Blocker = {
  placeholderKey: string;
  reason: string;
};
