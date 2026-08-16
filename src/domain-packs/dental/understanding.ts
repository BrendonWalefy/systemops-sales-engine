import { z } from "zod";
import { DENTAL_REQUESTS, type DentalRequest } from "@/domain-packs/dental/vocabulary";
import { UNDERSTANDING_VERSION, type Understanding } from "@/conversation-core/understanding/schema";

const CORE_DIALOGUE_MOVES = ["new_topic", "answers_pending", "acknowledges", "repeats", "closes"] as const;

const scalar = z.union([z.string(), z.number(), z.array(z.string()), z.null()]);
const schema = z.object({
  version: z.literal(UNDERSTANDING_VERSION),
  request: z.enum(DENTAL_REQUESTS),
  dialogueMove: z.enum(CORE_DIALOGUE_MOVES),
  entities: z.record(scalar),
  signals: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  safety: z.record(z.boolean()),
  confidence: z.number().min(0).max(1),
  ambiguity: z.object({ kind: z.string().min(1), candidates: z.array(z.string()).min(2) }).strict().nullable(),
}).strict().superRefine((value, context) => {
  if ((value.request === "price-of-service" || value.request === "service-availability")
    && typeof value.entities.service !== "string") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["entities", "service"], message: "service is required for this request" });
  }
});

export function parseDentalUnderstanding(value: unknown): Understanding<DentalRequest> {
  return schema.parse(value) as Understanding<DentalRequest>;
}
