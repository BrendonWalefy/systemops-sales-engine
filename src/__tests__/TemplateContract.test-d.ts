import type { TemplateVariant } from "@/application/templates/contract";

// Casos válidos — devem compilar sem erros
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const mediaWithAsset: TemplateVariant = {
  slug: "base",
  displayNamePlaceholder: "Display Name",
  priceChannel: "media",
  priceKind: "fixed",
  mediaAssetPlaceholder: "asset-key",
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const textWithoutAsset: TemplateVariant = {
  slug: "enhanced",
  displayNamePlaceholder: "Display Name",
  priceChannel: "text",
  priceKind: "from",
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const humanWithoutAsset: TemplateVariant = {
  slug: "base",
  displayNamePlaceholder: "Display Name",
  priceChannel: "human",
  priceKind: "fixed",
};

// Casos inválidos — o compilador deve rejeitar estes

// media SEM asset: mediaAssetPlaceholder é obrigatório (TS2322 no const)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
// @ts-expect-error media requires mediaAssetPlaceholder
const mediaWithoutAsset: TemplateVariant = {
  slug: "base",
  displayNamePlaceholder: "Display Name",
  priceChannel: "media",
  priceKind: "fixed",
};

// text COM asset: mediaAssetPlaceholder não é permitido (TS2353 na propriedade)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const textWithAsset: TemplateVariant = {
  slug: "base",
  displayNamePlaceholder: "Display Name",
  priceChannel: "text",
  priceKind: "fixed",
  // @ts-expect-error text forbids mediaAssetPlaceholder
  mediaAssetPlaceholder: "asset-key",
};

// human COM asset: mediaAssetPlaceholder não é permitido (TS2353 na propriedade)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const humanWithAsset: TemplateVariant = {
  slug: "enhanced",
  displayNamePlaceholder: "Display Name",
  priceChannel: "human",
  priceKind: "from",
  // @ts-expect-error human forbids mediaAssetPlaceholder
  mediaAssetPlaceholder: "asset-key",
};
