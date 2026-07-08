import { z } from "zod";
import type { OrgPlan } from "./clinic-commercial-settings";
import { SEGMENT_KEYS } from "./segment-options";

/**
 * VALIDAÇÃO ÚNICA DE ONBOARDING.
 *
 * Tanto o script (scripts/create-clinic.ts) quanto a tela do painel owner
 * validam por aqui. A regra crítica é a mesma do gate de publicação: política
 * comercial NÃO pode ser vazia — é isso que impede a IA de ficar sem dado e
 * inventar na frente do cliente.
 */

const onboardingPlaybookSchema = z.object({
  // Mesma regra crítica do publishablePlaybookSchema (gate de publicação).
  commercialPolicy: z
    .string()
    .trim()
    .min(1, "política comercial não pode ser vazia (a IA inventaria condições)"),
  toneOfVoice: z.string().trim().min(1).default("acolhedor"),
  differentials: z.array(z.string()).default([]),
  objections: z
    .array(z.object({ objection: z.string(), response: z.string() }))
    .default([]),
  notes: z.string().trim().optional(),
});

const channelSchema = z
  .object({
    provider: z.enum(["z_api", "meta_cloud_api"]),
    zapi: z
      .object({
        instanceId: z.string().trim().min(1),
        token: z.string().trim().min(1),
        clientToken: z.string().trim().optional(),
      })
      .optional(),
    meta: z
      .object({
        phoneNumberId: z.string().trim().min(1),
        accessToken: z.string().trim().min(1),
      })
      .optional(),
  })
  .superRefine((c, ctx) => {
    if (c.provider === "z_api" && !c.zapi) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["zapi"], message: "credenciais Z-API obrigatórias" });
    }
    if (c.provider === "meta_cloud_api" && !c.meta) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["meta"], message: "credenciais Meta obrigatórias" });
    }
  });

export const onboardingConfigSchema = z.object({
  name: z.string().trim().min(1, "nome obrigatório"),
  slug: z
    .string()
    .trim()
    .min(1, "slug obrigatório")
    .regex(/^[a-z0-9-]+$/, "slug só pode ter minúsculas, números e hífen"),
  specialty: z.string().trim().default("odontology"),
  segment: z.enum(SEGMENT_KEYS).default("dental"),
  serviceNoun: z.string().trim().min(1).default("tratamento"),
  timezone: z.string().trim().default("America/Sao_Paulo"),
  businessHours: z.string().trim().optional(),
  greetingMessage: z.string().trim().optional(),
  receptionistPhone: z.string().trim().optional(),
  calendarMode: z.enum(["internal", "google_calendar"]).default("internal"),
  googleCalendarId: z.string().trim().optional(),
  isTest: z.boolean().default(true),
  plan: z.enum(["start", "growth", "scale", "enterprise"] satisfies [OrgPlan, ...OrgPlan[]]).default("enterprise"),
  billingActive: z.boolean().default(false),
  monthlyRevenueBrl: z.number().nonnegative().optional(),
  billingStartedAt: z.string().trim().optional(),
  channel: channelSchema,
  // O gate editorial: política comercial não pode ser vazia.
  playbook: onboardingPlaybookSchema,
  procedures: z
    .array(
      z.object({
        name: z.string().trim().min(1),
        durationMinutes: z.number().int().min(0).default(60),
        description: z.string().trim().optional(),
        requiresEvaluationFirst: z.boolean().default(false),
      }),
    )
    .default([]),
  admins: z
    .array(
      z.object({
        email: z.string().trim().email(),
        password: z.string().min(8, "senha deve ter pelo menos 8 caracteres"),
        role: z.enum(["owner", "org_admin"]).default("org_admin"),
        displayName: z.string().trim().optional(),
      }),
    )
    .min(1, "ao menos um admin é obrigatório"),
}).superRefine((cfg, ctx) => {
  if (cfg.calendarMode === "google_calendar" && !cfg.googleCalendarId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["googleCalendarId"],
      message: "calendar ID é obrigatório quando o modo é Google Calendar",
    });
  }
});

export type OnboardingConfig = z.infer<typeof onboardingConfigSchema>;
