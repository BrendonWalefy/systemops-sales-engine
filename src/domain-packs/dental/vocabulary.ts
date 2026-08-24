export const DENTAL_REQUESTS = [
  // Sem uma categoria para abertura social e para o que não é transacional, o
  // schema obriga o modelo a escolher um pedido que o lead não fez, e a
  // validação seguinte rejeita o turno inteiro. "oi" é a primeira mensagem da
  // maioria dos leads.
  "greeting",
  "other",
  // "o que é lente de resina?" chega antes de "quanto custa". Sem um conceito
  // próprio, essa pergunta caía em "other" e o lead recebia um convite genérico.
  "explain-service",
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
