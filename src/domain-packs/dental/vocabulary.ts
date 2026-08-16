export const DENTAL_REQUESTS = [
  "price-of-service",
  "service-availability",
  "book-appointment",
  "confirm-slot",
  "confirm-appointment",
] as const;

export type DentalRequest = (typeof DENTAL_REQUESTS)[number];

export const DENTAL_CONCEPTS = [
  "service",
  "price",
  "availability",
  "appointment",
  "offered-slot",
] as const;

export type DentalCatalogEntry = {
  id: string;
  displayName: string;
  aliases: readonly string[];
};
