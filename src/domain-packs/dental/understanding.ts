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
    serviceCandidates: z.array(z.string()).nullable(),
    quantity: z.number().nullable(),
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
    | "business_information_topic_forbidden";
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
