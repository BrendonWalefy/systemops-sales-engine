import { expectTypeOf } from "vitest";
import type { TemplateVariant } from "@/application/templates/contract";

// Variantes válidas

const mediaWithAsset: TemplateVariant = {
  slug: "base",
  displayNamePlaceholder: "Display Name",
  priceChannel: "media",
  priceKind: "fixed",
  mediaAssetPlaceholder: "asset-key",
};
expectTypeOf(mediaWithAsset).toMatchTypeOf<TemplateVariant>();

const textWithoutAsset: TemplateVariant = {
  slug: "enhanced",
  displayNamePlaceholder: "Display Name",
  priceChannel: "text",
  priceKind: "from",
};
expectTypeOf(textWithoutAsset).toMatchTypeOf<TemplateVariant>();

const humanWithoutAsset: TemplateVariant = {
  slug: "base",
  displayNamePlaceholder: "Display Name",
  priceChannel: "human",
  priceKind: "fixed",
};
expectTypeOf(humanWithoutAsset).toMatchTypeOf<TemplateVariant>();

// Variantes inválidas — o compilador deve rejeitar estas

// media SEM asset deve falhar
const mediaWithoutAssetValue = {
  slug: "base",
  displayNamePlaceholder: "Display Name",
  priceChannel: "media",
  priceKind: "fixed",
};
// @ts-expect-error mediaAssetPlaceholder é obrigatório quando priceChannel === "media"
const mediaWithoutAsset: TemplateVariant = mediaWithoutAssetValue;

// text COM asset deve falhar
const textWithAssetValue = {
  slug: "base",
  displayNamePlaceholder: "Display Name",
  priceChannel: "text",
  priceKind: "fixed",
  mediaAssetPlaceholder: "asset-key",
};
// @ts-expect-error mediaAssetPlaceholder não é permitido quando priceChannel === "text"
const textWithAsset: TemplateVariant = textWithAssetValue;

// human COM asset deve falhar
const humanWithAssetValue = {
  slug: "enhanced",
  displayNamePlaceholder: "Display Name",
  priceChannel: "human",
  priceKind: "from",
  mediaAssetPlaceholder: "asset-key",
};
// @ts-expect-error mediaAssetPlaceholder não é permitido quando priceChannel === "human"
const humanWithAsset: TemplateVariant = humanWithAssetValue;
