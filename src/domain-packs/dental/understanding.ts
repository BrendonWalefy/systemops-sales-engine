import { z } from "zod";
import {
  UNDERSTANDING_VERSION,
  type Understanding,
} from "@/conversation-core/understanding/schema";
import {
  DENTAL_BUSINESS_INFORMATION_TOPICS,
  DENTAL_REQUESTS,
  type DentalRequest,
} from "@/domain-packs/dental/vocabulary";

const CORE_DIALOGUE_MOVES = [
  "new_topic",
  "answers_pending",
  "acknowledges",
  "repeats",
  "closes",
] as const;

export const dentalUnderstandingStructureSchema = z.object({
  version: z.literal(UNDERSTANDING_VERSION),
  request: z.enum(DENTAL_REQUESTS),
  dialogueMove: z.enum(CORE_DIALOGUE_MOVES),
  entities: z.object({
    service: z.string().nullable(),
    businessInformationTopic: z.enum(DENTAL_BUSINESS_INFORMATION_TOPICS).nullable(),
    date: z.string().nullable(),
    period: z.string().nullable(),
    time: z.string().nullable(),
    professional: z.string().nullable(),
    serviceCandidates: z.array(z.string()).nullable(),
    faqQuestion: z.string().nullable(),
    quantity: z.number().int().positive().nullable(),
    quantityScope: z.enum(["total", "superior", "inferior"]).nullable(),
    objectionQuestion: z.string().nullable(),
    ordinal: z.number().nullable(),
  }).strict(),
  signals: z.object({
    purchaseIntent: z.enum(["low", "medium", "high"]).nullable(),
    priceSensitivity: z.enum(["low", "medium", "high"]).nullable(),
    sentiment: z.enum(["negative", "neutral", "positive"]).nullable(),
    objection: z.string().nullable(),
  }).strict(),
  safety: z.object({
    optOut: z.boolean(),
    requestsHuman: z.boolean(),
    emergency: z.boolean(),
  }).strict(),
  confidence: z.number().min(0).max(1),
  ambiguity: z.object({
    kind: z.string().min(1),
    candidates: z.array(z.string()).min(2),
  }).strict().nullable(),
}).strict();

export type DentalUnderstandingStructure = z.infer<
  typeof dentalUnderstandingStructureSchema
>;

export type DentalUnderstandingSemanticIssue = Readonly<{
  path: readonly string[];
  code:
    | "service_required_for_request"
    | "business_information_topic_required"
    | "business_information_topic_forbidden"
    | "comparison_services_required"
    | "comparison_services_forbidden"
    | "faq_question_required"
    | "faq_question_forbidden"
    | "quantity_forbidden"
    | "quantity_scope_forbidden"
    | "quantity_scope_requires_quantity"
    | "objection_question_required"
    | "objection_question_forbidden"
    | "professional_forbidden"
    | "service_forbidden_for_request"
    | "date_forbidden_for_request"
    | "period_forbidden_for_request"
    | "time_forbidden_for_request"
    | "ordinal_forbidden_for_request";
}>;

export type DentalUnderstandingSemanticValidation =
  | Readonly<{ valid: true }>
  | Readonly<{
      valid: false;
      issues: readonly DentalUnderstandingSemanticIssue[];
    }>;

const SERVICE_REQUIRED_REQUESTS = new Set<DentalRequest>([
  "price-of-service",
  "service-availability",
  "explain-service",
]);

const PROFESSIONAL_ALLOWED_REQUESTS = new Set<DentalRequest>([
  "book-appointment",
  "reschedule-appointment",
]);

const OPERATIONAL_REQUESTS = new Set<DentalRequest>([
  "clinical-urgency",
  "existing-treatment-problem",
  "patient-arrival",
  "patient-delay",
]);

const PRESENCE_REQUESTS = new Set<DentalRequest>([
  "patient-arrival",
  "patient-delay",
]);

export class DentalUnderstandingSemanticError extends Error {
  readonly issues: readonly DentalUnderstandingSemanticIssue[];

  constructor(issues: readonly DentalUnderstandingSemanticIssue[]) {
    super("dental understanding semantic validation failed");
    this.name = "DentalUnderstandingSemanticError";
    this.issues = Object.freeze([...issues]);
  }
}

export function parseDentalUnderstandingStructure(
  value: unknown,
): Understanding<DentalRequest> {
  return dentalUnderstandingStructureSchema.parse(
    value,
  ) as Understanding<DentalRequest>;
}

export function validateDentalUnderstandingSemantics(
  value: Understanding<DentalRequest>,
): DentalUnderstandingSemanticValidation {
  const businessInformationTopic = value.entities.businessInformationTopic;
  if (value.request === "business-information" && typeof businessInformationTopic !== "string") {
    return {
      valid: false,
      issues: Object.freeze([{
        path: Object.freeze(["entities", "businessInformationTopic"]),
        code: "business_information_topic_required" as const,
      }]),
    };
  }
  if (value.request !== "business-information" && businessInformationTopic !== null) {
    return {
      valid: false,
      issues: Object.freeze([{
        path: Object.freeze(["entities", "businessInformationTopic"]),
        code: "business_information_topic_forbidden" as const,
      }]),
    };
  }
  if (
    value.request !== null
    && SERVICE_REQUIRED_REQUESTS.has(value.request)
    && typeof value.entities.service !== "string"
  ) {
    return {
      valid: false,
      issues: Object.freeze([{
        path: Object.freeze(["entities", "service"]),
        code: "service_required_for_request" as const,
      }]),
    };
  }

  const serviceCandidates = value.entities.serviceCandidates;
  if (value.request === "compare-services") {
    const normalizedCandidates = Array.isArray(serviceCandidates)
      ? serviceCandidates.map((candidate) => candidate.trim().toLocaleLowerCase("pt-BR"))
      : [];
    if (
      normalizedCandidates.length !== 2
      || normalizedCandidates.some((candidate) => candidate.length === 0)
      || new Set(normalizedCandidates).size !== 2
    ) {
      return {
        valid: false,
        issues: Object.freeze([{
          path: Object.freeze(["entities", "serviceCandidates"]),
          code: "comparison_services_required" as const,
        }]),
      };
    }
  } else if (serviceCandidates !== null) {
    return {
      valid: false,
      issues: Object.freeze([{
        path: Object.freeze(["entities", "serviceCandidates"]),
        code: "comparison_services_forbidden" as const,
      }]),
    };
  }

  const faqQuestion = value.entities.faqQuestion;
  if (
    value.request === "frequently-asked-question"
    && (typeof faqQuestion !== "string" || faqQuestion.trim().length === 0)
  ) {
    return {
      valid: false,
      issues: Object.freeze([{
        path: Object.freeze(["entities", "faqQuestion"]),
        code: "faq_question_required" as const,
      }]),
    };
  }
  if (value.request !== "frequently-asked-question" && faqQuestion !== null) {
    return {
      valid: false,
      issues: Object.freeze([{
        path: Object.freeze(["entities", "faqQuestion"]),
        code: "faq_question_forbidden" as const,
      }]),
    };
  }
  const quantity = value.entities.quantity;
  const quantityScope = value.entities.quantityScope;
  if (value.request !== "price-of-service" && quantity !== null) {
    return {
      valid: false,
      issues: Object.freeze([{
        path: Object.freeze(["entities", "quantity"]),
        code: "quantity_forbidden" as const,
      }]),
    };
  }
  if (value.request !== "price-of-service" && quantityScope !== null) {
    return {
      valid: false,
      issues: Object.freeze([{
        path: Object.freeze(["entities", "quantityScope"]),
        code: "quantity_scope_forbidden" as const,
      }]),
    };
  }
  if (quantityScope !== null && quantity === null) {
    return {
      valid: false,
      issues: Object.freeze([{
        path: Object.freeze(["entities", "quantityScope"]),
        code: "quantity_scope_requires_quantity" as const,
      }]),
    };
  }
  const objectionQuestion = value.entities.objectionQuestion;
  if (
    value.request === "registered-objection"
    && (typeof objectionQuestion !== "string" || objectionQuestion.trim().length === 0)
  ) {
    return {
      valid: false,
      issues: Object.freeze([{
        path: Object.freeze(["entities", "objectionQuestion"]),
        code: "objection_question_required" as const,
      }]),
    };
  }
  if (value.request !== "registered-objection" && objectionQuestion !== null) {
    return {
      valid: false,
      issues: Object.freeze([{
        path: Object.freeze(["entities", "objectionQuestion"]),
        code: "objection_question_forbidden" as const,
      }]),
    };
  }
  if (
    value.entities.professional !== null
    && value.request !== null
    && !PROFESSIONAL_ALLOWED_REQUESTS.has(value.request)
  ) {
    return {
      valid: false,
      issues: Object.freeze([{
        path: Object.freeze(["entities", "professional"]),
        code: "professional_forbidden" as const,
      }]),
    };
  }
  if (
    value.request !== null
    && OPERATIONAL_REQUESTS.has(value.request)
    && value.request !== "existing-treatment-problem"
    && value.entities.service !== null
  ) {
    return {
      valid: false,
      issues: Object.freeze([{
        path: Object.freeze(["entities", "service"]),
        code: "service_forbidden_for_request" as const,
      }]),
    };
  }
  if (
    value.request !== null
    && OPERATIONAL_REQUESTS.has(value.request)
    && !PRESENCE_REQUESTS.has(value.request)
    && value.entities.date !== null
  ) {
    return {
      valid: false,
      issues: Object.freeze([{
        path: Object.freeze(["entities", "date"]),
        code: "date_forbidden_for_request" as const,
      }]),
    };
  }
  if (
    value.request !== null
    && OPERATIONAL_REQUESTS.has(value.request)
    && value.entities.period !== null
  ) {
    return {
      valid: false,
      issues: Object.freeze([{
        path: Object.freeze(["entities", "period"]),
        code: "period_forbidden_for_request" as const,
      }]),
    };
  }
  if (
    value.request !== null
    && OPERATIONAL_REQUESTS.has(value.request)
    && !PRESENCE_REQUESTS.has(value.request)
    && value.entities.time !== null
  ) {
    return {
      valid: false,
      issues: Object.freeze([{
        path: Object.freeze(["entities", "time"]),
        code: "time_forbidden_for_request" as const,
      }]),
    };
  }
  if (
    value.request !== null
    && OPERATIONAL_REQUESTS.has(value.request)
    && value.entities.ordinal !== null
  ) {
    return {
      valid: false,
      issues: Object.freeze([{
        path: Object.freeze(["entities", "ordinal"]),
        code: "ordinal_forbidden_for_request" as const,
      }]),
    };
  }
  return { valid: true };
}

export function parseDentalUnderstanding(
  value: unknown,
): Understanding<DentalRequest> {
  const parsed = parseDentalUnderstandingStructure(value);
  const semantic = validateDentalUnderstandingSemantics(parsed);
  if (!semantic.valid) throw new DentalUnderstandingSemanticError(semantic.issues);
  return parsed;
}
